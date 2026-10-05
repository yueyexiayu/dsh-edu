import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import { credentialSource } from "../lib/credentials.js";
import { CODEX_RECORD_KEY, CODEX_USAGE_URL, DEEPSEEK_BALANCE_URL, GROK_RECORD_KEY, GROK_USER_URL, GROK_BILLING_URL, ZAI_ACCOUNT_REPORT_PATH, ZAI_TOKEN_ACCOUNTS_PATH } from "../lib/parse.js";

const grant = (access, accountId = access) => ({ kind: "grant", payload: { type: "oauth", access, accountId } });
const usage = (used) => Response.json({ rate_limit: { primary_window: { used_percent: used, limit_window_seconds: 18000 } } });
const balance = (total) => Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: String(total) }] });

function host({ provider = "openai-codex", records = {}, refs = {}, routeConfig = {}, settingsNs = "custom-model-entry", settingsPath = ["providers", provider] } = {}) {
  const selection = { provider, model: "test-model" };
  let handler;
  let dispose;
  const events = new Map();
  apply({
    effect(callback) { dispose = callback(); },
    on(event, callback) { events.set(event, callback); },
    connection: { fetch: { register(value) { handler = value; } } },
    credentials: { async readRecord(key) { return records[key]; }, async resolve(ref) { return refs[ref] ? { value: refs[ref] } : undefined; } },
    get(name) {
      if (name === "agentDefaultModel") return { currentSelection: () => selection };
      if (name === "llm" && routeConfig !== undefined) return { listConfigurableProviders: () => [{ provider, settingsNs, settingsPath }] };
      if (name === "settings" && routeConfig !== undefined) {
        const value = settingsPath.reduceRight((child, key) => ({ [key]: child }), routeConfig);
        return { describe: () => [{ ns: settingsNs, revision: 0, value }] };
      }
    },
  });
  return {
    records, refs, selection,
    emit(event, key) { events.get(event)?.(key); },
    dispose() { dispose?.(); },
    async call() { return (await handler.fetch(new Request("http://local/api/dsh-edu"))).json(); },
  };
}

test("switching GPT credentials invalidates cached quota without waiting three minutes", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => usage(init.headers.authorization === "Bearer account-a" ? 11 : 72));
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  assert.equal((await h.call()).windows[0].utilization, 11);
  h.records[CODEX_RECORD_KEY] = grant("account-b");
  const second = await h.call();
  assert.equal(second.windows[0].utilization, 72);
  assert.equal(JSON.stringify(second).includes("account-b"), false);
  h.dispose();
});

test("logout cannot keep displaying the old account quota", async (t) => {
  t.mock.method(globalThis, "fetch", async () => usage(28));
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  await h.call();
  delete h.records[CODEX_RECORD_KEY];
  const result = await h.call();
  assert.equal(result.windows, null);
  assert.match(result.error, /未登录/);
  h.dispose();
});

test("late response from a replaced account cannot overwrite current quota", async (t) => {
  let resolveOld;
  t.mock.method(globalThis, "fetch", async (_url, init) => init.headers.authorization === "Bearer account-a"
    ? await new Promise((resolve) => { resolveOld = resolve; }) : usage(72));
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  const old = h.call();
  await new Promise(setImmediate);
  h.records[CODEX_RECORD_KEY] = grant("account-b");
  h.emit("credentials/record-updated", CODEX_RECORD_KEY);
  assert.equal((await h.call()).windows[0].utilization, 72);
  resolveOld(usage(11));
  assert.notEqual((await old).windows?.[0]?.utilization, 11);
  assert.equal((await h.call()).windows[0].utilization, 72);
  h.dispose();
});

test("concurrent requests for the same credential share one quota request", async (t) => {
  let resolve;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return await new Promise((done) => { resolve = done; }); });
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  const first = h.call(); const second = h.call();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  resolve(usage(28));
  assert.equal((await first).windows[0].utilization, 28);
  assert.equal((await second).windows[0].utilization, 28);
  h.dispose();
});

test("DeepSeek quota uses the current route's custom credential reference", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, DEEPSEEK_BALANCE_URL);
    assert.equal(init.headers.authorization, "Bearer selected-key");
    return balance(19);
  });
  const h = host({ provider: "deepseek-official", settingsPath: [], routeConfig: { apiKeyEnv: "MY_DEEPSEEK_KEY" }, refs: { MY_DEEPSEEK_KEY: "selected-key", DEEPSEEK_API_KEY: "other-account-key" } });
  assert.equal((await h.call()).balance.total, 19);
  h.dispose();
});

test("a missing explicit key never falls back to another account's default", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("must not query another account"); });
  const h = host({ provider: "zai", routeConfig: { apiKeyEnv: "MISSING_CUSTOM_KEY" }, refs: { ZAI_API_KEY: "other-key" } });
  const result = await h.call();
  assert.equal(result.balance, null);
  assert.match(result.error, /MISSING_CUSTOM_KEY/);
  h.dispose();
});

test("Zhipu stored API key takes precedence over native environment key", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers.authorization, "Bearer stored-selected-key");
    if (String(url).endsWith(ZAI_ACCOUNT_REPORT_PATH)) return Response.json({ success: true, code: 200, data: { availableBalance: 39 } });
    assert.ok(String(url).endsWith(ZAI_TOKEN_ACCOUNTS_PATH));
    return Response.json({ rows: [] });
  });
  const h = host({ provider: "zai", records: { "llm-pi-ai/zai": { kind: "api-key", key: "stored-selected-key" } }, refs: { ZAI_API_KEY: "other-account-key" } });
  assert.equal((await h.call()).balance.total, 39);
  h.dispose();
});

test("a failed quota query is retried instead of being cached for three minutes", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => { assert.equal(url, CODEX_USAGE_URL); return ++calls === 1 ? new Response("failure", { status: 503 }) : usage(28); });
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  assert.equal((await h.call()).windows, null);
  assert.equal((await h.call()).windows[0].utilization, 28);
  h.dispose();
});

test("late response is discarded even when an external account change emits no event", async (t) => {
  let finish;
  t.mock.method(globalThis, "fetch", async () => await new Promise((done) => { finish = done; }));
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  const pending = h.call();
  await new Promise(setImmediate);
  h.records[CODEX_RECORD_KEY] = grant("account-b");
  finish(usage(11));
  assert.equal((await pending).windows, null);
  h.dispose();
});

test("Grok identity and billing use the same account and switch immediately", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    const account = init.headers.authorization === "Bearer account-a" ? "user-a" : "user-b";
    if (url === GROK_USER_URL) return Response.json({ userId: account });
    assert.equal(url, GROK_BILLING_URL);
    assert.equal(init.headers["x-userid"], account);
    return Response.json({ config: { creditUsagePercent: account === "user-a" ? 12 : 73, currentPeriod: { type: "WEEKLY" } } });
  });
  const h = host({ provider: "xai", records: { [GROK_RECORD_KEY]: grant("account-a") } });
  assert.equal((await h.call()).windows[0].utilization, 12);
  assert.equal((await h.call()).windows[0].utilization, 12);
  assert.equal(calls, 2);
  h.records[GROK_RECORD_KEY] = grant("account-b");
  assert.equal((await h.call()).windows[0].utilization, 73);
  h.dispose();
});

test("reference update aborts old balance request and queries the new key", async (t) => {
  let finish;
  let oldSignal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init.headers.authorization === "Bearer old-key") {
      oldSignal = init.signal;
      return await new Promise((done) => { finish = done; });
    }
    return balance(39);
  });
  const h = host({ provider: "deepseek-official", refs: { DEEPSEEK_API_KEY: "old-key" } });
  const old = h.call();
  await new Promise(setImmediate);
  h.refs.DEEPSEEK_API_KEY = "new-key";
  h.emit("credentials/reference-updated", "DEEPSEEK_API_KEY");
  assert.equal(oldSignal.aborted, true);
  assert.equal((await h.call()).balance.total, 39);
  finish(balance(11));
  assert.equal((await old).balance, null);
  h.dispose();
});

test("disposal cancels in-flight requests and never publishes their result", async (t) => {
  let finish; let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => { signal = init.signal; return await new Promise((done) => { finish = done; }); });
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  const pending = h.call();
  await new Promise(setImmediate);
  h.dispose();
  assert.equal(signal.aborted, true);
  finish(usage(11));
  assert.equal((await pending).windows, null);
});

test("route reference edits invalidate cached balance without credential events", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => balance(init.headers.authorization === "Bearer key-a" ? 11 : 39));
  const routeConfig = { apiKeyEnv: "KEY_A" };
  const h = host({ provider: "deepseek-official", settingsPath: [], routeConfig, refs: { KEY_A: "key-a", KEY_B: "key-b" } });
  assert.equal((await h.call()).balance.total, 11);
  routeConfig.apiKeyEnv = "KEY_B";
  assert.equal((await h.call()).balance.total, 39);
  h.dispose();
});

test("OAuth quota is not attributed to a route using an explicit API key", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return usage(11); });
  const h = host({ routeConfig: { apiKeyEnv: "GPT_API_KEY" }, records: { [CODEX_RECORD_KEY]: grant("other-account") } });
  assert.match((await h.call()).error, /API Key/);
  assert.equal(calls, 0);
  h.dispose();
});

test("unrecognized endpoints do not show unrelated official balances", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return balance(11); });
  const h = host({ provider: "deepseek-official", settingsPath: [], routeConfig: { baseURL: "https://gateway.example/v1" }, refs: { DEEPSEEK_API_KEY: "key-a" } });
  assert.match((await h.call()).error, /自定义服务地址/);
  assert.equal(calls, 0);
  h.dispose();
});

test("model changes during a request cannot publish the previous model's quota", async (t) => {
  let finish;
  t.mock.method(globalThis, "fetch", async () => await new Promise((done) => { finish = done; }));
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") } });
  const pending = h.call();
  await new Promise(setImmediate);
  h.selection.provider = "unsupported";
  finish(usage(11));
  assert.equal((await pending).windows, null);
  assert.equal((await h.call()).isSupported, false);
  h.dispose();
});

test("provider error messages cannot echo the API key to the client", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, msg: "bad key secret-key-value" }));
  const h = host({ provider: "zai", refs: { ZAI_API_KEY: "secret-key-value" } });
  const result = await h.call();
  assert.equal(JSON.stringify(result).includes("secret-key-value"), false);
  assert.match(result.error, /REDACTED_SECRET/);
  h.dispose();
});

test("missing official route metadata never guesses another account's credential", async () => {
  await assert.rejects(credentialSource({ get: () => undefined }, "deepseek-official"), /无法确认当前模型路由/);
});

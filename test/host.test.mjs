import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import { credentialSource } from "../lib/credentials.js";
import { CODEX_RECORD_KEY, CODEX_USAGE_URL, DEEPSEEK_BALANCE_URL, GROK_RECORD_KEY, GROK_USER_URL, GROK_BILLING_URL, ZAI_ACCOUNT_REPORT_PATH, ZAI_TOKEN_ACCOUNTS_PATH } from "../lib/parse.js";

const grant = (access, accountId = access) => ({ kind: "grant", payload: { type: "oauth", access, accountId } });
const usage = (used) => Response.json({ rate_limit: { primary_window: { used_percent: used, limit_window_seconds: 18000 } } });
const balance = (total) => Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: String(total) }] });

function host({ provider = "openai-codex", records = {}, refs = {}, routeConfig = {}, settingsNs = "custom-model-entry", settingsPath = ["providers", provider], services = {} } = {}) {
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
      if (Object.hasOwn(services, name)) return services[name];
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
    async call(sessionId) { return (await handler.fetch(new Request(`http://local/api/dsh-edu${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`))).json(); },
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
  const first = await h.call();
  assert.equal(first.credentialEpoch, 0);
  delete h.records[CODEX_RECORD_KEY];
  h.emit("credentials/record-updated", CODEX_RECORD_KEY);
  const result = await h.call();
  assert.equal(result.windows, null);
  assert.equal(result.credentialEpoch, 1);
  assert.match(result.error, /未登录/);
  assert.equal(JSON.stringify(result).includes("account-a"), false);
  assert.equal(Object.hasOwn(result, "access"), false);
  assert.equal(Object.hasOwn(result, "accountId"), false);
  assert.equal(Object.hasOwn(result, "key"), false);
  h.dispose();
});

test("credential events increment credentialEpoch on every edu response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => usage(11));
  const h = host({ provider: "other" });
  const unsupported = await h.call();
  assert.equal(unsupported.isSupported, false);
  assert.equal(unsupported.credentialEpoch, 0);
  h.emit("credentials/record-updated", CODEX_RECORD_KEY);
  h.emit("credentials/reference-updated", "DEEPSEEK_API_KEY");
  const after = await h.call();
  assert.equal(after.credentialEpoch, 2);
  assert.equal(Object.hasOwn(after, "access"), false);
  assert.equal(Object.hasOwn(after, "accountId"), false);
  assert.equal(Object.hasOwn(after, "key"), false);
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

function sessionServices(next, header = { provider: "xai", model: "old-model" }) {
  const session = { requestHeader: () => ({ config: header }) };
  const projection = { next };
  return {
    projection,
    services: {
      agents: { get: (id) => id === "current" ? { session } : undefined },
      sessionProjections: { snapshot(value, keys) {
        assert.equal(value, session);
        assert.deepEqual(keys, ["modelSelection"]);
        return { values: { modelSelection: projection } };
      } },
    },
  };
}

test("session projection next beats the last header and another session's global model", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => { calls++; assert.equal(url, CODEX_USAGE_URL); return usage(31); });
  const { services } = sessionServices({ provider: "openai-codex", model: "next-model" });
  const h = host({ provider: "openai-codex", records: { [CODEX_RECORD_KEY]: grant("account-a") }, services });
  h.selection.provider = "unsupported-global";
  const result = await h.call("current");
  assert.equal(result.provider, "openai-codex");
  assert.equal(result.model, "next-model");
  assert.equal(result.windows[0].utilization, 31);
  assert.equal(calls, 1);
  h.dispose();
});

test("sessions without a pending projection selection retain the last request header", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => { assert.equal(url, CODEX_USAGE_URL); return usage(31); });
  const { services } = sessionServices(null, { provider: "openai-codex", model: "header-model" });
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") }, services });
  h.selection.provider = "unsupported-global";
  assert.equal((await h.call("current")).model, "header-model");
  h.dispose();
});

for (const failure of ["missing", "projection", "header", "projection-service", "projection-unregistered", "malformed-header"]) {
  test(`session ${failure} failures are visible without querying the global account`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => { assert.fail("must not query the global account"); });
    const { services } = sessionServices(null);
    if (failure === "projection") services.sessionProjections.snapshot = () => { throw new Error("private service details"); };
    if (failure === "projection-service") delete services.sessionProjections;
    if (failure === "projection-unregistered") services.sessionProjections.snapshot = () => ({ values: {} });
    if (failure === "header") services.agents.get = () => ({ session: { requestHeader() { throw new Error("private header details"); } } });
    if (failure === "malformed-header") services.agents.get = () => ({ session: { requestHeader: () => ({ config: {} }) } });
    if (failure === "header" || failure === "malformed-header") {
      services.sessionProjections.snapshot = () => ({ values: { modelSelection: { next: null } } });
    }
    const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") }, services });
    const result = await h.call(failure === "missing" ? "absent" : "current");
    assert.equal(result.ok, false);
    assert.equal(result.balance, null);
    assert.equal(result.windows, null);
    assert.match(result.error, /会话|模型/);
    assert.equal(JSON.stringify(result).includes("private"), false);
    h.dispose();
  });
}

test("a new session without pending selection or any request header uses the official default", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => { assert.equal(url, CODEX_USAGE_URL); return usage(31); });
  const { services } = sessionServices(null);
  services.agents.get = () => ({ session: { requestHeader: () => undefined } });
  services.sessionProjections.snapshot = () => ({ values: { modelSelection: { next: null } } });
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") }, services });
  const result = await h.call("current");
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai-codex");
  assert.equal(result.model, "test-model");
  assert.equal(result.windows[0].utilization, 31);
  h.dispose();
});

test("late session projection model changes discard the previous provider's quota", async (t) => {
  let finish;
  t.mock.method(globalThis, "fetch", async () => new Promise((done) => { finish = done; }));
  const { services, projection } = sessionServices({ provider: "openai-codex", model: "first" });
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") }, services });
  const pending = h.call("current");
  await new Promise(setImmediate);
  projection.next = { provider: "unsupported", model: "second" };
  finish(usage(11));
  assert.equal((await pending).windows, null);
  assert.equal((await h.call("current")).isSupported, false);
  h.dispose();
});

for (const failure of ["http", "business", "shape", "json", "network"]) {
  test(`Zhipu ${failure} package failures preserve cash with a visible redacted warning`, async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
      if (String(url).endsWith(ZAI_ACCOUNT_REPORT_PATH)) return Response.json({ success: true, code: 200, data: { availableBalance: 39 } });
      if (failure === "network") throw new Error("secret-key-value transport error");
      return failure === "http" ? new Response("failure", { status: 429 })
        : failure === "business" ? Response.json({ success: false, msg: "secret-key-value denied" })
          : failure === "json" ? new Response("not JSON") : Response.json({ success: true, data: {} });
    });
    const h = host({ provider: "zai", refs: { ZAI_API_KEY: "secret-key-value" } });
    const result = await h.call();
    assert.equal(result.balance.total, 39);
    assert.equal(result.balance.packages, null);
    assert.equal(result.error, null);
    assert.equal(result.state, "partial_retry");
    assert.ok(result.retryAfterMs > 0 && result.retryAfterMs <= 30_000);
    assert.match(result.warning, /资源包/);
    assert.equal(JSON.stringify(result).includes("secret-key-value"), false);
    h.dispose();
  });
}

test("Zhipu package failures retry after short backoff without requerying cached cash", async (t) => {
  let now = 1_000_000; let cashCalls = 0; let packageCalls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith(ZAI_ACCOUNT_REPORT_PATH)) { cashCalls++; return Response.json({ success: true, code: 200, data: { availableBalance: 39 } }); }
    packageCalls++;
    return packageCalls === 1 ? new Response("failure", { status: 429 }) : Response.json({ rows: [] });
  });
  const h = host({ provider: "zai", refs: { ZAI_API_KEY: "key-a" } });
  const first = await h.call();
  assert.equal(first.balance.packages, null);
  now += 29_000;
  assert.equal((await h.call()).balance.packages, null);
  assert.equal(packageCalls, 1);
  now += 1_000;
  const recovered = await h.call();
  assert.deepEqual(recovered.balance.packages, []);
  assert.equal(recovered.warning, null);
  assert.equal(cashCalls, 1);
  assert.equal(packageCalls, 2);
  now += 150_000;
  assert.deepEqual((await h.call()).balance.packages, []);
  assert.equal(cashCalls, 2);
  assert.equal(packageCalls, 2);
  h.dispose();
});

test("Zhipu cached packages survive a cash failure", async (t) => {
  let cashCalls = 0; let packageCalls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith(ZAI_ACCOUNT_REPORT_PATH)) return ++cashCalls === 1 ? new Response("failure", { status: 503 }) : Response.json({ success: true, data: { availableBalance: 39 } });
    packageCalls++;
    return Response.json({ rows: [] });
  });
  const h = host({ provider: "zai", refs: { ZAI_API_KEY: "key-a" } });
  assert.equal((await h.call()).balance, null);
  const result = await h.call();
  assert.equal(result.balance.total, 39);
  assert.deepEqual(result.balance.packages, []);
  assert.equal(cashCalls, 2);
  assert.equal(packageCalls, 1);
  h.dispose();
});

test("Zhipu switching credentials clears cash, package cache and package backoff together", async (t) => {
  let cashCalls = 0; let packageCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const old = init.headers.authorization === "Bearer key-a";
    if (String(url).endsWith(ZAI_ACCOUNT_REPORT_PATH)) { cashCalls++; return Response.json({ success: true, data: { availableBalance: old ? 11 : 39 } }); }
    packageCalls++;
    return old ? new Response("failure", { status: 429 }) : Response.json({ rows: [] });
  });
  const h = host({ provider: "zai", refs: { ZAI_API_KEY: "key-a" } });
  assert.equal((await h.call()).balance.total, 11);
  h.refs.ZAI_API_KEY = "key-b";
  const result = await h.call();
  assert.equal(result.balance.total, 39);
  assert.deepEqual(result.balance.packages, []);
  assert.equal(result.warning, null);
  assert.equal(cashCalls, 2);
  assert.equal(packageCalls, 2);
  h.dispose();
});

test("Zhipu concurrent callers share independently-started cash and package requests", async (t) => {
  let cashCalls = 0; let packageCalls = 0; let finishCash; let finishPackages;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith(ZAI_ACCOUNT_REPORT_PATH)) {
      cashCalls++;
      return new Promise((done) => { finishCash = done; });
    }
    packageCalls++;
    return new Promise((done) => { finishPackages = done; });
  });
  const h = host({ provider: "zai", refs: { ZAI_API_KEY: "key-a" } });
  const first = h.call(); const second = h.call();
  await new Promise(setImmediate);
  assert.equal(cashCalls, 1);
  assert.equal(packageCalls, 1, "package request starts before cash finishes");
  finishPackages(Response.json({ rows: [] }));
  finishCash(Response.json({ success: true, data: { availableBalance: 39 } }));
  assert.deepEqual((await first).balance.packages, []);
  assert.deepEqual((await second).balance.packages, []);
  assert.equal((await h.call()).balance.total, 39);
  assert.equal(cashCalls, 1);
  assert.equal(packageCalls, 1);
  h.dispose();
});

test("Zhipu invalidation aborts both requests and rejects the old account's late package warning", async (t) => {
  const finishes = []; const signals = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (init.headers.authorization === "Bearer key-a") {
      signals.push(init.signal);
      return new Promise((done) => { finishes.push(done); });
    }
    return String(url).endsWith(ZAI_ACCOUNT_REPORT_PATH)
      ? Response.json({ success: true, data: { availableBalance: 39 } }) : Response.json({ rows: [] });
  });
  const h = host({ provider: "zai", refs: { ZAI_API_KEY: "key-a" } });
  const pending = h.call();
  await new Promise(setImmediate);
  assert.equal(signals.length, 2);
  h.refs.ZAI_API_KEY = "key-b";
  h.emit("credentials/reference-updated", "ZAI_API_KEY");
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal((await h.call()).balance.total, 39);
  finishes[0](Response.json({ success: true, data: { availableBalance: 11 } }));
  finishes[1](Response.json({ success: false, msg: "key-a expired" }));
  const old = await pending;
  assert.equal(old.balance, null);
  assert.equal(old.warning, null);
  assert.equal(JSON.stringify(old).includes("key-a"), false);
  const current = await h.call();
  assert.equal(current.balance.total, 39);
  assert.deepEqual(current.balance.packages, []);
  assert.equal(current.warning, null);
  h.dispose();
});

test("a session projection read failure during the query discards the response", async (t) => {
  let finish;
  t.mock.method(globalThis, "fetch", async () => new Promise((done) => { finish = done; }));
  const { services } = sessionServices({ provider: "openai-codex", model: "next-model" });
  const h = host({ records: { [CODEX_RECORD_KEY]: grant("account-a") }, services });
  const pending = h.call("current");
  await new Promise(setImmediate);
  services.sessionProjections.snapshot = () => { throw new Error("private service details"); };
  finish(usage(11));
  assert.equal((await pending).windows, null);
  assert.equal((await h.call("current")).ok, false);
  h.dispose();
});

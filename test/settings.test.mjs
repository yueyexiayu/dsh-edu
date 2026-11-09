import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";
import { createSettingsStore, DEFAULT_SETTINGS, settingsHandler, validateSettings } from "../lib/settings.js";
import { CODEX_RECORD_KEY } from "../lib/parse.js";

const url = "http://localhost/api/dsh-edu/settings";
const post = (settings, revision, headers = {}) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ settings, revision }),
});

function changed(settings) {
  const next = structuredClone(settings);
  next.pollIntervalMs = 5000;
  const codex = next.platforms.find((platform) => platform.adapter === "codex");
  codex.warningPercent = 55;
  codex.criticalPercent = 80;
  codex.label = "Codex 主账号";
  return next;
}

test("model settings persist privately, use revisions and reject unsafe input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-edu-settings-"));
  const file = join(dir, "settings.json");
  try {
    const store = createSettingsStore(file);
    const handler = settingsHandler(store);
    const second = createSettingsStore(file);
    const initial = await (await handler(new Request(url))).json();
    assert.deepEqual(initial.settings, DEFAULT_SETTINGS);
    assert.equal(initial.revision, "absent");

    const next = changed(initial.settings);
    const saved = await handler(post(next, initial.revision));
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.deepEqual(savedBody.settings, next);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), next);
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    const secondRevision = (await (await settingsHandler(second)(new Request(url))).json()).revision;
    assert.equal((await settingsHandler(second)(post(DEFAULT_SETTINGS, initial.revision))).status, 409);
    assert.equal(secondRevision, savedBody.revision);
    assert.equal((await handler(post({ ...next, extra: true }, savedBody.revision))).status, 400);
    const invalidThresholds = changed(next);
    const invalidCodex = invalidThresholds.platforms.find((platform) => platform.adapter === "codex");
    invalidCodex.warningPercent = 90;
    invalidCodex.criticalPercent = 80;
    assert.equal((await handler(post(invalidThresholds, savedBody.revision))).status, 400);
    assert.equal((await handler(post(DEFAULT_SETTINGS, savedBody.revision, { host: "localhost", origin: "https://evil.test" }))).status, 403);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("settings validation keeps source labels and reserves DSH model ownership", () => {
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, requestTimeoutMs: 999 }), /请求超时/);
  const missing = structuredClone(DEFAULT_SETTINGS);
  missing.platforms.pop();
  assert.doesNotThrow(() => validateSettings(missing));
  const duplicate = structuredClone(DEFAULT_SETTINGS);
  duplicate.platforms.push(structuredClone(duplicate.platforms[0]));
  assert.throws(() => validateSettings(duplicate), /ID 重复/);
  const labels = structuredClone(DEFAULT_SETTINGS);
  labels.platforms[0].label = "  ";
  assert.throws(() => validateSettings(labels), /显示名称/);
  const legacy = {
    pollIntervalMs: 2000, idlePollIntervalMs: 30000, cacheTtlMs: 180000, requestTimeoutMs: 15000,
    models: Object.fromEntries(DEFAULT_SETTINGS.platforms.map((platform) => [platform.adapter, {
      label: platform.label, enabled: platform.enabled, warningPercent: 60, criticalPercent: 85,
      showResetCountdown: platform.showResetCountdown, showQueriedAt: platform.showQueriedAt,
    }])),
  };
  const migrated = validateSettings(legacy);
  assert.equal(migrated.platforms.length, 5);
  assert.equal(migrated.platforms[0].warningPercent, 60);
  assert.equal(migrated.platforms[0].adapter, "codex");
  const custom = structuredClone(DEFAULT_SETTINGS);
  custom.platforms.push({
    id: "balance-a", label: "A", adapter: "balance", provider: "a", enabled: true,
    warningPercent: 70, criticalPercent: 90, showResetCountdown: true, showQueriedAt: true,
    endpoint: "http://localhost/balance", auth: "bearer", totalPath: "balance", currencyPath: "", currency: "USD",
  });
  assert.throws(() => validateSettings(custom), /HTTPS/);
});

test("the DSH bridge URL does not defeat same-origin browser checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-edu-bridge-"));
  try {
    const handler = settingsHandler(createSettingsStore(join(dir, "settings.json")));
    const accepted = new Request("http://dsh.internal/api/dsh-edu/settings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3080",
        origin: "http://127.0.0.1:3080",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ settings: DEFAULT_SETTINGS, revision: "absent" }),
    });
    assert.equal((await handler(accepted)).status, 200);
    const rejected = new Request("http://dsh.internal/api/dsh-edu/settings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3080",
        origin: "http://127.0.0.1:9999",
        "sec-fetch-site": "same-site",
      },
      body: JSON.stringify({ settings: DEFAULT_SETTINGS, revision: "absent" }),
    });
    assert.equal((await handler(rejected)).status, 403);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function runtime(file, { provider = "openai-codex", routeConfig = {}, refs = {}, metadata = {} } = {}) {
  const handlers = new Map();
  const events = new Map();
  let dispose;
  apply({
    effect(callback) { dispose = callback(); },
    on(event, callback) { events.set(event, callback); },
    connection: { fetch: { register(value) { handlers.set(value.path, value); } } },
    credentials: {
      async readRecord(key) { return key === CODEX_RECORD_KEY ? { kind: "grant", payload: { type: "oauth", access: "fixture-token", accountId: "fixture-account" } } : undefined; },
      async resolve(ref) { return refs[ref] ? { value: refs[ref] } : undefined; },
    },
    get(name) {
      if (name === "agentDefaultModel") return { currentSelection: () => ({ provider, model: "fixture-model" }) };
      if (name === "llm") return {
        listConfigurableProviders: () => [{ provider, displayName: provider, settingsNs: "llm-pi-ai", settingsPath: ["providers", provider], ...metadata }],
        listProviders: () => [{ id: provider, name: provider }],
      };
      if (name === "settings") return { describe: () => [{ ns: "llm-pi-ai", value: { providers: { [provider]: routeConfig } } }] };
    },
  }, { settingsFile: file });
  return {
    settings(request) { return handlers.get("/api/dsh-edu/settings").fetch(request); },
    platforms: async () => (await handlers.get("/api/dsh-edu/platforms").fetch(new Request("http://local/api/dsh-edu/platforms"))).json(),
    status: async () => (await handlers.get("/api/dsh-edu").fetch(new Request("http://local/api/dsh-edu"))).json(),
    refs, emit(event, key) { events.get(event)?.(key); },
    dispose() { dispose?.(); },
  };
}

test("saved model parameters govern runtime display and disabled sources make no request", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-edu-runtime-"));
  const file = join(dir, "settings.json");
  try {
    const store = createSettingsStore(file);
    const initial = changed(DEFAULT_SETTINGS);
    initial.platforms.find((platform) => platform.adapter === "codex").label = "Codex 自定义";
    assert.ok(await store.save(initial, "absent"));
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000 } } }); });
    const h = runtime(file);
    const result = await h.status();
    assert.equal(calls, 1);
    assert.equal(result.display.label, "Codex 自定义");
    assert.equal(result.display.warningPercent, 55);
    assert.equal(result.refreshAfterMs, 5000);

    const current = await (await h.settings(new Request(url))).json();
    const disabled = structuredClone(current.settings);
    disabled.platforms.find((platform) => platform.adapter === "codex").enabled = false;
    assert.equal((await h.settings(post(disabled, current.revision))).status, 200);
    const hidden = await h.status();
    assert.equal(hidden.isSupported, false);
    assert.equal(calls, 1);
    h.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("custom platform uses the DSH route key, makes a real call and syncs deletion", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-edu-custom-"));
  const file = join(dir, "settings.json");
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.platforms.push({
      id: "balance-openrouter", label: "OpenRouter", adapter: "balance", provider: "openrouter", enabled: true,
      warningPercent: 20, criticalPercent: 10 + 15, showResetCountdown: true, showQueriedAt: true,
      endpoint: "https://openrouter.ai/api/v1/credits", auth: "bearer", totalPath: "data.balance",
      currencyPath: "data.currency", currency: "USD",
    });
    assert.ok(await createSettingsStore(file).save(settings, "absent"));
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls++;
      assert.equal(url, "https://openrouter.ai/api/v1/credits");
      assert.equal(init.redirect, "manual");
      assert.match(init.headers.authorization, /^Bearer custom-secret(?:-new)?$/);
      return Response.json({ data: { balance: init.headers.authorization.endsWith("-new") ? "9.00" : "7.50", currency: "USD" } });
    });
    const h = runtime(file, { provider: "openrouter", routeConfig: { apiKeyEnv: "OPENROUTER_API_KEY" }, refs: { OPENROUTER_API_KEY: "custom-secret" } });
    assert.deepEqual((await h.platforms()).providers, [{ id: "openrouter", name: "openrouter", live: true, declared: false }]);
    const first = await h.status();
    assert.equal(calls, 1);
    assert.equal(first.display.label, "OpenRouter");
    assert.equal(first.balance.total, 7.5);
    assert.equal(first.balance.currency, "USD");
    assert.equal(JSON.stringify(first).includes("custom-secret"), false);
    h.refs.OPENROUTER_API_KEY = "custom-secret-new";
    h.emit("credentials/reference-updated", "OPENROUTER_API_KEY");
    const updated = await h.status();
    assert.equal(calls, 2);
    assert.equal(updated.balance.total, 9);

    const current = await (await h.settings(new Request(url))).json();
    const removed = structuredClone(current.settings);
    removed.platforms = removed.platforms.filter((platform) => platform.provider !== "openrouter");
    assert.equal((await h.settings(post(removed, current.revision))).status, 200);
    const hidden = await h.status();
    assert.equal(hidden.isSupported, false);
    assert.equal(calls, 2);
    h.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("custom platform without a DSH API key fails before network access", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-edu-custom-missing-"));
  const file = join(dir, "settings.json");
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.platforms.push({
      id: "balance-missing", label: "Missing", adapter: "balance", provider: "missing", enabled: true,
      warningPercent: 70, criticalPercent: 90, showResetCountdown: true, showQueriedAt: true,
      endpoint: "https://example.com/balance", auth: "bearer", totalPath: "balance", currencyPath: "", currency: "USD",
    });
    assert.ok(await createSettingsStore(file).save(settings, "absent"));
    t.mock.method(globalThis, "fetch", async () => { assert.fail("custom platform must not fetch without a key"); });
    const h = runtime(file, { provider: "missing" });
    const result = await h.status();
    assert.equal(result.balance, null);
    assert.match(result.error, /API Key/);
    h.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("custom platform uses native provider environment credentials in lookup order", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-edu-custom-native-"));
  const file = join(dir, "settings.json");
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.platforms.push({
      id: "balance-native", label: "Native", adapter: "balance", provider: "native", enabled: true,
      warningPercent: 70, criticalPercent: 90, showResetCountdown: true, showQueriedAt: true,
      endpoint: "https://example.com/balance", auth: "x-api-key", totalPath: "balance", currencyPath: "", currency: "USD",
    });
    assert.ok(await createSettingsStore(file).save(settings, "absent"));
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(url, "https://example.com/balance");
      assert.equal(init.headers["x-api-key"], "native-secret");
      assert.equal(Object.hasOwn(init.headers, "authorization"), false);
      return Response.json({ balance: 5 });
    });
    const h = runtime(file, {
      provider: "native", refs: { VENDOR_API_KEY: "native-secret" },
      metadata: { nativeAuth: { env: ["MISSING_KEY", "VENDOR_API_KEY"], oauth: false } },
    });
    const result = await h.status();
    assert.equal(result.balance.total, 5);
    assert.equal(JSON.stringify(result).includes("native-secret"), false);
    h.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

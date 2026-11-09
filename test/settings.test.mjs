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
  next.models.codex.warningPercent = 55;
  next.models.codex.criticalPercent = 80;
  next.models.codex.label = "Codex 主账号";
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
    invalidThresholds.models.codex.warningPercent = 90;
    invalidThresholds.models.codex.criticalPercent = 80;
    assert.equal((await handler(post(invalidThresholds, savedBody.revision))).status, 400);
    assert.equal((await handler(post(DEFAULT_SETTINGS, savedBody.revision, { host: "localhost", origin: "https://evil.test" }))).status, 403);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("settings validation keeps source labels and reserves DSH model ownership", () => {
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, requestTimeoutMs: 999 }), /请求超时/);
  const missing = structuredClone(DEFAULT_SETTINGS);
  delete missing.models.zai;
  assert.throws(() => validateSettings(missing), /模型设置/);
  const labels = structuredClone(DEFAULT_SETTINGS);
  labels.models.codex.label = "  ";
  assert.throws(() => validateSettings(labels), /显示名称/);
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

function runtime(file) {
  const handlers = new Map();
  let dispose;
  apply({
    effect(callback) { dispose = callback(); },
    on() {},
    connection: { fetch: { register(value) { handlers.set(value.path, value); } } },
    credentials: {
      async readRecord(key) { return key === CODEX_RECORD_KEY ? { kind: "grant", payload: { type: "oauth", access: "fixture-token", accountId: "fixture-account" } } : undefined; },
      async resolve() {},
    },
    get(name) {
      if (name === "agentDefaultModel") return { currentSelection: () => ({ provider: "openai-codex", model: "fixture-model" }) };
      if (name === "llm") return { listConfigurableProviders: () => [{ provider: "openai-codex", settingsNs: "llm-pi-ai", settingsPath: ["providers", "openai-codex"] }] };
      if (name === "settings") return { describe: () => [{ ns: "llm-pi-ai", value: { providers: { "openai-codex": {} } } }] };
    },
  }, { settingsFile: file });
  return {
    settings(request) { return handlers.get("/api/dsh-edu/settings").fetch(request); },
    status: async () => (await handlers.get("/api/dsh-edu").fetch(new Request("http://local/api/dsh-edu"))).json(),
    dispose() { dispose?.(); },
  };
}

test("saved model parameters govern runtime display and disabled sources make no request", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-edu-runtime-"));
  const file = join(dir, "settings.json");
  try {
    const store = createSettingsStore(file);
    const initial = changed(DEFAULT_SETTINGS);
    initial.models.codex.label = "Codex 自定义";
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
    disabled.models.codex.enabled = false;
    assert.equal((await h.settings(post(disabled, current.revision))).status, 200);
    const hidden = await h.status();
    assert.equal(hidden.isSupported, false);
    assert.equal(calls, 1);
    h.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

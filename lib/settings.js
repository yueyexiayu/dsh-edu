import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const BUILTIN_PLATFORMS = Object.freeze([
  Object.freeze({ id: "codex", label: "Codex" }),
  Object.freeze({ id: "grok", label: "Grok" }),
  Object.freeze({ id: "opencodeGo", label: "OpenCode Go" }),
  Object.freeze({ id: "deepseek", label: "DeepSeek" }),
  Object.freeze({ id: "zai", label: "智谱" }),
]);

const PLATFORM_DEFAULTS = Object.freeze({
  enabled: true,
  warningPercent: 70,
  criticalPercent: 90,
  showResetCountdown: true,
  showQueriedAt: true,
  provider: "",
  endpoint: "",
  auth: "bearer",
  totalPath: "",
  currencyPath: "",
  currency: "CNY",
});

export const DEFAULT_SETTINGS = Object.freeze({
  pollIntervalMs: 2000,
  idlePollIntervalMs: 30000,
  cacheTtlMs: 180000,
  requestTimeoutMs: 15000,
  platforms: Object.freeze(BUILTIN_PLATFORMS.map(({ id, label }) => Object.freeze({
    id, label, adapter: id, ...PLATFORM_DEFAULTS,
  }))),
});

const ROOT_KEYS = Object.freeze(["pollIntervalMs", "idlePollIntervalMs", "cacheTtlMs", "requestTimeoutMs", "platforms"]);
const PLATFORM_KEYS = Object.freeze([
  "id", "label", "adapter", "provider", "enabled", "warningPercent", "criticalPercent",
  "showResetCountdown", "showQueriedAt", "endpoint", "auth", "totalPath", "currencyPath", "currency",
]);
const LEGACY_ROOT_KEYS = Object.freeze(["pollIntervalMs", "idlePollIntervalMs", "cacheTtlMs", "requestTimeoutMs", "models"]);
const LEGACY_MODEL_KEYS = Object.freeze(["label", "enabled", "warningPercent", "criticalPercent", "showResetCountdown", "showQueriedAt"]);
const ADAPTERS = new Set([...BUILTIN_PLATFORMS.map(({ id }) => id), "balance"]);

export function settingsPath(home = process.env.DSH_HOME) {
  return join(typeof home === "string" && home.trim() ? home.trim() : join(homedir(), ".dsh"), "storages", "dsh-edu", "settings.json");
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label}字段不完整或包含未知字段`);
  }
}

function integerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}必须是 ${min}–${max} 的整数`);
  return value;
}

function percentage(value, min, max, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}必须是 ${min}–${max} 的数值`);
  return value;
}

function stringInRange(value, min, max, label, pattern) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) throw new Error(`${label}格式无效`);
  return value;
}

function migrateSettings(value) {
  if (Array.isArray(value?.platforms) || !value?.models || typeof value.models !== "object") return value;
  exactObject(value, LEGACY_ROOT_KEYS, "旧版设置");
  exactObject(value.models, BUILTIN_PLATFORMS.map(({ id }) => id), "旧版模型设置");
  return {
    pollIntervalMs: value.pollIntervalMs,
    idlePollIntervalMs: value.idlePollIntervalMs,
    cacheTtlMs: value.cacheTtlMs,
    requestTimeoutMs: value.requestTimeoutMs,
    platforms: BUILTIN_PLATFORMS.map(({ id, label }) => {
      const previous = value.models[id];
      exactObject(previous, LEGACY_MODEL_KEYS, `${label} 旧版设置`);
      return {
        id, label, adapter: id, ...PLATFORM_DEFAULTS,
        ...(previous && typeof previous === "object" ? previous : {}),
      };
    }),
  };
}

export function validateSettings(value) {
  value = migrateSettings(value);
  exactObject(value, ROOT_KEYS, "设置");
  const pollIntervalMs = integerInRange(value.pollIntervalMs, 1000, 60000, "刷新间隔");
  const idlePollIntervalMs = integerInRange(value.idlePollIntervalMs, 5000, 300000, "未支持模型刷新间隔");
  if (idlePollIntervalMs < pollIntervalMs) throw new Error("未支持模型刷新间隔不能小于普通刷新间隔");
  const cacheTtlMs = integerInRange(value.cacheTtlMs, 10000, 1800000, "缓存时间");
  const requestTimeoutMs = integerInRange(value.requestTimeoutMs, 1000, 30000, "请求超时");
  if (!Array.isArray(value.platforms) || value.platforms.length > 20) throw new Error("模型平台必须是 0–20 项的列表");
  const ids = new Set();
  const builtins = new Set();
  const providers = new Set();
  const platforms = value.platforms.map((item, index) => {
    exactObject(item, PLATFORM_KEYS, `模型平台 ${index + 1}`);
    const id = stringInRange(item.id, 1, 64, "模型平台 ID", /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    if (ids.has(id)) throw new Error(`模型平台 ID 重复：${id}`);
    ids.add(id);
    if (!ADAPTERS.has(item.adapter)) throw new Error("模型平台适配器无效");
    if (typeof item.label !== "string") throw new Error("模型平台显示名称格式无效");
    const label = stringInRange(item.label.trim(), 1, 24, "模型平台显示名称");
    if (typeof item.enabled !== "boolean" || typeof item.showResetCountdown !== "boolean" || typeof item.showQueriedAt !== "boolean") throw new Error(`${label} 开关无效`);
    const warningPercent = percentage(item.warningPercent, 0, 99.9, `${label} 提醒阈值`);
    const criticalPercent = percentage(item.criticalPercent, 0.1, 100, `${label} 严重阈值`);
    if (warningPercent >= criticalPercent) throw new Error(`${label} 提醒阈值必须低于严重阈值`);
    if (item.adapter === "balance") {
      const provider = stringInRange(item.provider, 1, 128, `${label} provider`, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
      if (providers.has(provider)) throw new Error(`provider ${provider} 已绑定其他自定义平台`);
      providers.add(provider);
      let endpoint;
      try { endpoint = new URL(item.endpoint); }
      catch { throw new Error(`${label} 余额接口地址无效`); }
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || item.endpoint.length > 2048) throw new Error(`${label} 余额接口必须使用不含凭据的 HTTPS 地址`);
      if (!["bearer", "x-api-key"].includes(item.auth)) throw new Error(`${label} 认证方式无效`);
      stringInRange(item.totalPath, 1, 256, `${label} 余额路径`);
      if (item.currencyPath) stringInRange(item.currencyPath, 1, 256, `${label} 币种路径`);
      stringInRange(item.currency, 3, 8, `${label} 币种`, /^[A-Za-z0-9_-]+$/);
      return {
        id, label, adapter: "balance", provider, enabled: item.enabled,
        warningPercent, criticalPercent, showResetCountdown: item.showResetCountdown, showQueriedAt: item.showQueriedAt,
        endpoint: endpoint.href, auth: item.auth, totalPath: item.totalPath, currencyPath: item.currencyPath, currency: item.currency.toUpperCase(),
      };
    }
    if (builtins.has(item.adapter)) throw new Error(`内置平台 ${label} 重复`);
    builtins.add(item.adapter);
    if (item.provider || item.endpoint || item.totalPath || item.currencyPath) throw new Error(`${label} 是内置平台，不能绑定自定义接口`);
    return {
      id, label, adapter: item.adapter, provider: "",
      enabled: item.enabled,
      warningPercent,
      criticalPercent,
      showResetCountdown: item.showResetCountdown,
      showQueriedAt: item.showQueriedAt,
      endpoint: "", auth: "bearer", totalPath: "", currencyPath: "", currency: "CNY",
    };
  });
  return { pollIntervalMs, idlePollIntervalMs, cacheTtlMs, requestTimeoutMs, platforms };
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

async function readSettings(path) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return { settings: cloneDefaults(), revision: "absent" };
    throw error;
  }
  if (Buffer.byteLength(text) > 32768) throw new Error("设置文件过大");
  return { settings: validateSettings(JSON.parse(text)), revision: createHash("sha256").update(text).digest("hex") };
}

function readSettingsSync(path) {
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return { settings: cloneDefaults(), revision: "absent" };
    throw error;
  }
  if (Buffer.byteLength(text) > 32768) throw new Error("设置文件过大");
  return { settings: validateSettings(JSON.parse(text)), revision: createHash("sha256").update(text).digest("hex") };
}

async function saveSettings(settings, path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.settings-${randomUUID()}.tmp`);
  let file;
  let owned = false;
  try {
    file = await open(temporary, "wx", 0o600);
    owned = true;
    await file.writeFile(`${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await file.close();
    file = undefined;
    await rename(temporary, path);
    owned = false;
  } finally {
    if (file) await file.close().catch(() => {});
    if (owned) await unlink(temporary).catch(() => {});
  }
}

export function createSettingsStore(path = settingsPath()) {
  let cached;
  let loading;
  let writes = Promise.resolve();

  async function refresh() {
    if (loading) return loading;
    loading = readSettings(path).then((snapshot) => {
      cached = snapshot;
      return snapshot;
    }).finally(() => { loading = undefined; });
    return loading;
  }

  async function get() {
    await writes;
    if (!cached) cached = readSettingsSync(path);
    return cached;
  }

  async function save(input, expectedRevision) {
    const settings = validateSettings(input);
    const operation = writes.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const db = new DatabaseSync(`${path}.lock.sqlite`);
      try {
        try { db.exec("BEGIN IMMEDIATE"); }
        catch (error) {
          if (error.errcode === 5 || error.errcode === 6) return null;
          throw error;
        }
        const current = await readSettings(path);
        if (current.revision !== expectedRevision) return null;
        await saveSettings(settings, path);
        const saved = await readSettings(path);
        cached = saved;
        return saved;
      } finally {
        if (db.isTransaction) db.exec("ROLLBACK");
        db.close();
      }
    });
    writes = operation.catch(() => {});
    return operation;
  }

  return { get, refresh, save };
}

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function sameAuthorityOrigin(origin, host) {
  if (typeof host !== "string" || !host) return false;
  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
    return originUrl.host === new URL(`${originUrl.protocol}//${host}`).host;
  } catch { return false; }
}

export function settingsHandler(store = createSettingsStore(), onSave = () => {}) {
  return async (request) => {
    try {
      if (request.method === "GET") return response(200, { ok: true, ...await store.refresh() });
      if (request.method !== "POST") return response(405, { ok: false, error: "不支持的请求方法" });
      const origin = request.headers.get("origin");
      if ((origin && !sameAuthorityOrigin(origin, request.headers.get("host"))) || request.headers.get("sec-fetch-site") === "cross-site") return response(403, { ok: false, error: "禁止跨站请求" });
      if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") || "")) return response(415, { ok: false, error: "请求必须使用 JSON" });
      const text = await request.text();
      if (Buffer.byteLength(text) > 32768) return response(413, { ok: false, error: "设置内容过大" });
      let body;
      try { body = JSON.parse(text); } catch { return response(400, { ok: false, error: "请求体不是有效 JSON" }); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2
        || !Object.hasOwn(body, "settings") || typeof body.revision !== "string" || body.revision.length > 64) {
        return response(400, { ok: false, error: "无效的设置请求，请刷新页面" });
      }
      let settings;
      try { settings = validateSettings(body.settings); } catch (error) { return response(400, { ok: false, error: error.message }); }
      const saved = await store.save(settings, body.revision);
      if (!saved) return response(409, { ok: false, error: "设置已被其他窗口或 Host 修改，请重新加载后再保存" });
      onSave(saved.settings);
      return response(200, { ok: true, ...saved });
    } catch {
      return response(500, { ok: false, error: "设置读取或保存失败，请检查本地设置文件" });
    }
  };
}

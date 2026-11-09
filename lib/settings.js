import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MODEL_SOURCES = Object.freeze([
  Object.freeze({ id: "codex", label: "Codex" }),
  Object.freeze({ id: "grok", label: "Grok" }),
  Object.freeze({ id: "opencodeGo", label: "OpenCode Go" }),
  Object.freeze({ id: "deepseek", label: "DeepSeek" }),
  Object.freeze({ id: "zai", label: "智谱" }),
]);

const MODEL_DEFAULTS = Object.freeze({
  enabled: true,
  warningPercent: 70,
  criticalPercent: 90,
  showResetCountdown: true,
  showQueriedAt: true,
});

export const DEFAULT_SETTINGS = Object.freeze({
  pollIntervalMs: 2000,
  idlePollIntervalMs: 30000,
  cacheTtlMs: 180000,
  requestTimeoutMs: 15000,
  models: Object.freeze(Object.fromEntries(MODEL_SOURCES.map(({ id, label }) => [
    id,
    Object.freeze({ ...MODEL_DEFAULTS, label }),
  ]))),
});

const ROOT_KEYS = Object.freeze(["pollIntervalMs", "idlePollIntervalMs", "cacheTtlMs", "requestTimeoutMs", "models"]);
const MODEL_KEYS = Object.freeze(["label", "enabled", "warningPercent", "criticalPercent", "showResetCountdown", "showQueriedAt"]);

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

export function validateSettings(value) {
  exactObject(value, ROOT_KEYS, "设置");
  exactObject(value.models, MODEL_SOURCES.map(({ id }) => id), "模型设置");
  const pollIntervalMs = integerInRange(value.pollIntervalMs, 1000, 60000, "刷新间隔");
  const idlePollIntervalMs = integerInRange(value.idlePollIntervalMs, 5000, 300000, "未支持模型刷新间隔");
  if (idlePollIntervalMs < pollIntervalMs) throw new Error("未支持模型刷新间隔不能小于普通刷新间隔");
  const cacheTtlMs = integerInRange(value.cacheTtlMs, 10000, 1800000, "缓存时间");
  const requestTimeoutMs = integerInRange(value.requestTimeoutMs, 1000, 30000, "请求超时");
  const models = {};
  for (const source of MODEL_SOURCES) {
    const item = value.models[source.id];
    exactObject(item, MODEL_KEYS, `${source.label} 设置`);
    if (typeof item.label !== "string" || !item.label.trim() || item.label.trim().length > 24) throw new Error(`${source.label} 显示名称必须为 1–24 个字符`);
    if (typeof item.enabled !== "boolean" || typeof item.showResetCountdown !== "boolean" || typeof item.showQueriedAt !== "boolean") throw new Error(`${source.label} 开关无效`);
    const warningPercent = percentage(item.warningPercent, 0, 99.9, `${source.label} 提醒阈值`);
    const criticalPercent = percentage(item.criticalPercent, 0.1, 100, `${source.label} 严重阈值`);
    if (warningPercent >= criticalPercent) throw new Error(`${source.label} 提醒阈值必须低于严重阈值`);
    models[source.id] = {
      label: item.label.trim(),
      enabled: item.enabled,
      warningPercent,
      criticalPercent,
      showResetCountdown: item.showResetCountdown,
      showQueriedAt: item.showQueriedAt,
    };
  }
  return { pollIntervalMs, idlePollIntervalMs, cacheTtlMs, requestTimeoutMs, models };
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

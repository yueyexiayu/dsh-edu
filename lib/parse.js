/** Parse Codex usage, SuperGrok billing, DeepSeek and Zhipu balances. No credentials in this module. */

const WINDOW_NAMES = {
  18000: { key: "5h", label: "5小时" },
  604800: { key: "7d", label: "7天" },
  2592000: { key: "30d", label: "30天" },
};

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CODEX_RECORD_KEY = "llm-pi-ai/openai-codex";
export const GROK_RECORD_KEY = "llm-pi-ai/xai";
export const GROK_USER_URL = "https://cli-chat-proxy.grok.com/v1/user";
export const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
export const DEEPSEEK_API_KEY_REF = "DEEPSEEK_API_KEY";
export const ZAI_ACCOUNT_REPORT_PATH = "/api/biz/account/query-customer-account-report";
export const ZAI_TOKEN_ACCOUNTS_PATH = "/api/biz/tokenAccounts/list/my?pageNum=1&pageSize=100";
export const ZAI_ROUTES = {
  "zai-coding-cn": { base: "https://open.bigmodel.cn", keyRef: "ZAI_CODING_CN_API_KEY" },
  zai: { base: "https://api.z.ai", keyRef: "ZAI_API_KEY" },
};
export const OPENCODE_GO_HOST = "opencode.ai";
export const OPENCODE_GO_PATH_PREFIX = "/inference/go";
export const OPENCODE_GO_PROVIDER = "opencode-go";
export const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
export const API_PATH = "/api/dsh-edu";

export function isDeepSeekProvider(provider) {
  return provider === "deepseek-official" || provider === "deepseek-vision" || provider === "deepseek";
}

export function zaiRouteFor(provider) {
  return typeof provider === "string" && Object.hasOwn(ZAI_ROUTES, provider) ? ZAI_ROUTES[provider] : null;
}

function officialGoEndpoint(base) {
  let url;
  try { url = new URL(base); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.hostname !== OPENCODE_GO_HOST) return false;
  return url.pathname === OPENCODE_GO_PATH_PREFIX || url.pathname.startsWith(`${OPENCODE_GO_PATH_PREFIX}/`);
}

// OpenCode Go can be either a user-declared OpenAI/Anthropic-compatible route or
// the adapter's own shipped `opencode-go` route, so the provider id alone cannot
// decide. The effective endpoint decides: the profile's explicit `baseURL` when
// present, otherwise the adapter's reported default for that route. A custom
// gateway overriding either stays unattributed, and an explicit override is
// never displaced by the shipped default.
export function opencodeGoRouteFor(config, { provider, defaultBaseURL } = {}) {
  const explicit = asObject(config)?.baseURL;
  const endpoint = typeof explicit === "string" && explicit.trim() ? explicit
    : typeof defaultBaseURL === "string" && defaultBaseURL.trim() ? defaultBaseURL : null;
  if (endpoint !== null) return officialGoEndpoint(endpoint) ? { base: `https://${OPENCODE_GO_HOST}` } : null;
  // A shipped route that sets no endpoint of its own is its own evidence.
  return provider === OPENCODE_GO_PROVIDER ? { base: `https://${OPENCODE_GO_HOST}` } : null;
}

export function toNum(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function windowName(seconds) {
  const duration = toNum(seconds);
  if (!Number.isSafeInteger(duration) || duration <= 0) return null;
  const known = WINDOW_NAMES[duration];
  if (known) return known;
  const hours = Math.floor(duration / 3600);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return { key: `${days}d`, label: `${days}天` };
  }
  return { key: `${hours}h`, label: `${hours}小时` };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function parseUsageBody(body) {
  const root = asObject(body);
  if (!root) return { ok: false, error: "响应不是对象" };
  const rateLimit = asObject(root.rate_limit);
  if (!rateLimit) return { ok: false, error: "响应缺少 rate_limit" };

  const windows = [];
  for (const raw of [rateLimit.primary_window, rateLimit.secondary_window]) {
    if (raw === null || raw === undefined) continue;
    if (!asObject(raw)) return { ok: false, error: "用量窗口不是对象" };
    const used = toNum(raw.used_percent);
    if (used === null || used < 0 || used > 100) return { ok: false, error: "用量百分比无效" };
    const name = windowName(raw.limit_window_seconds);
    if (!name) return { ok: false, error: "用量窗口时长无效" };
    let resetsAt = null;
    if (raw.reset_at !== null && raw.reset_at !== undefined) {
      const resetSecs = toNum(raw.reset_at);
      const resetMs = resetSecs === null ? NaN : resetSecs * 1000;
      if (resetSecs === null || resetSecs < 0 || !Number.isFinite(resetMs) || resetMs > 8.64e15) {
        return { ok: false, error: "用量重置时间无效" };
      }
      resetsAt = new Date(resetMs).toISOString();
    }
    windows.push({ key: name.key, label: name.label, utilization: used, resetsAt });
  }
  if (!windows.length) return { ok: false, error: "响应缺少用量窗口" };

  const planType = typeof root.plan_type === "string" && root.plan_type ? root.plan_type : null;
  return { ok: true, windows, planType };
}

export function grokRequestHeaders(userId) {
  const headers = {
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-grok-client-version": "0.1.0",
    "x-grok-client-mode": "headless",
  };
  if (typeof userId === "string" && userId) headers["x-userid"] = userId;
  return headers;
}

export function grokUserIdFromBody(body) {
  const root = asObject(body);
  const userId = root && root.userId;
  return typeof userId === "string" && userId ? userId : null;
}

function zaiBusinessError(root) {
  if (root.success === false || (root.code !== undefined && toNum(root.code) !== 200)) {
    const message = typeof root.msg === "string" && root.msg ? root.msg : root.message;
    return typeof message === "string" && message ? message : "接口返回业务失败";
  }
  return null;
}

export function parseDeepSeekBalance(body) {
  const root = asObject(body);
  if (!root) return { ok: false, error: "响应不是对象" };
  const infos = Array.isArray(root.balance_infos) ? root.balance_infos : [];
  const preferred = infos.find((item) => item && item.currency === "CNY") || infos[0];
  const info = asObject(preferred);
  if (!info) return { ok: false, error: "响应缺少余额" };
  const total = toNum(info.total_balance);
  if (total === null) return { ok: false, error: "响应缺少总余额" };
  for (const field of ["granted_balance", "topped_up_balance"]) {
    if (info[field] !== null && info[field] !== undefined && toNum(info[field]) === null) {
      return { ok: false, error: `余额字段 ${field} 无效` };
    }
  }
  const currency = typeof info.currency === "string" && info.currency ? info.currency : "CNY";
  return {
    ok: true,
    windows: null,
    balance: {
      currency,
      total,
      granted: toNum(info.granted_balance),
      toppedUp: toNum(info.topped_up_balance),
      available: root.is_available === true,
    },
    planType: null,
  };
}

export function parseZaiAccountReport(body) {
  const root = asObject(body);
  if (!root) return { ok: false, error: "响应不是对象" };
  const businessError = zaiBusinessError(root);
  if (businessError) return { ok: false, error: businessError };
  const data = asObject(root.data);
  if (!data) return { ok: false, error: "响应缺少 data" };
  const total = toNum(data.availableBalance ?? data.balance);
  if (total === null) return { ok: false, error: "响应缺少有效可用余额" };
  for (const field of ["giveAmount", "rechargeAmount", "frozenBalance", "totalSpendAmount"]) {
    if (data[field] === null || data[field] === undefined) continue;
    const value = toNum(data[field]);
    if (value === null || value < 0) return { ok: false, error: `余额字段 ${field} 无效` };
  }
  return {
    ok: true,
    windows: null,
    balance: {
      currency: "CNY",
      total,
      granted: toNum(data.giveAmount),
      toppedUp: toNum(data.rechargeAmount),
      frozen: toNum(data.frozenBalance),
      spent: toNum(data.totalSpendAmount),
      available: true,
    },
    planType: null,
  };
}

export function parseZaiTokenPackages(body) {
  const root = asObject(body);
  if (!root) return { ok: false, error: "响应不是对象" };
  const businessError = zaiBusinessError(root);
  if (businessError) return { ok: false, error: businessError };
  if (!Array.isArray(root.rows)) return { ok: false, error: "资源包响应缺少 rows 数组" };
  const packages = [];
  for (const raw of root.rows) {
    const row = asObject(raw);
    if (!row || typeof row.status !== "string" || !row.status.trim()) {
      return { ok: false, error: "资源包记录或状态无效" };
    }
    if (row.status !== "EFFECTIVE") continue;
    const remaining = toNum(row.tokenBalance);
    if (!Number.isSafeInteger(remaining) || remaining < 0) return { ok: false, error: "资源包剩余 Token 无效" };
    const total = toNum(row.tokensMagnitude);
    if (row.tokensMagnitude !== null && row.tokensMagnitude !== undefined &&
        (!Number.isSafeInteger(total) || total < 0 || remaining > total)) {
      return { ok: false, error: "资源包总 Token 无效" };
    }
    packages.push({
      name: typeof row.resourcePackageName === "string" && row.resourcePackageName.trim() ? row.resourcePackageName : "Token 资源包",
      remaining,
      total,
    });
  }
  return { ok: true, packages };
}

export function parseGrokBilling(body) {
  const root = asObject(body);
  if (!root) return { ok: false, error: "响应不是对象" };
  const config = asObject(root.config);
  if (!config) return { ok: false, error: "响应缺少 config" };
  const period = asObject(config.currentPeriod);
  if (config.currentPeriod !== null && config.currentPeriod !== undefined && !period) {
    return { ok: false, error: "周用量周期无效" };
  }
  let rawUsed = config.creditUsagePercent;
  if (rawUsed === null || rawUsed === undefined) {
    if (config.productUsage !== null && config.productUsage !== undefined && !Array.isArray(config.productUsage)) {
      return { ok: false, error: "产品用量列表无效" };
    }
    const build = config.productUsage?.find((item) => asObject(item) && item.product === "GrokBuild");
    rawUsed = build?.usagePercent;
  }
  const used = toNum(rawUsed);
  if (used === null || used < 0 || used > 100) return { ok: false, error: "响应缺少有效周用量百分比" };
  const end = period?.end ?? config.billingPeriodEnd;
  let resetsAt = null;
  if (end !== null && end !== undefined) {
    const resetMs = typeof end === "string" && end.trim() ? Date.parse(end) : NaN;
    if (!Number.isFinite(resetMs) || resetMs < 0) return { ok: false, error: "周用量重置时间无效" };
    resetsAt = new Date(resetMs).toISOString();
  }
  return {
    ok: true,
    windows: [{ key: "7d", label: "7天", utilization: used, resetsAt }],
    planType: null,
  };
}

const OPENCODE_GO_WINDOWS = [
  { key: "5h", label: "5小时", field: "rolling", legacy: "rollingUsage" },
  { key: "7d", label: "7天", field: "weekly", legacy: "weeklyUsage" },
  { key: "30d", label: "30天", field: "monthly", legacy: "monthlyUsage" },
];

// The Go usage endpoint moved from top-level rollingUsage/weeklyUsage/monthlyUsage
// to a nested usage object while staying account-level. Accept both shapes and
// never turn an unreadable window into 0%.
export function parseOpencodeGoUsage(body, now = Date.now()) {
  const root = asObject(body);
  if (!root) return { ok: false, error: "响应不是对象" };
  const usage = asObject(root.usage) ?? root;
  const windows = [];
  for (const spec of OPENCODE_GO_WINDOWS) {
    const raw = usage[spec.field] ?? root[spec.legacy];
    if (raw === null || raw === undefined) continue;
    const item = asObject(raw);
    if (!item) return { ok: false, error: `用量窗口 ${spec.label} 不是对象` };
    const used = toNum(item.percent ?? item.usagePercent);
    if (used === null || used < 0 || used > 100) return { ok: false, error: `用量窗口 ${spec.label} 百分比无效` };
    let resetsAt = null;
    if (item.resetsAt !== null && item.resetsAt !== undefined) {
      if (typeof item.resetsAt !== "string" || !item.resetsAt.trim()) {
        return { ok: false, error: `用量窗口 ${spec.label} 重置时间无效` };
      }
      const resetMs = Date.parse(item.resetsAt);
      if (!Number.isFinite(resetMs)) return { ok: false, error: `用量窗口 ${spec.label} 重置时间无效` };
      resetsAt = new Date(resetMs).toISOString();
    } else if (item.resetInSec !== null && item.resetInSec !== undefined) {
      const resetInSec = toNum(item.resetInSec);
      if (resetInSec === null || resetInSec < 0) return { ok: false, error: `用量窗口 ${spec.label} 重置时间无效` };
      resetsAt = new Date(now + resetInSec * 1000).toISOString();
    }
    windows.push({ key: spec.key, label: spec.label, utilization: used, resetsAt });
  }
  if (!windows.length) return { ok: false, error: "响应缺少用量窗口" };
  return { ok: true, windows, balance: null, planType: "OpenCode Go" };
}

export function oauthAccessFromRecord(record, productLabel) {
  if (!record || record.kind !== "grant" || !record.payload || typeof record.payload !== "object") {
    return { ok: false, error: `未登录 ${productLabel}` };
  }
  const payload = record.payload;
  const access = typeof payload.access === "string" && payload.access ? payload.access : null;
  if (!access) return { ok: false, error: `${productLabel} OAuth 缺少 access token` };
  return { ok: true, access, payload };
}

export function oauthFromRecord(record) {
  const base = oauthAccessFromRecord(record, "ChatGPT / Codex");
  if (!base.ok) return base;
  const payload = base.payload;
  let accountId =
    (typeof payload.accountId === "string" && payload.accountId) ||
    (typeof payload.chatgpt_account_id === "string" && payload.chatgpt_account_id) ||
    null;
  if (!accountId) accountId = accountIdFromJwt(base.access);
  return { ok: true, access: base.access, accountId };
}

export function accountIdFromJwt(access) {
  try {
    const parts = String(access).split(".");
    if (parts.length < 2) return null;
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const auth = json && json["https://api.openai.com/auth"];
    const id = auth && auth.chatgpt_account_id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

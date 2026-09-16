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
export const API_PATH = "/api/dsh-edu";

export function isDeepSeekProvider(provider) {
  return provider === "deepseek-official" || provider === "deepseek-vision" || provider === "deepseek";
}

export function zaiRouteFor(provider) {
  return ZAI_ROUTES[provider] || null;
}

export function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function windowName(seconds) {
  const known = WINDOW_NAMES[seconds];
  if (known) return known;
  const hours = Math.floor((seconds || 0) / 3600);
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
  if (!body || typeof body !== "object") return { ok: false, error: "响应不是对象" };
  const rateLimit = body.rate_limit;
  if (!rateLimit || typeof rateLimit !== "object") return { ok: false, error: "响应缺少 rate_limit" };

  const windows = [];
  for (const raw of [rateLimit.primary_window, rateLimit.secondary_window]) {
    if (!raw || typeof raw !== "object") continue;
    const used = toNum(raw.used_percent);
    if (used === null) continue;
    const seconds = toNum(raw.limit_window_seconds);
    const name = windowName(seconds ?? 0);
    const resetSecs = toNum(raw.reset_at);
    windows.push({
      key: name.key,
      label: name.label,
      utilization: used,
      resetsAt: resetSecs === null ? null : new Date(resetSecs * 1000).toISOString(),
    });
  }
  if (!windows.length) return { ok: false, error: "响应缺少用量窗口" };

  const planType = typeof body.plan_type === "string" && body.plan_type ? body.plan_type : null;
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

function grokResetIso(config, period) {
  const end = (period && typeof period.end === "string" && period.end) ||
    (typeof config.billingPeriodEnd === "string" && config.billingPeriodEnd) ||
    null;
  if (!end) return null;
  const ms = Date.parse(end);
  return ms === ms ? new Date(ms).toISOString() : null;
}

function grokWeeklyUsed(config, period) {
  let used = toNum(config.creditUsagePercent);
  if (used === null && Array.isArray(config.productUsage)) {
    const build = config.productUsage.find((item) => item && item.product === "GrokBuild");
    used = build ? toNum(build.usagePercent) : null;
  }
  const weekly = period && typeof period.type === "string" && period.type.toUpperCase().includes("WEEK");
  if (used === null && weekly && config.creditUsagePercent === undefined && config.used === undefined) {
    used = 0;
  }
  if (used === null) return null;
  if (used < 0) return 0;
  if (used > 100) return 100;
  return used;
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
  if (root.success === false || (root.code !== undefined && root.code !== 200)) {
    return { ok: false, error: String(root.msg || `接口返回 code ${root.code}`) };
  }
  const data = asObject(root.data);
  if (!data) return { ok: false, error: "响应缺少 data" };
  const total = toNum(data.availableBalance ?? data.balance);
  if (total === null) return { ok: false, error: "响应缺少可用余额" };
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
  if (!root) return [];
  const rows = Array.isArray(root.rows) ? root.rows : [];
  const packages = [];
  for (const raw of rows) {
    const row = asObject(raw);
    if (!row) continue;
    if (row.status !== "EFFECTIVE") continue;
    const remaining = toNum(row.tokenBalance);
    if (remaining === null) continue;
    packages.push({
      name: typeof row.resourcePackageName === "string" && row.resourcePackageName ? row.resourcePackageName : "Token 资源包",
      remaining,
      total: toNum(row.tokensMagnitude),
    });
  }
  return packages;
}

export function parseGrokBilling(body) {
  const root = asObject(body);
  if (!root) return { ok: false, error: "响应不是对象" };
  const config = asObject(root.config);
  if (!config) return { ok: false, error: "响应缺少 config" };
  const period = asObject(config.currentPeriod);
  const used = grokWeeklyUsed(config, period);
  if (used === null) return { ok: false, error: "响应缺少周用量" };
  return {
    ok: true,
    windows: [{
      key: "7d",
      label: "7天",
      utilization: used,
      resetsAt: grokResetIso(config, period),
    }],
    planType: null,
  };
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

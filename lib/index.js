import {
  API_PATH,
  CODEX_RECORD_KEY,
  CODEX_USAGE_URL,
  DEEPSEEK_API_KEY_REF,
  DEEPSEEK_BALANCE_URL,
  GROK_BILLING_URL,
  GROK_RECORD_KEY,
  GROK_USER_URL,
  ZAI_ACCOUNT_REPORT_PATH,
  ZAI_TOKEN_ACCOUNTS_PATH,
  grokRequestHeaders,
  grokUserIdFromBody,
  isDeepSeekProvider,
  oauthAccessFromRecord,
  oauthFromRecord,
  parseDeepSeekBalance,
  parseGrokBilling,
  parseUsageBody,
  parseZaiAccountReport,
  parseZaiTokenPackages,
  zaiRouteFor,
} from "./parse.js";

export const name = "dsh-edu";
export const inject = ["connection", "credentials"];

const CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const CODEX_PROVIDER = "openai-codex";
const GROK_PROVIDER = "xai";

function currentSelection(ctx, sessionId) {
  if (sessionId) {
    try {
      const agents = ctx.get("agents");
      const agent = agents && agents.get(String(sessionId));
      const header = agent && agent.session ? agent.session.requestHeader() : null;
      const cfg = header && header.config;
      if (cfg && typeof cfg.provider === "string") {
        return { provider: cfg.provider, model: typeof cfg.model === "string" ? cfg.model : null };
      }
    } catch {
      // fall through
    }
  }
  try {
    const agentDefaultModel = ctx.get("agentDefaultModel");
    const sel = agentDefaultModel && agentDefaultModel.currentSelection && agentDefaultModel.currentSelection();
    if (sel && typeof sel.provider === "string") {
      return { provider: sel.provider, model: typeof sel.model === "string" ? sel.model : null };
    }
  } catch {
    // fall through
  }
  try {
    const settings = ctx.get("settings");
    const sel = settings && settings.get && settings.get("agent-default-model");
    if (sel && typeof sel.provider === "string") {
      return { provider: sel.provider, model: typeof sel.model === "string" ? sel.model : null };
    }
  } catch {
    // ignore
  }
  return { provider: null, model: null };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function fetchJson(url, headers) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : "用量接口请求失败" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, expired: true, error: `用量接口 HTTP ${response.status}` };
  }
  if (!response.ok) {
    return { ok: false, error: `用量接口 HTTP ${response.status}` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, error: "用量接口返回的不是 JSON" };
  }
}

export function apply(ctx) {
  const caches = Object.create(null);

  function cacheFor(provider) {
    if (!caches[provider]) caches[provider] = { fetchedAt: 0, status: null };
    return caches[provider];
  }

  async function queryCodexUsage() {
    let record;
    try {
      record = await ctx.credentials.readRecord(CODEX_RECORD_KEY);
    } catch {
      return { ok: false, error: "读取 Codex 凭据失败" };
    }
    const oauth = oauthFromRecord(record);
    if (!oauth.ok) return oauth;

    const headers = {
      authorization: `Bearer ${oauth.access}`,
      accept: "application/json",
      "user-agent": "codex-cli",
    };
    if (oauth.accountId) headers["chatgpt-account-id"] = oauth.accountId;

    const fetched = await fetchJson(CODEX_USAGE_URL, headers);
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "凭证已过期，请先用 GPT 发一条消息让 DSH 续期后再刷新" };
      return fetched;
    }
    return parseUsageBody(fetched.body);
  }

  async function queryGrokUsage() {
    let record;
    try {
      record = await ctx.credentials.readRecord(GROK_RECORD_KEY);
    } catch {
      return { ok: false, error: "读取 Grok 凭据失败" };
    }
    const oauth = oauthAccessFromRecord(record, "Grok");
    if (!oauth.ok) return oauth;

    const headers = {
      authorization: `Bearer ${oauth.access}`,
      accept: "application/json",
      "user-agent": "dsh-edu",
      ...grokRequestHeaders(),
    };
    const identity = await fetchJson(GROK_USER_URL, headers);
    if (!identity.ok) {
      if (identity.expired) return { ok: false, error: "凭证已过期，请先用 Grok 发一条消息让 DSH 续期后再刷新" };
      return identity;
    }
    const userId = grokUserIdFromBody(identity.body);
    if (!userId) return { ok: false, error: "Grok 账号身份无法确认" };

    const billing = await fetchJson(GROK_BILLING_URL, {
      ...headers,
      ...grokRequestHeaders(userId),
    });
    if (!billing.ok) {
      if (billing.expired) return { ok: false, error: "凭证已过期，请先用 Grok 发一条消息让 DSH 续期后再刷新" };
      return billing;
    }
    return parseGrokBilling(billing.body);
  }

  async function queryDeepSeekBalance() {
    let hit;
    try {
      hit = await ctx.credentials.resolve(DEEPSEEK_API_KEY_REF);
    } catch {
      return { ok: false, error: "读取 DeepSeek 凭据失败" };
    }
    if (!hit || typeof hit.value !== "string" || !hit.value) {
      return { ok: false, error: "未配置 DEEPSEEK_API_KEY" };
    }

    const fetched = await fetchJson(DEEPSEEK_BALANCE_URL, {
      authorization: `Bearer ${hit.value}`,
      accept: "application/json",
    });
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "DeepSeek API Key 无效或已过期" };
      return fetched;
    }
    return parseDeepSeekBalance(fetched.body);
  }

  async function queryZaiBalance(provider) {
    const route = zaiRouteFor(provider);
    if (!route) return { ok: false, error: `未知的智谱路由 ${provider}` };
    let hit;
    try {
      hit = await ctx.credentials.resolve(route.keyRef);
    } catch {
      return { ok: false, error: "读取智谱凭据失败" };
    }
    if (!hit || typeof hit.value !== "string" || !hit.value) {
      return { ok: false, error: `未配置 ${route.keyRef}` };
    }

    const fetched = await fetchJson(route.base + ZAI_ACCOUNT_REPORT_PATH, {
      authorization: `Bearer ${hit.value}`,
      accept: "application/json",
    });
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "智谱 API Key 无效或已过期" };
      return fetched;
    }
    const parsed = parseZaiAccountReport(fetched.body);
    if (!parsed.ok) return parsed;

    try {
      const packages = await fetchJson(route.base + ZAI_TOKEN_ACCOUNTS_PATH, {
        authorization: `Bearer ${hit.value}`,
        accept: "application/json",
      });
      if (packages.ok) parsed.balance.packages = parseZaiTokenPackages(packages.body);
    } catch {
      // 资源包列表失败不影响余额展示
    }
    return parsed;
  }

  async function getStatus(sessionId) {
    const sel = currentSelection(ctx, sessionId);
    const provider = sel.provider;
    const supported =
      provider === CODEX_PROVIDER ||
      provider === GROK_PROVIDER ||
      isDeepSeekProvider(provider) ||
      zaiRouteFor(provider) !== null;
    if (!supported) {
      return { ok: true, isSupported: false, provider, model: sel.model };
    }

    const now = Date.now();
    const cache = cacheFor(provider);
    if (cache.status && now - cache.fetchedAt < CACHE_TTL_MS) {
      return { ok: true, ...cache.status, provider, model: sel.model };
    }

    const result = isDeepSeekProvider(provider)
      ? await queryDeepSeekBalance()
      : provider === GROK_PROVIDER
        ? await queryGrokUsage()
        : zaiRouteFor(provider)
          ? await queryZaiBalance(provider)
          : await queryCodexUsage();
    const status = {
      isSupported: true,
      provider,
      model: sel.model,
      windows: result.ok ? result.windows : null,
      balance: result.ok ? result.balance || null : null,
      planType: result.ok ? result.planType : null,
      queriedAt: result.ok ? now : null,
      error: result.ok ? null : result.error,
    };
    cache.fetchedAt = now;
    cache.status = status;
    return { ok: true, ...status };
  }

  ctx.connection.fetch.register({
    path: API_PATH,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const url = new URL(request.url);
        const sessionId = url.searchParams.get("sessionId");
        return jsonResponse(200, await getStatus(sessionId));
      } catch (error) {
        return jsonResponse(500, {
          ok: false,
          error: error && error.message ? error.message : String(error),
        });
      }
    },
  });
}

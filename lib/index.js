import {
  API_PATH,
  CODEX_USAGE_URL,
  DEEPSEEK_BALANCE_URL,
  GROK_BILLING_URL,
  GROK_USER_URL,
  ZAI_ACCOUNT_REPORT_PATH,
  ZAI_TOKEN_ACCOUNTS_PATH,
  grokRequestHeaders,
  grokUserIdFromBody,
  isDeepSeekProvider,
  parseDeepSeekBalance,
  parseGrokBilling,
  parseUsageBody,
  parseZaiAccountReport,
  parseZaiTokenPackages,
  zaiRouteFor,
} from "./parse.js";
import { credentialSource } from "./credentials.js";

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
    const sel = settings?.describe({ redactSecrets: true }).find((row) => row.ns === "agent-default-model")?.value;
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

async function fetchJson(url, headers, signal) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
    });
  } catch {
    return { ok: false, error: "用量接口请求失败或超时" };
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
  const caches = new Map();
  let generation = 0;
  let disposed = false;
  function invalidate() {
    generation++;
    for (const entry of caches.values()) entry.controller.abort();
    caches.clear();
  }
  ctx.on("credentials/reference-updated", invalidate);
  ctx.on("credentials/record-updated", invalidate);
  ctx.on("app-boot/config-reload", invalidate);
  ctx.effect(() => () => { disposed = true; invalidate(); });

  async function queryCodexUsage({ oauth }, signal) {
    const headers = {
      authorization: `Bearer ${oauth.access}`,
      accept: "application/json",
      "user-agent": "codex-cli",
    };
    if (oauth.accountId) headers["chatgpt-account-id"] = oauth.accountId;

    const fetched = await fetchJson(CODEX_USAGE_URL, headers, signal);
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "凭证已过期，请先用 GPT 发一条消息让 DSH 续期后再刷新" };
      return fetched;
    }
    return parseUsageBody(fetched.body);
  }

  async function queryGrokUsage({ oauth }, signal) {
    const headers = {
      authorization: `Bearer ${oauth.access}`,
      accept: "application/json",
      "user-agent": "dsh-edu",
      ...grokRequestHeaders(),
    };
    const identity = await fetchJson(GROK_USER_URL, headers, signal);
    if (!identity.ok) {
      if (identity.expired) return { ok: false, error: "凭证已过期，请先用 Grok 发一条消息让 DSH 续期后再刷新" };
      return identity;
    }
    const userId = grokUserIdFromBody(identity.body);
    if (!userId) return { ok: false, error: "Grok 账号身份无法确认" };

    const billing = await fetchJson(GROK_BILLING_URL, {
      ...headers,
      ...grokRequestHeaders(userId),
    }, signal);
    if (!billing.ok) {
      if (billing.expired) return { ok: false, error: "凭证已过期，请先用 Grok 发一条消息让 DSH 续期后再刷新" };
      return billing;
    }
    return parseGrokBilling(billing.body);
  }

  async function queryDeepSeekBalance({ key }, signal) {
    const fetched = await fetchJson(DEEPSEEK_BALANCE_URL, {
      authorization: `Bearer ${key}`,
      accept: "application/json",
    }, signal);
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "DeepSeek API Key 无效或已过期" };
      return fetched;
    }
    return parseDeepSeekBalance(fetched.body);
  }

  async function queryZaiBalance(provider, { key }, signal) {
    const route = zaiRouteFor(provider);
    if (!route) return { ok: false, error: `未知的智谱路由 ${provider}` };
    const fetched = await fetchJson(route.base + ZAI_ACCOUNT_REPORT_PATH, {
      authorization: `Bearer ${key}`,
      accept: "application/json",
    }, signal);
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "智谱 API Key 无效或已过期" };
      return fetched;
    }
    const parsed = parseZaiAccountReport(fetched.body);
    if (!parsed.ok) return parsed;

    try {
      const packages = await fetchJson(route.base + ZAI_TOKEN_ACCOUNTS_PATH, {
        authorization: `Bearer ${key}`,
        accept: "application/json",
      }, signal);
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

    function status(result, queriedAt = null) {
      return {
        ok: true, isSupported: true, provider, model: sel.model,
        windows: result.ok ? result.windows : null,
        balance: result.ok ? result.balance || null : null,
        planType: result.ok ? result.planType : null,
        queriedAt: result.ok ? queriedAt : null,
        error: result.ok ? null : result.error,
      };
    }
    const changed = () => status({ ok: false, error: "账号或模型已切换，正在重新查询" });
    const started = generation;
    let source;
    try { source = await credentialSource(ctx, provider); }
    catch (error) {
      caches.get(provider)?.controller.abort();
      caches.delete(provider);
      return status({ ok: false, error: error.message });
    }
    if (disposed || started !== generation) return changed();
    const resolvedSelection = currentSelection(ctx, sessionId);
    if (resolvedSelection.provider !== provider || resolvedSelection.model !== sel.model) return changed();
    let entry = caches.get(provider);
    if (entry && entry.identity !== source.identity) {
      entry.controller.abort();
      caches.delete(provider);
      entry = undefined;
    }
    if (entry?.result && Date.now() - entry.fetchedAt < CACHE_TTL_MS) return status(entry.result, entry.fetchedAt);
    if (!entry?.promise) {
      entry = { identity: source.identity, controller: new AbortController() };
      caches.set(provider, entry);
      const captured = entry;
      entry.promise = (async () => {
        try {
          const signal = captured.controller.signal;
          const result = isDeepSeekProvider(provider) ? await queryDeepSeekBalance(source, signal)
            : provider === GROK_PROVIDER ? await queryGrokUsage(source, signal)
              : zaiRouteFor(provider) ? await queryZaiBalance(provider, source, signal)
                : await queryCodexUsage(source, signal);
          const latest = await credentialSource(ctx, provider);
          if (disposed || started !== generation || signal.aborted || latest.identity !== source.identity || caches.get(provider) !== captured) {
            return { ok: false, error: "账号或模型已切换，正在重新查询" };
          }
          if (!result.ok) {
            // Provider errors can echo credentials; never return those values.
            for (const secret of [source.key, source.oauth?.access, source.oauth?.accountId]) {
              if (secret && result.error) result.error = result.error.split(secret).join("[REDACTED_SECRET]");
            }
          } else {
            captured.result = result;
            captured.fetchedAt = Date.now();
          }
          return result;
        } catch {
          return { ok: false, error: "读取当前账号额度失败" };
        } finally {
          captured.promise = null;
          if (!captured.result && caches.get(provider) === captured) caches.delete(provider);
        }
      })();
    }
    const result = await entry.promise;
    const latestSelection = currentSelection(ctx, sessionId);
    if (disposed || started !== generation || latestSelection.provider !== provider || latestSelection.model !== sel.model) return changed();
    return status(result, entry.fetchedAt);
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
      } catch {
        return jsonResponse(500, {
          ok: false,
          error: "额度查询失败，请重试",
        });
      }
    },
  });
}

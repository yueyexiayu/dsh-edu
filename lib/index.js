import {
  API_PATH,
  CODEX_USAGE_URL,
  DEEPSEEK_BALANCE_URL,
  GROK_BILLING_URL,
  GROK_USER_URL,
  OPENCODE_GO_USAGE_URL,
  ZAI_ACCOUNT_REPORT_PATH,
  ZAI_TOKEN_ACCOUNTS_PATH,
  grokRequestHeaders,
  grokUserIdFromBody,
  isDeepSeekProvider,
  parseDeepSeekBalance,
  parseCustomBalance,
  parseGrokBilling,
  parseOpencodeGoUsage,
  parseUsageBody,
  parseZaiAccountReport,
  parseZaiTokenPackages,
  zaiRouteFor,
} from "./parse.js";
import { apiKeyCredentialSource, credentialSource, opencodeGoRoute } from "./credentials.js";
import { createSettingsStore, settingsHandler, settingsPath } from "./settings.js";

export const name = "dsh-edu";
export const inject = ["connection", "credentials", "llm"];

const PACKAGE_RETRY_MS = 30_000;
const CODEX_PROVIDER = "openai-codex";
const GROK_PROVIDER = "xai";

function modelSelection(value) {
  return value && typeof value.provider === "string" && value.provider
    ? { provider: value.provider, model: typeof value.model === "string" ? value.model : null }
    : null;
}

function currentSelection(ctx, sessionId) {
  if (sessionId) {
    try {
      const session = ctx.get("agents")?.get(String(sessionId))?.session;
      if (!session) return { provider: null, model: null, error: "当前会话不存在，无法确认模型" };
      const projections = ctx.get("sessionProjections");
      if (!projections) return { provider: null, model: null, error: "当前会话模型投影服务不可用" };
      const projection = projections.snapshot(session, ["modelSelection"]).values.modelSelection;
      if (!projection) return { provider: null, model: null, error: "当前会话模型投影未注册" };
      if (projection.next != null) {
        const next = modelSelection(projection.next);
        return next ?? { provider: null, model: null, error: "当前会话模型选择无效" };
      }
      const header = session.requestHeader();
      if (header !== undefined) {
        return modelSelection(header?.config) ?? { provider: null, model: null, error: "当前会话请求模型无效" };
      }
      // A real new session has no request header yet; official inference also
      // uses the default model here. Malformed headers never take this path.
    } catch {
      // A session read failure must not query an unrelated global account.
      return { provider: null, model: null, error: "读取当前会话模型失败" };
    }
  }
  try {
    const selected = modelSelection(ctx.get("agentDefaultModel")?.currentSelection());
    if (selected) return selected;
    const fallback = ctx.get("settings")?.describe({ redactSecrets: true }).find((row) => row.ns === "agent-default-model")?.value;
    return modelSelection(fallback) ?? { provider: null, model: null };
  } catch {
    return { provider: null, model: null, error: "读取默认模型失败" };
  }
}

function routeInfo(ctx, provider) {
  try {
    return opencodeGoRoute(ctx, provider);
  } catch {
    // A provider without a readable route is simply not attributable; never guess.
    return null;
  }
}

function quotaSourceFor(ctx, provider) {
  if (provider === CODEX_PROVIDER) return "codex";
  if (provider === GROK_PROVIDER) return "grok";
  if (isDeepSeekProvider(provider)) return "deepseek";
  if (zaiRouteFor(provider)) return "zai";
  return routeInfo(ctx, provider) !== null ? "opencodeGo" : null;
}

function platformForSelection(ctx, provider, platforms) {
  const custom = platforms.find((platform) => platform.adapter === "balance" && platform.provider === provider);
  if (custom) return custom;
  const source = quotaSourceFor(ctx, provider);
  return source ? platforms.find((platform) => platform.adapter === source) ?? null : null;
}

function configuredProviders(ctx) {
  const llm = ctx.get("llm");
  const configurable = typeof llm?.listConfigurableProviders === "function" ? llm.listConfigurableProviders() : [];
  const live = typeof llm?.listProviders === "function" ? llm.listProviders() : [];
  if (!Array.isArray(configurable)) throw new Error("DSH 模型提供方目录无效");
  const liveIds = new Set(Array.isArray(live) ? live.map((provider) => provider?.id).filter((id) => typeof id === "string") : []);
  const rows = configurable.map((provider) => {
    if (!provider || typeof provider.provider !== "string" || !provider.provider || typeof provider.displayName !== "string") throw new Error("DSH 模型提供方目录包含无效项");
    return {
      id: provider.provider,
      name: provider.displayName || provider.provider,
      live: liveIds.has(provider.provider),
      declared: provider.declared === true,
    };
  });
  return rows.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function redactResult(result, source) {
  const clean = { ...result };
  for (const field of ["error", "warning"]) {
    if (typeof clean[field] !== "string") continue;
    for (const secret of [source.key, source.oauth?.access, source.oauth?.accountId]) {
      if (secret) clean[field] = clean[field].split(secret).join("[REDACTED_SECRET]");
    }
  }
  return clean;
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

async function fetchJson(url, headers, signal, timeoutMs, redirect = "follow") {
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      redirect,
    });
  } catch {
    return { ok: false, error: "用量接口请求失败或超时" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, expired: true, status: response.status, error: `用量接口 HTTP ${response.status}` };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: `用量接口 HTTP ${response.status}` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, error: "用量接口返回的不是 JSON" };
  }
}

export function apply(ctx, { settingsFile = settingsPath() } = {}) {
  const caches = new Map();
  const settingsStore = createSettingsStore(settingsFile);
  let generation = 0;
  let credentialEpoch = 0;
  let disposed = false;
  function invalidate() {
    generation++;
    for (const entry of caches.values()) entry.controller.abort();
    caches.clear();
  }
  function credentialsChanged() {
    credentialEpoch += 1;
    invalidate();
  }
  ctx.on("credentials/reference-updated", credentialsChanged);
  ctx.on("credentials/record-updated", credentialsChanged);
  ctx.on("app-boot/config-reload", invalidate);
  ctx.effect(() => () => { disposed = true; invalidate(); });

  async function queryCodexUsage({ oauth }, signal, timeoutMs) {
    const headers = {
      authorization: `Bearer ${oauth.access}`,
      accept: "application/json",
      "user-agent": "codex-cli",
    };
    if (oauth.accountId) headers["chatgpt-account-id"] = oauth.accountId;

    const fetched = await fetchJson(CODEX_USAGE_URL, headers, signal, timeoutMs);
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "凭证已过期，请先用 GPT 发一条消息让 DSH 续期后再刷新" };
      return fetched;
    }
    return parseUsageBody(fetched.body);
  }

  async function queryGrokUsage({ oauth }, signal, timeoutMs) {
    const headers = {
      authorization: `Bearer ${oauth.access}`,
      accept: "application/json",
      "user-agent": "dsh-edu",
      ...grokRequestHeaders(),
    };
    const identity = await fetchJson(GROK_USER_URL, headers, signal, timeoutMs);
    if (!identity.ok) {
      if (identity.expired) return { ok: false, error: "凭证已过期，请先用 Grok 发一条消息让 DSH 续期后再刷新" };
      return identity;
    }
    const userId = grokUserIdFromBody(identity.body);
    if (!userId) return { ok: false, error: "Grok 账号身份无法确认" };

    const billing = await fetchJson(GROK_BILLING_URL, {
      ...headers,
      ...grokRequestHeaders(userId),
    }, signal, timeoutMs);
    if (!billing.ok) {
      if (billing.expired) return { ok: false, error: "凭证已过期，请先用 Grok 发一条消息让 DSH 续期后再刷新" };
      return billing;
    }
    return parseGrokBilling(billing.body);
  }

  async function queryOpencodeGoUsage({ key }, signal, timeoutMs) {
    const fetched = await fetchJson(OPENCODE_GO_USAGE_URL, {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "user-agent": "dsh-edu",
    }, signal, timeoutMs);
    if (!fetched.ok) {
      if (fetched.status === 401) return { ok: false, error: "OpenCode API Key 无效或已过期" };
      if (fetched.status === 403) return { ok: false, error: "当前 API Key 未订阅 OpenCode Go，或套餐已失效" };
      return fetched;
    }
    return parseOpencodeGoUsage(fetched.body);
  }

  async function queryDeepSeekBalance({ key }, signal, timeoutMs) {
    const fetched = await fetchJson(DEEPSEEK_BALANCE_URL, {
      authorization: `Bearer ${key}`,
      accept: "application/json",
    }, signal, timeoutMs);
    if (!fetched.ok) {
      if (fetched.expired) return { ok: false, error: "DeepSeek API Key 无效或已过期" };
      return fetched;
    }
    return parseDeepSeekBalance(fetched.body);
  }

  async function queryCustomBalance(platform, { key }, signal, timeoutMs) {
    const headers = {
      accept: "application/json",
      "user-agent": "dsh-edu",
    };
    if (platform.auth === "bearer") headers.authorization = `Bearer ${key}`;
    else headers["x-api-key"] = key;
    const fetched = await fetchJson(platform.endpoint, headers, signal, timeoutMs, "manual");
    if (!fetched.ok) {
      if (fetched.status === 401 || fetched.status === 403) return { ok: false, error: "余额接口认证失败，请检查 DSH 中的 API Key" };
      return fetched;
    }
    return parseCustomBalance(fetched.body, platform);
  }

  const fresh = (part, ttlMs) => part?.result.ok && Date.now() - part.fetchedAt < ttlMs;
  const packagesReady = (part, ttlMs) => fresh(part, ttlMs) || (part?.result.ok === false && Date.now() < part.retryAt);

  function zaiResult(cash, packages) {
    if (!cash.result.ok) return cash.result;
    return {
      ...cash.result,
      balance: { ...cash.result.balance, packages: packages.result.ok ? packages.result.packages : null },
      warning: packages.result.ok ? null : `智谱资源包查询失败：${packages.result.error}`,
      retryAt: packages.result.ok ? null : packages.retryAt,
    };
  }

  async function queryZaiBalance(provider, source, entry, preferences) {
    const route = zaiRouteFor(provider);
    const headers = { authorization: `Bearer ${source.key}`, accept: "application/json" };
    async function queryPart(path, parse) {
      let result;
      try {
        const fetched = await fetchJson(route.base + path, headers, entry.controller.signal, preferences.requestTimeoutMs);
        result = fetched.ok ? parse(fetched.body)
          : fetched.expired ? { ok: false, error: "智谱 API Key 无效或已过期" } : fetched;
      } catch {
        result = { ok: false, error: "智谱接口响应解析失败" };
      }
      const fetchedAt = Date.now();
      return { result: redactResult(result, source), fetchedAt, retryAt: result.ok ? null : fetchedAt + PACKAGE_RETRY_MS };
    }
    // Each successful component has its own TTL. A package failure must not be
    // hidden behind the cash TTL, and must not cause another cash request.
    const [cash, packages] = await Promise.all([
      fresh(entry.cash, preferences.cacheTtlMs) ? entry.cash : queryPart(ZAI_ACCOUNT_REPORT_PATH, parseZaiAccountReport),
      packagesReady(entry.packages, preferences.cacheTtlMs) ? entry.packages : queryPart(ZAI_TOKEN_ACCOUNTS_PATH, parseZaiTokenPackages),
    ]);
    return { cash, packages, result: zaiResult(cash, packages) };
  }

  async function getStatus(sessionId) {
    const { settings: preferences } = await settingsStore.get();
    const sel = currentSelection(ctx, sessionId);
    const provider = sel.provider;
    if (sel.error) return {
      ok: false, isSupported: false, provider, model: sel.model, windows: null, balance: null,
      error: sel.error, refreshAfterMs: preferences.pollIntervalMs,
    };
    const platform = platformForSelection(ctx, provider, preferences.platforms);
    if (!platform) return {
      ok: true, isSupported: false, provider, model: sel.model,
      refreshAfterMs: preferences.idlePollIntervalMs,
    };
    if (!platform.enabled) return {
      ok: true, isSupported: false, provider, model: sel.model, source: platform.adapter,
      refreshAfterMs: preferences.pollIntervalMs,
    };
    const zai = platform.adapter === "zai";
    const opencode = platform.adapter === "opencodeGo";
    const custom = platform.adapter === "balance";

    function status(result, queriedAt = null) {
      return {
        ok: true, isSupported: true, provider, model: sel.model, source: platform.adapter, display: platform,
        windows: result.ok ? result.windows : null,
        balance: result.ok ? result.balance || null : null,
        planType: result.ok ? result.planType : null,
        queriedAt: result.ok ? queriedAt : null,
        error: result.ok ? null : result.error,
        warning: result.ok ? result.warning ?? null : null,
        state: result.ok && result.warning ? "partial_retry" : result.ok ? "ready" : "error",
        retryAfterMs: result.ok && result.warning ? Math.max(0, result.retryAt - Date.now()) : null,
        refreshAfterMs: preferences.pollIntervalMs,
      };
    }
    const changed = () => status({ ok: false, error: "账号或模型已切换，正在重新查询" });
    const started = generation;
    let source;
    try { source = custom ? await apiKeyCredentialSource(ctx, provider) : await credentialSource(ctx, provider); }
    catch (error) {
      caches.get(provider)?.controller.abort();
      caches.delete(provider);
      return status({ ok: false, error: error.message });
    }
    if (disposed || started !== generation) return changed();
    const resolvedSelection = currentSelection(ctx, sessionId);
    if (resolvedSelection.error || resolvedSelection.provider !== provider || resolvedSelection.model !== sel.model) return changed();
    let entry = caches.get(provider);
    if (entry && entry.identity !== source.identity) {
      entry.controller.abort();
      caches.delete(provider);
      entry = undefined;
    }
    if (zai
      ? fresh(entry?.cash, preferences.cacheTtlMs) && packagesReady(entry?.packages, preferences.cacheTtlMs)
      : entry?.result && Date.now() - entry.fetchedAt < preferences.cacheTtlMs) {
      return status(zai ? zaiResult(entry.cash, entry.packages) : entry.result, zai ? entry.cash.fetchedAt : entry.fetchedAt);
    }
    if (!entry?.promise) {
      if (!entry) {
        entry = { identity: source.identity, controller: new AbortController() };
        caches.set(provider, entry);
      }
      const captured = entry;
      entry.promise = (async () => {
        try {
          const signal = captured.controller.signal;
          const components = zai ? await queryZaiBalance(provider, source, captured, preferences) : null;
          const queried = components ? components.result
            : custom ? await queryCustomBalance(platform, source, signal, preferences.requestTimeoutMs)
              : opencode ? await queryOpencodeGoUsage(source, signal, preferences.requestTimeoutMs)
                : platform.adapter === "deepseek" ? await queryDeepSeekBalance(source, signal, preferences.requestTimeoutMs)
                  : platform.adapter === "grok" ? await queryGrokUsage(source, signal, preferences.requestTimeoutMs)
                    : await queryCodexUsage(source, signal, preferences.requestTimeoutMs);
          const result = redactResult(queried, source);
          const latest = custom ? await apiKeyCredentialSource(ctx, provider) : await credentialSource(ctx, provider);
          if (disposed || started !== generation || signal.aborted || latest.identity !== source.identity || caches.get(provider) !== captured) {
            return { ok: false, error: "账号或模型已切换，正在重新查询" };
          }
          if (components) {
            captured.cash = components.cash;
            captured.packages = components.packages;
            captured.fetchedAt = components.cash.fetchedAt;
          }
          if (result.ok) {
            captured.result = result;
            if (!components) captured.fetchedAt = Date.now();
          } else {
            captured.result = null;
          }
          return result;
        } catch {
          return { ok: false, error: "读取当前账号额度失败" };
        } finally {
          captured.promise = null;
          if (!captured.result && !captured.packages && caches.get(provider) === captured) caches.delete(provider);
        }
      })();
    }
    const result = await entry.promise;
    const latestSelection = currentSelection(ctx, sessionId);
    if (disposed || started !== generation || latestSelection.error || latestSelection.provider !== provider || latestSelection.model !== sel.model) return changed();
    return status(result, entry.fetchedAt);
  }

  function eduResponse(status, body) {
    const payload = body && typeof body === "object" && !Array.isArray(body) ? body : { ok: false, error: "额度查询失败，请重试" };
    return jsonResponse(status, { ...payload, credentialEpoch });
  }

  ctx.connection.fetch.register({
    path: `${API_PATH}/platforms`,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => {
      try { return jsonResponse(200, { ok: true, providers: configuredProviders(ctx) }); }
      catch { return jsonResponse(503, { ok: false, error: "DSH 模型平台目录不可用" }); }
    },
  });

  ctx.connection.fetch.register({
    path: `${API_PATH}/settings`,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: settingsHandler(settingsStore, invalidate),
  });

  ctx.connection.fetch.register({
    path: API_PATH,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const url = new URL(request.url);
        const sessionId = url.searchParams.get("sessionId");
        return eduResponse(200, await getStatus(sessionId));
      } catch {
        return eduResponse(500, {
          ok: false,
          error: "额度查询失败，请重试",
        });
      }
    },
  });
}

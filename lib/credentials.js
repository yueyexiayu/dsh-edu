import { createHash } from "node:crypto";
import { CODEX_RECORD_KEY, GROK_RECORD_KEY, DEEPSEEK_API_KEY_REF, oauthFromRecord, oauthAccessFromRecord, opencodeGoRouteFor, zaiRouteFor } from "./parse.js";

// A shipped route (for example the adapter's own `opencode-go`) carries no
// `baseURL` in user settings, so the adapter's reported default endpoint is the
// only way to learn where that route actually goes.
function readRoute(ctx, provider) {
  let metadata;
  try {
    metadata = ctx.get("llm")?.listConfigurableProviders().find((row) => row.provider === provider);
  } catch { throw new Error("无法读取当前模型路由配置"); }
  if (!metadata) throw new Error("无法确认当前模型路由的凭据配置");
  let descriptor;
  try { descriptor = ctx.get("settings")?.describe({ redactSecrets: true }).find((row) => row.ns === metadata.settingsNs); } catch { throw new Error("无法读取当前模型路由配置"); }
  if (!descriptor) throw new Error("无法读取当前模型路由配置");
  let value = descriptor.value;
  for (const key of metadata.settingsPath) value = value?.[key];
  return { metadata, config: value ?? {} };
}

// Usage attribution: only the official OpenCode Go route may claim a Go
// subscription. Returns null for anything that is not provably that endpoint.
export function opencodeGoRoute(ctx, provider) {
  const { metadata, config } = readRoute(ctx, provider);
  return opencodeGoRouteFor(config, { provider, defaultBaseURL: metadata.defaultBaseURL });
}

// Match inference's credential source; explicit references never fall back to
// another tenant's native key or OAuth record. The fingerprint stays Host-only.
export async function credentialSource(ctx, provider) {
  const { metadata, config } = readRoute(ctx, provider);
  const zai = zaiRouteFor(provider);
  const opencode = opencodeGoRouteFor(config, { provider, defaultBaseURL: metadata.defaultBaseURL });
  const expectedHost = opencode ? new URL(opencode.base).hostname
    : zai ? new URL(zai.base).hostname
      : provider === "openai-codex" ? "chatgpt.com"
        : provider === "xai" ? "cli-chat-proxy.grok.com" : "api.deepseek.com";
  const endpoint = config.baseURL ?? (provider === "deepseek-official" ? ctx.get("launchEnvironment")?.get("DEEPSEEK_BASE_URL")?.value : undefined);
  if (endpoint !== undefined) {
    let url;
    try { url = new URL(endpoint); } catch { throw new Error("模型路由地址无效，无法确认额度归属"); }
    if (url.protocol !== "https:" || url.hostname !== expectedHost || url.username || url.password) throw new Error("当前模型使用自定义服务地址，无法确认官方额度归属");
  }
  if (Object.keys(config.headers ?? {}).some((key) => /^(authorization|x-api-key|chatgpt-account-id)$/i.test(key))) throw new Error("当前模型覆盖了认证请求头，无法确认额度归属");

  let oauth;
  let key;
  let source;
  if (provider === "openai-codex" || provider === "xai") {
    if (config.apiKeyEnv !== undefined) throw new Error("当前模型使用 API Key，无法查询 OAuth 账号限额");
    source = provider === "openai-codex" ? CODEX_RECORD_KEY : GROK_RECORD_KEY;
    let record;
    try { record = await ctx.credentials.readRecord(source); } catch { throw new Error("读取账号凭据失败"); }
    oauth = provider === "openai-codex" ? oauthFromRecord(record) : oauthAccessFromRecord(record, "Grok");
    if (!oauth.ok) throw new Error(oauth.error);
  } else {
    const explicit = config.apiKeyEnv !== undefined;
    if (!explicit && provider !== "deepseek-official") {
      source = `llm-pi-ai/${provider}`;
      let record;
      try { record = await ctx.credentials.readRecord(source); } catch { throw new Error("读取 API Key 凭据失败"); }
      if (record?.kind === "api-key" && typeof record.key === "string" && record.key) key = record.key;
      else if (record && record.kind !== "api-key") throw new Error("当前账号凭据不能用于官方余额查询");
    }
    if (!key) {
      if (opencode && !explicit) throw new Error("未配置 OpenCode Go 的 API Key");
      if (provider === "deepseek-vision" && !explicit) throw new Error("deepseek-vision 未配置可确认的 API Key");
      const ref = explicit ? config.apiKeyEnv : zai?.keyRef ?? DEEPSEEK_API_KEY_REF;
      if (typeof ref !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error("模型路由的凭据引用无效");
      source = ref;
      try {
        key = (await ctx.credentials.resolve(ref))?.value;
        if (key === undefined && !explicit && provider !== "deepseek-official") key = ctx.get("launchEnvironment")?.get(ref)?.value;
      } catch { throw new Error("读取 API Key 凭据失败"); }
      if (typeof key !== "string" || !key) throw new Error(`未配置 ${ref}`);
    }
  }
  const identity = createHash("sha256").update(JSON.stringify([provider, config, endpoint, source, key, oauth?.access, oauth?.accountId])).digest("hex");
  return { identity, key, oauth };
}

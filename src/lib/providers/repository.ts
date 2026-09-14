import "server-only";
import { getDashscopeEnv, hasDashscopeApiKey } from "@/lib/env";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/providers/crypto";
import type { ProviderCategory, ProviderName, ProviderRuntimeConfig, SafeProviderConfig } from "@/lib/providers/types";
import { pickProviderByPriority } from "@/lib/video/playback";
import { resolveWanBaseUrl } from "@/lib/video/wan-mapping";
import { createClient } from "@/lib/supabase/server";

type ConfigRow = { id: string; category: ProviderCategory; provider: ProviderName; model: string; quality_model: string | null; base_url: string; api_key_encrypted: string; enabled: boolean; workspace_id: string | null; region: string | null };

const CONFIG_COLUMNS = "id,category,provider,model,quality_model,base_url,api_key_encrypted,enabled,workspace_id,region";
export const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

/** 火山方舟的图片（Seedream）与视频（Seedance）共用同一把 Ark API Key。 */
export const ARK_PROVIDERS: ProviderName[] = ["seedream", "volcengine"];

/**
 * Reads stay on the user-scoped client: RLS 的 owner 策略允许用户读取自己的配置行，
 * 因此不需要 service-role，也不会给部署增加新的必需环境变量。
 */
async function readRow(userId: string, filters: Array<[string, string]>): Promise<ConfigRow | null> {
  let query = (await createClient()).from("ai_provider_configs").select(CONFIG_COLUMNS).eq("user_id", userId);
  for (const [column, value] of filters) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as ConfigRow | null) ?? null;
}

/**
 * 读取某个 category 下**全部**启用的行。
 *
 * 刻意用返回数组的查询而不是 `.maybeSingle()`：同一个 category 允许多条 enabled
 * （视频曾经同时启用 Seedance 与 Wan），而 maybeSingle 在多行命中时会由 supabase-js
 * 构造 PGRST116 错误并把 data 置空，调用方只能拿到一句「查不到」。
 * 这里一次取回，交给 pickProviderByPriority 按明确优先级决定用哪一条。
 */
async function readEnabledRows(userId: string, category: ProviderCategory): Promise<ConfigRow[]> {
  const { data, error } = await (await createClient()).from("ai_provider_configs")
    .select(CONFIG_COLUMNS).eq("user_id", userId).eq("category", category).eq("enabled", true)
    .order("provider");
  if (error) throw error;
  return (data ?? []) as ConfigRow[];
}

function toSafeConfig(row: ConfigRow): SafeProviderConfig {
  return {
    id: row.id, category: row.category, provider: row.provider, model: row.model,
    qualityModel: row.quality_model ?? undefined, baseUrl: row.base_url, enabled: row.enabled,
    hasApiKey: Boolean(row.api_key_encrypted),
    workspaceId: row.workspace_id ?? undefined, region: row.region ?? undefined,
  };
}

export async function listProviderConfigs(userId: string): Promise<SafeProviderConfig[]> {
  const { data, error } = await (await createClient()).from("ai_provider_configs")
    .select(CONFIG_COLUMNS).eq("user_id", userId).order("category").order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ConfigRow[]).map(toSafeConfig);
}

/**
 * Resolve the runtime config a job should run with. Volcengine Ark reuses the
 * Ark API key already saved for Seedream so users never enter the same key twice;
 * model settings stay independent per provider.
 *
 * 只有 **video** 走「多条 enabled 时按优先级取一条」：视频曾经同时启用
 * Seedance 与 Wan，而旧实现用 `.maybeSingle()` 查单行，多行命中会由 supabase-js
 * 构造成 PGRST116 错误，导致创建/刷新/恢复/重新生成全部失败。优先级为
 * alibaba > volcengine(Seedance) > runway。
 *
 * 其它 category 刻意保持原来的单行语义不变（图片与文案各自只会有一条启用），
 * 不做泛化 —— 否则一旦某个用户同时启用了 Seedream 与 OpenAI，
 * 就会在不声不响间换掉他正在用的图片 Provider。
 *
 * 阿里云百炼是唯一不用数据库密钥的 Provider：它的 Key 必须与业务空间属于同一主账号，
 * 由服务端环境变量提供，数据库只保存 Endpoint 坐标（业务空间 ID / 地域）。
 */
export async function getEnabledProviderConfig(userId: string, category: ProviderCategory): Promise<ProviderRuntimeConfig | null> {
  if (category === "video") {
    const row = pickProviderByPriority(await readEnabledRows(userId, category), category);
    return row ? toRuntimeConfig(row) : null;
  }
  const row = await readRow(userId, [["category", category], ["enabled", "true"]]);
  return row ? toRuntimeConfig(row) : null;
}

function toRuntimeConfig(row: ConfigRow): ProviderRuntimeConfig {
  return {
    provider: row.provider, model: row.model, qualityModel: row.quality_model ?? undefined,
    baseUrl: row.base_url || (ARK_PROVIDERS.includes(row.provider) ? DEFAULT_ARK_BASE_URL : row.base_url),
    apiKey: resolveApiKey(row),
    workspaceId: row.workspace_id ?? undefined,
    region: row.region ?? undefined,
  };
}

/**
 * 服务端环境变量里的百炼凭据。数据库已经保存了业务空间 ID 时以数据库为准，
 * 方便用户在设置页改地址而不必重新部署；否则用环境变量补齐。
 *
 * 这里**不**因为缺少密钥就返回 null：禁用百炼并不等于「视频 Provider 未配置」，
 * 返回 null 会让任务列表停止轮询，把用户正在跑的任务晾在半路。
 * 缺少密钥时只留空 apiKey，真正的缺失由创建/刷新时的明确报错暴露。
 */
export function withDashscopeEnv(config: ProviderRuntimeConfig): ProviderRuntimeConfig {
  if (config.provider !== "alibaba") return config;
  const env = getDashscopeEnv();
  return {
    ...config,
    apiKey: env?.DASHSCOPE_API_KEY ?? "",
    workspaceId: config.workspaceId ?? env?.DASHSCOPE_WORKSPACE_ID,
    region: config.region ?? env?.DASHSCOPE_REGION ?? "cn-beijing",
  };
}

/**
 * 视频任务的权威配置来源。除了把百炼的密钥换成服务端环境变量，行为与
 * getEnabledProviderConfig 完全一致；其它 Provider 直接原样返回。
 */
export async function getVideoProviderConfig(userId: string): Promise<ProviderRuntimeConfig | null> {
  const config = await getEnabledProviderConfig(userId, "video");
  return config ? withDashscopeEnv(config) : null;
}

/** 阿里云百炼是否真的可用：库里启用了，同时服务端确实配了密钥。 */
export function isDashscopeReady(config: ProviderRuntimeConfig) {
  return config.provider !== "alibaba" || Boolean(config.apiKey);
}

/** 已保存过 Seedream 的 Ark Key 时，视频 Provider 不需要用户再填一次密钥。 */
export async function hasReusableArkKey(userId: string): Promise<boolean> {
  const row = await readRow(userId, [["category", "image"], ["provider", "seedream"]]);
  return Boolean(row?.api_key_encrypted);
}

/**
 * 百炼密钥只来自服务端环境变量，因此它的配置行不需要密钥：
 * 留空时用环境变量占位，其它 Provider 维持原来的复用顺序。
 */
function resolveStoredSecret(userId: string, input: { category: ProviderCategory; provider: ProviderName }) {
  if (input.provider === "alibaba") return hasDashscopeApiKey() ? "env:DASHSCOPE_API_KEY" : undefined;
  return findArkKeyFor(userId, input);
}

/** api_key_encrypted 为 NOT NULL，因此每行都自带密钥；直接解密即可。 */
function resolveApiKey(row: ConfigRow) {
  return decryptProviderSecret(row.api_key_encrypted);
}

/**
 * 保存时留空 API Key 的取值顺序：先复用该 Provider 自己已保存的密钥，
 * 再回退到火山方舟的其它入口（图片 Seedream ↔ 视频 Seedance 共用同一把 Ark Key）。
 * 顺序很关键：否则在一条记录上清空密钥会覆盖掉另一条已有的密钥。
 */
async function findArkKeyFor(userId: string, input: { category: ProviderCategory; provider: ProviderName }) {
  const own = await readRow(userId, [["category", input.category], ["provider", input.provider]]);
  if (own?.api_key_encrypted) return own.api_key_encrypted;
  if (!ARK_PROVIDERS.includes(input.provider)) return undefined;
  for (const provider of ARK_PROVIDERS) {
    const donor = await readRow(userId, [["provider", provider]]);
    if (donor?.api_key_encrypted) return donor.api_key_encrypted;
  }
  return undefined;
}

/**
 * 保存配置。api_key_encrypted 是 NOT NULL，但阿里云百炼的密钥来自环境变量、
 * 不需要存在这一行里，因此用占位符而非真实密钥（解密只发生在火山方舟路径上）。
 */
export async function saveProviderConfig(userId: string, input: { category: ProviderCategory; provider: ProviderName; model: string; qualityModel?: string; baseUrl?: string; apiKey?: string; enabled: boolean; workspaceId?: string; region?: string }) {
  const service = await createClient();
  const encrypted = input.apiKey ? encryptProviderSecret(input.apiKey) : await resolveStoredSecret(userId, input);
  if (!encrypted) throw new Error("API_KEY_REQUIRED");
  // base_url 是 NOT NULL 且长度 8-500：百炼的地址由业务空间 ID 推导，落库成具体域名，
  // 这样这一行既满足约束，也留下了「当时用的是哪个 Endpoint」的证据。
  const baseUrl = input.baseUrl?.trim() || (input.provider === "alibaba" ? resolveWanBaseUrl({ workspaceId: input.workspaceId, region: input.region }) : "");
  if (baseUrl.length < 8) throw new Error("BASE_URL_REQUIRED");
  const { error } = await service.from("ai_provider_configs").upsert({
    user_id: userId, category: input.category, provider: input.provider,
    model: input.model, quality_model: input.qualityModel ?? null, base_url: baseUrl, api_key_encrypted: encrypted, enabled: input.enabled,
    workspace_id: input.workspaceId ?? null, region: input.region ?? null,
  }, { onConflict: "user_id,category,provider" });
  if (error) throw error;
  return listProviderConfigs(userId);
}

import "server-only";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/providers/crypto";
import type { ProviderCategory, ProviderName, ProviderRuntimeConfig, SafeProviderConfig } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";

type ConfigRow = { id: string; category: ProviderCategory; provider: ProviderName; model: string; quality_model: string | null; base_url: string; api_key_encrypted: string; enabled: boolean };

const CONFIG_COLUMNS = "id,category,provider,model,quality_model,base_url,api_key_encrypted,enabled";
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

function toSafeConfig(row: ConfigRow): SafeProviderConfig {
  return {
    id: row.id, category: row.category, provider: row.provider, model: row.model,
    qualityModel: row.quality_model ?? undefined, baseUrl: row.base_url, enabled: row.enabled,
    hasApiKey: Boolean(row.api_key_encrypted),
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
 */
export async function getEnabledProviderConfig(userId: string, category: ProviderCategory): Promise<ProviderRuntimeConfig | null> {
  const row = await readRow(userId, [["category", category], ["enabled", "true"]]);
  if (!row) return null;
  const apiKey = await resolveApiKey(userId, row);
  if (!apiKey) return null;
  return {
    provider: row.provider, model: row.model, qualityModel: row.quality_model ?? undefined,
    baseUrl: row.base_url || (ARK_PROVIDERS.includes(row.provider) ? DEFAULT_ARK_BASE_URL : row.base_url), apiKey,
  };
}

/** True when an enabled Ark key exists for Seedream, meaning the video provider needs no second key. */
export async function hasReusableArkKey(userId: string): Promise<boolean> {
  const row = await readRow(userId, [["category", "image"], ["provider", "seedream"], ["enabled", "true"]]);
  return Boolean(row?.api_key_encrypted);
}

async function resolveApiKey(userId: string, row: ConfigRow) {
  if (row.api_key_encrypted) return decryptProviderSecret(row.api_key_encrypted);
  if (!ARK_PROVIDERS.includes(row.provider)) return null;
  const donor = await readRow(userId, [["provider", row.provider]]);
  return donor?.api_key_encrypted ? decryptProviderSecret(donor.api_key_encrypted) : null;
}

export async function saveProviderConfig(userId: string, input: { category: ProviderCategory; provider: ProviderName; model: string; qualityModel?: string; baseUrl: string; apiKey?: string; enabled: boolean }) {
  const service = await createClient();
  const existing = await readRow(userId, [["category", input.category], ["provider", input.provider]]);
  // 火山方舟：未填新密钥时复用已保存的图片（Seedream）Ark Key，不让用户重复填写同一把密钥。
  const donor = !input.apiKey && !existing?.api_key_encrypted && ARK_PROVIDERS.includes(input.provider)
    ? await readRow(userId, [["category", "image"], ["provider", "seedream"]])
    : null;
  const encrypted = input.apiKey
    ? encryptProviderSecret(input.apiKey)
    : existing?.api_key_encrypted ?? donor?.api_key_encrypted;
  if (!encrypted) throw new Error("API_KEY_REQUIRED");
  const { error } = await service.from("ai_provider_configs").upsert({
    user_id: userId, category: input.category, provider: input.provider,
    model: input.model, quality_model: input.qualityModel ?? null, base_url: input.baseUrl, api_key_encrypted: encrypted, enabled: input.enabled,
  }, { onConflict: "user_id,category,provider" });
  if (error) throw error;
  return listProviderConfigs(userId);
}

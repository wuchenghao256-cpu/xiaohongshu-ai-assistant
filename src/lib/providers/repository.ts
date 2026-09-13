import "server-only";
import { decryptProviderSecret, encryptProviderSecret, maskProviderSecret } from "@/lib/providers/crypto";
import type { ProviderCategory, ProviderName, ProviderRuntimeConfig, SafeProviderConfig } from "@/lib/providers/types";
import { createClient } from "@/lib/supabase/server";

type ConfigRow = { id: string; category: ProviderCategory; provider: ProviderName; model: string; base_url: string; api_key_encrypted: string; enabled: boolean };

export async function listProviderConfigs(userId: string): Promise<SafeProviderConfig[]> {
  const { data, error } = await (await createClient()).from("ai_provider_configs")
    .select("id,category,provider,model,base_url,api_key_encrypted,enabled")
    .eq("user_id", userId).order("category").order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ConfigRow[]).map((row) => ({
    id: row.id, category: row.category, provider: row.provider, model: row.model,
    baseUrl: row.base_url, enabled: row.enabled,
    maskedApiKey: maskProviderSecret(decryptProviderSecret(row.api_key_encrypted)),
  }));
}

export async function getEnabledProviderConfig(userId: string, category: ProviderCategory): Promise<ProviderRuntimeConfig | null> {
  const { data, error } = await (await createClient()).from("ai_provider_configs")
    .select("provider,model,base_url,api_key_encrypted").eq("user_id", userId)
    .eq("category", category).eq("enabled", true).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { provider: data.provider as ProviderName, model: data.model, baseUrl: data.base_url, apiKey: decryptProviderSecret(data.api_key_encrypted) };
}

export async function saveProviderConfig(userId: string, input: { category: ProviderCategory; provider: ProviderName; model: string; baseUrl: string; apiKey?: string; enabled: boolean }) {
  const service = await createClient();
  const existing = await service.from("ai_provider_configs").select("id,api_key_encrypted")
    .eq("user_id", userId).eq("category", input.category).eq("provider", input.provider).maybeSingle();
  if (existing.error) throw existing.error;
  const encrypted = input.apiKey ? encryptProviderSecret(input.apiKey) : existing.data?.api_key_encrypted;
  if (!encrypted) throw new Error("API_KEY_REQUIRED");
  const { error } = await service.from("ai_provider_configs").upsert({
    user_id: userId, category: input.category, provider: input.provider,
    model: input.model, base_url: input.baseUrl, api_key_encrypted: encrypted, enabled: input.enabled,
  }, { onConflict: "user_id,category,provider" });
  if (error) throw error;
  return listProviderConfigs(userId);
}

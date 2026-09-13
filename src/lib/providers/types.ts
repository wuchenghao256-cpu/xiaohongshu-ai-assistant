import { z } from "zod";

export const providerNames = ["seedream", "openai", "google", "custom", "runway"] as const;
export const providerCategories = ["text", "image", "video"] as const;
export type ProviderName = (typeof providerNames)[number];
export type ProviderCategory = (typeof providerCategories)[number];

export const providerConfigInputSchema = z.object({
  category: z.enum(providerCategories),
  provider: z.enum(providerNames),
  baseUrl: z.string().trim().url().max(500).refine((value) => value.startsWith("https://"), "API Base URL 必须使用 HTTPS"),
  apiKey: z.string().trim().min(1).max(2000).optional(),
  model: z.string().trim().min(1).max(200),
  qualityModel: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().default(true),
});

export type ProviderRuntimeConfig = {
  provider: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  qualityModel?: string;
};

export type SafeProviderConfig = Omit<ProviderRuntimeConfig, "apiKey"> & {
  id: string;
  category: ProviderCategory;
  enabled: boolean;
  hasApiKey: boolean;
};

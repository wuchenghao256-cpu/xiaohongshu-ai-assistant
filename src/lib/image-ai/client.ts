import "server-only";
import { CustomImageProvider } from "@/lib/image-ai/adapters/custom-image-provider";
import { GeminiImageProvider } from "@/lib/image-ai/adapters/gemini-image-provider";
import { OpenAiImageProvider } from "@/lib/image-ai/adapters/openai-image-provider";
import { SeedreamImageProvider } from "@/lib/image-ai/adapters/seedream-provider";
import { getImageAiEnv } from "@/lib/env";
import { ImageGenerationError, type ImageGenerationProvider } from "@/lib/image-ai/provider";
import type { ImageGenerationInput } from "@/lib/image-ai/types";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";

function fromConfig(config: ProviderRuntimeConfig): ImageGenerationProvider {
  if (config.provider === "seedream") return new SeedreamImageProvider(config);
  if (config.provider === "openai") return new OpenAiImageProvider(config);
  if (config.provider === "google") return new GeminiImageProvider(config);
  return new CustomImageProvider(config);
}

function environmentFallback(): ImageGenerationProvider {
  try { const env = getImageAiEnv(); return new SeedreamImageProvider({ provider: "seedream", baseUrl: env.IMAGE_AI_BASE_URL, apiKey: env.IMAGE_AI_API_KEY, model: env.IMAGE_AI_MODEL }); }
  catch { throw new ImageGenerationError("图片 AI 尚未配置，请在设置中启用图片 Provider。", "CONFIG_MISSING", 503); }
}

export async function getImageGenerationProvider(userId: string) { const configured = await getEnabledProviderConfig(userId, "image"); return configured ? fromConfig(configured) : environmentFallback(); }
export async function generateProductImages(userId: string, input: ImageGenerationInput) { return (await getImageGenerationProvider(userId)).generateProductImages(input); }
export async function generateModelProductImages(userId: string, input: ImageGenerationInput) { const provider = await getImageGenerationProvider(userId); if (input.count > provider.maxOutputs) throw new ImageGenerationError(`当前图片生成服务单次最多生成 ${provider.maxOutputs} 张图片。`, "REQUEST_FAILED", 400); return provider.generateProductImages(input); }

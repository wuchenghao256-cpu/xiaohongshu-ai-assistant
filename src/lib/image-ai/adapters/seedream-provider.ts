import { OpenAiCompatibleImageProvider } from "@/lib/image-ai/adapters/openai-compatible";
import type { ImageGenerationInput } from "@/lib/image-ai/types";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
export class SeedreamImageProvider extends OpenAiCompatibleImageProvider { constructor(config: ProviderRuntimeConfig) { super(config, "seedream"); } protected override requestBody(input: ImageGenerationInput, index: number) { return { ...super.requestBody(input, index), sequential_image_generation: "disabled", stream: false, watermark: false }; } }

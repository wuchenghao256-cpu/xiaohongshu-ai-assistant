import { OpenAiCompatibleImageProvider } from "@/lib/image-ai/adapters/openai-compatible";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
export class CustomImageProvider extends OpenAiCompatibleImageProvider { constructor(config: ProviderRuntimeConfig) { super(config, "custom"); } }

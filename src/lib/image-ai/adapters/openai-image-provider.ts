import { OpenAiCompatibleImageProvider } from "@/lib/image-ai/adapters/openai-compatible";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
export class OpenAiImageProvider extends OpenAiCompatibleImageProvider { constructor(config: ProviderRuntimeConfig) { super(config, "openai"); } }

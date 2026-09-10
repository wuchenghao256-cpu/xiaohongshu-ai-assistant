import type { AiHealth, GeneratedVariants, XiaohongshuGenerationInput } from "@/lib/ai/types";

export type AiImage = { url: string; mimeType: string };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateXiaohongshuPost(input: XiaohongshuGenerationInput, images?: AiImage[]): Promise<GeneratedVariants>;
  healthCheck(): Promise<AiHealth>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG_MISSING" | "TIMEOUT" | "REQUEST_FAILED" | "INVALID_JSON" | "INVALID_RESPONSE",
    public readonly status = 500,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

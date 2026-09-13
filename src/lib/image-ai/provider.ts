import type { GeneratedImage, ImageGenerationInput } from "@/lib/image-ai/types";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";

export interface ImageGenerationProvider {
  readonly name: string;
  readonly model: string;
  readonly qualityPreset: string;
  readonly maxOutputs: number;
  generateProductImages(input: ImageGenerationInput): Promise<GeneratedImage[]>;
}

export type ImageProviderFactory = (config: ProviderRuntimeConfig) => ImageGenerationProvider;

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CONFIG_MISSING"
      | "TIMEOUT"
      | "REQUEST_FAILED"
      | "INVALID_RESPONSE"
      | "DOWNLOAD_FAILED"
      | "STORAGE_FAILED",
    public readonly status = 500,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

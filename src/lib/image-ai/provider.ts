import type { GeneratedImage, ImageGenerationInput } from "@/lib/image-ai/types";

export interface ImageGenerationProvider {
  readonly name: string;
  readonly model: string;
  generateProductImages(input: ImageGenerationInput): Promise<GeneratedImage[]>;
}

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

export type ImageGenerationRequest = { prompt: string; count: number; aspectRatio?: string };
export type GeneratedImage = { url: string; width?: number; height?: number };

export interface ImageGenerationProvider {
  readonly id: string;
  generate(request: ImageGenerationRequest): Promise<GeneratedImage[]>;
}

export class ImageGenerationNotConfiguredError extends Error {
  constructor() { super("第一版暂未配置 AI 生图能力。"); }
}

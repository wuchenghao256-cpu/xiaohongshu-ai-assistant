import "server-only";
import { z } from "zod";
import { getImageAiEnv } from "@/lib/env";
import { ImageGenerationError, type ImageGenerationProvider } from "@/lib/image-ai/provider";
import type { GeneratedImage, ImageAspectRatio, ImageGenerationInput } from "@/lib/image-ai/types";

const imageResponseSchema = z.object({
  data: z.array(z.object({
    url: z.string().url().optional(),
    b64_json: z.string().min(1).optional(),
  }).refine((image) => Boolean(image.url || image.b64_json))).min(1),
});

const sizeByRatio: Record<ImageAspectRatio, string> = {
  "1:1": "2048x2048",
  "3:4": "1728x2304",
  "4:3": "2304x1728",
  "9:16": "1440x2560",
  "16:9": "2560x1440",
};

function imageEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/images/generations")
    ? normalized
    : `${normalized}/images/generations`;
}

class VolcengineSeedreamProvider implements ImageGenerationProvider {
  readonly name = "volcengine-seedream";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    try {
      const env = getImageAiEnv();
      this.baseUrl = env.IMAGE_AI_BASE_URL;
      this.apiKey = env.IMAGE_AI_API_KEY;
      this.model = env.IMAGE_AI_MODEL;
    } catch {
      throw new ImageGenerationError(
        "图片 AI 尚未配置，请在服务端填写 IMAGE_AI_BASE_URL、IMAGE_AI_API_KEY 和 IMAGE_AI_MODEL。",
        "CONFIG_MISSING",
        503,
      );
    }
  }

  private async requestOne(input: ImageGenerationInput, index: number): Promise<GeneratedImage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    try {
      const response = await fetch(imageEndpoint(this.baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: input.count > 1 ? `${input.prompt}\n这是第 ${index + 1} 张，请在不改变商品的前提下调整构图细节。` : input.prompt,
          ...(input.references.length
            ? {
                image: input.references.length === 1
                  ? input.references[0].url
                  : input.references.map((reference) => reference.url),
              }
            : {}),
          size: sizeByRatio[input.aspectRatio],
          sequential_image_generation: "disabled",
          stream: false,
          response_format: "url",
          watermark: false,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        console.error("Image AI request failed", {
          status: response.status,
          provider: this.name,
          model: this.model,
        });
        throw new ImageGenerationError(
          `图片生成服务请求失败（HTTP ${response.status}），请检查模型、Endpoint ID 或账户额度。`,
          "REQUEST_FAILED",
          502,
        );
      }
      const parsed = imageResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ImageGenerationError("图片生成服务返回了无法识别的结果。", "INVALID_RESPONSE", 502);
      }
      const image = parsed.data.data[0];
      return { url: image.url, b64Json: image.b64_json };
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ImageGenerationError("图片生成超时，请稍后重试。", "TIMEOUT", 504);
      }
      console.error("Image AI transport failed", {
        provider: this.name,
        model: this.model,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new ImageGenerationError("无法连接图片生成服务，请检查接口地址或网络。", "REQUEST_FAILED", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async generateProductImages(input: ImageGenerationInput) {
    return Promise.all(
      Array.from({ length: input.count }, (_, index) => this.requestOne(input, index)),
    );
  }
}

export function getImageGenerationProvider(): ImageGenerationProvider {
  return new VolcengineSeedreamProvider();
}

export function generateProductImages(input: ImageGenerationInput) {
  return getImageGenerationProvider().generateProductImages(input);
}

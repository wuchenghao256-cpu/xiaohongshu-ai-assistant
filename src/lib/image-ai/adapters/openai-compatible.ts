import "server-only";
import { z } from "zod";
import { ImageGenerationError, type ImageGenerationProvider } from "@/lib/image-ai/provider";
import type { GeneratedImage, ImageAspectRatio, ImageGenerationInput } from "@/lib/image-ai/types";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";

const responseSchema = z.object({ data: z.array(z.object({ url: z.string().url().optional(), b64_json: z.string().min(1).optional() }).refine((v) => v.url || v.b64_json)).min(1) });
const sizeByRatio: Record<ImageAspectRatio, string> = { "1:1": "2048x2048", "3:4": "1728x2304", "4:5": "1728x2160", "4:3": "2304x1728", "9:16": "1440x2560", "16:9": "2560x1440" };

export function imagesEndpoint(baseUrl: string) { const value = baseUrl.replace(/\/+$/, ""); return value.endsWith("/images/generations") ? value : `${value}/images/generations`; }

export class OpenAiCompatibleImageProvider implements ImageGenerationProvider {
  readonly name: string; readonly model: string; readonly qualityPreset = "high"; readonly maxOutputs = 4;
  constructor(protected readonly config: ProviderRuntimeConfig, name = "custom") { this.name = name; this.model = config.model; }
  protected requestBody(input: ImageGenerationInput, index: number) { return { model: this.model, prompt: [input.prompt, input.negativePrompt ? `Avoid: ${input.negativePrompt}.` : "", input.count > 1 ? `Image ${index + 1} of ${input.count}; preserve the product and vary only composition.` : ""].filter(Boolean).join("\n"), ...(input.references.length ? { image: input.references.length === 1 ? input.references[0].url : input.references.map((item) => item.url) } : {}), size: sizeByRatio[input.aspectRatio], response_format: "url" }; }
  private async requestOne(input: ImageGenerationInput, index: number): Promise<GeneratedImage> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 150_000);
    try {
      const response = await fetch(imagesEndpoint(this.config.baseUrl), { method: "POST", headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(this.requestBody(input, index)), signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new ImageGenerationError(`图片生成服务请求失败（HTTP ${response.status}），请检查模型、接口或账户额度。`, "REQUEST_FAILED", 502);
      const parsed = responseSchema.safeParse(await response.json()); if (!parsed.success) throw new ImageGenerationError("图片生成服务返回了无法识别的结果。", "INVALID_RESPONSE", 502); return parsed.data.data[0];
    } catch (error) { if (error instanceof ImageGenerationError) throw error; if (error instanceof Error && error.name === "AbortError") throw new ImageGenerationError("图片生成超时，请稍后重试。", "TIMEOUT", 504); throw new ImageGenerationError("无法连接图片生成服务，请检查接口地址或网络。", "REQUEST_FAILED", 502); } finally { clearTimeout(timer); }
  }
  generateProductImages(input: ImageGenerationInput) { return Promise.all(Array.from({ length: input.count }, (_, index) => this.requestOne(input, index))); }
}

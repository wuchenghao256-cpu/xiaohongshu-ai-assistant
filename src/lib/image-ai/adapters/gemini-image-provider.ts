import "server-only";
import { ImageGenerationError, type ImageGenerationProvider } from "@/lib/image-ai/provider";
import type { GeneratedImage, ImageGenerationInput } from "@/lib/image-ai/types";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
export class GeminiImageProvider implements ImageGenerationProvider {
  readonly name = "google"; readonly model: string; readonly qualityPreset = "high"; readonly maxOutputs = 4;
  constructor(private readonly config: ProviderRuntimeConfig) { this.model = config.model; }
  private async requestOne(input: ImageGenerationInput, index: number): Promise<GeneratedImage> {
    if (input.references.length) throw new ImageGenerationError("当前 Gemini 适配器暂不支持 URL 参考图，请改用 Seedream 或 OpenAI-compatible Provider。", "REQUEST_FAILED", 400);
    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(this.model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": this.config.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `${input.prompt}\n${input.negativePrompt ? `Avoid: ${input.negativePrompt}` : ""}\nImage ${index + 1} of ${input.count}.` }] }], generationConfig: { responseModalities: ["IMAGE"] } }), cache: "no-store" });
    if (!response.ok) throw new ImageGenerationError(`Gemini 图片服务请求失败（HTTP ${response.status}）。`, "REQUEST_FAILED", 502);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> }; const inline = payload.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new ImageGenerationError("Gemini 未返回图片。", "INVALID_RESPONSE", 502); return { b64Json: `data:${inline.mimeType ?? "image/png"};base64,${inline.data}` };
  }
  generateProductImages(input: ImageGenerationInput) { return Promise.all(Array.from({ length: input.count }, (_, index) => this.requestOne(input, index))); }
}

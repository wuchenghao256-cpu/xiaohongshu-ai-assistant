import "server-only";
import { getServerEnv } from "@/lib/env";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import { AiProviderError, type AiGenerationResult, type AiImage, type AiProvider } from "@/lib/ai/provider";
import { buildXhsQualityRepairPrompt, buildXhsUserPrompt, XHS_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { inspectGenerationQuality } from "@/lib/ai/quality";
import { generatedVariantsSchema, type AiHealth, type GeneratedVariants, type XiaohongshuGenerationInput } from "@/lib/ai/types";

type ChatCompletionResponse = { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };

function endpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function extractContent(payload: ChatCompletionResponse) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return "";
}

function parseJson(text: string): GeneratedVariants {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AiProviderError("AI 返回了无法解析的内容，请重试。", "INVALID_JSON", 502);
  }
  const validated = generatedVariantsSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AiProviderError("AI 返回结构不符合要求，请重试。", "INVALID_RESPONSE", 502);
  }
  return validated.data;
}

function isRetryableFormatError(error: unknown) {
  return error instanceof AiProviderError
    && (error.code === "INVALID_JSON" || error.code === "INVALID_RESPONSE");
}

class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config?: ProviderRuntimeConfig) {
    if (config) {
      this.baseUrl = config.baseUrl;
      this.apiKey = config.apiKey;
      this.model = config.model;
      return;
    }
    let env: ReturnType<typeof getServerEnv>;
    try { env = getServerEnv(); } catch {
      throw new AiProviderError("AI API 尚未配置，请在服务端环境变量中填写 AI_BASE_URL、AI_API_KEY 和 AI_MODEL。", "CONFIG_MISSING", 503);
    }
    this.baseUrl = env.AI_BASE_URL;
    this.apiKey = env.AI_API_KEY;
    this.model = env.AI_MODEL;
  }

  private async request(body: Record<string, unknown>, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint(this.baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        console.error("AI request failed", { status: response.status, provider: this.name, model: this.model });
        throw new AiProviderError(`AI 请求失败（HTTP ${response.status}），请检查模型与接口配置。`, "REQUEST_FAILED", 502);
      }
      return (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderError("AI 请求超时，请稍后重试。", "TIMEOUT", 504);
      }
      console.error("AI transport failed", { provider: this.name, model: this.model, error: error instanceof Error ? error.message : "unknown" });
      throw new AiProviderError("无法连接 AI 服务，请检查接口地址或网络。", "REQUEST_FAILED", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestValidatedVariants(userContent: unknown, systemPrompt: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retryInstruction = attempt === 0
        ? ""
        : "\n\n上一次响应未通过 JSON 结构校验。请重新生成完整结果，严格只返回指定 JSON 对象。";
      const payload = await this.request({
        model: this.model,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${systemPrompt}${retryInstruction}` },
          { role: "user", content: userContent },
        ],
      }, 60_000);
      try {
        return parseJson(extractContent(payload));
      } catch (error) {
        if (attempt === 0 && isRetryableFormatError(error)) continue;
        throw error;
      }
    }
    throw new AiProviderError("AI 返回结构不符合要求，请重试。", "INVALID_RESPONSE", 502);
  }

  async generateXiaohongshuPost(input: XiaohongshuGenerationInput, images: AiImage[] = []): Promise<AiGenerationResult> {
    const text = buildXhsUserPrompt(input);
    const userContent = images.length === 0
      ? text
      : [{ type: "text", text }, ...images.map((image) => ({ type: "image_url", image_url: { url: image.url } }))];
    const initial = await this.requestValidatedVariants(userContent, XHS_SYSTEM_PROMPT);
    const initialQuality = inspectGenerationQuality(initial);
    if (initialQuality.passes) {
      return {
        ...initial,
        diagnostics: { qualityCorrectionApplied: false, initialQuality, finalQuality: initialQuality },
      };
    }

    const corrected = await this.requestValidatedVariants(
      buildXhsQualityRepairPrompt(input, initial, initialQuality.issues),
      `${XHS_SYSTEM_PROMPT}\n\n这是一次质量修正。不得扩写或改变商品事实，只修正语气、Emoji、分段和自然程度。`,
    );
    const finalQuality = inspectGenerationQuality(corrected);
    return {
      ...corrected,
      diagnostics: { qualityCorrectionApplied: true, initialQuality, finalQuality },
    };
  }

  async healthCheck(): Promise<AiHealth> {
    const startedAt = Date.now();
    await this.request({ model: this.model, max_tokens: 1, messages: [{ role: "user", content: "只回复 OK" }] }, 12_000);
    return { ok: true, model: this.model, latencyMs: Date.now() - startedAt, message: "AI 接口连接正常" };
  }
}

export async function getAiProvider(userId?: string): Promise<AiProvider> {
  const config = userId ? await getEnabledProviderConfig(userId, "text") : null;
  if (config?.provider === "google" || config?.provider === "seedream") throw new AiProviderError("当前文案生成仅支持 OpenAI-compatible Provider。", "CONFIG_MISSING", 400);
  return new OpenAiCompatibleProvider(config ?? undefined);
}

export async function generateXiaohongshuPost(userId: string, input: XiaohongshuGenerationInput, images: AiImage[] = []) {
  return (await getAiProvider(userId)).generateXiaohongshuPost(input, images);
}

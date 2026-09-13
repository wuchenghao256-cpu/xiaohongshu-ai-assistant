import type { GeneratedImage, ImageGenerationInput } from "@/lib/image-ai/types";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";

export interface ImageGenerationProvider {
  readonly name: string;
  readonly model: string;
  readonly qualityPreset: string;
  readonly maxOutputs: number;
  readonly supportsOutputCount?: boolean;
  generateProductImages(input: ImageGenerationInput): Promise<GeneratedImage[]>;
}

export type ImageProviderFactory = (config: ProviderRuntimeConfig) => ImageGenerationProvider;

export type ImageGenerationFailureCode =
  | "CONFIG_MISSING"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "CONTENT_REJECTED"
  | "REQUEST_FAILED"
  | "INVALID_RESPONSE"
  | "DOWNLOAD_FAILED"
  | "VALIDATION_ERROR"
  | "STORAGE_FAILED";

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: ImageGenerationFailureCode,
    public readonly status = 500,
    /** 第三方返回的原始响应片段，仅用于服务端日志，不会透传到前端。 */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

/**
 * 第三方媒体 API 的错误响应未必是 JSON：网关和 CDN 经常返回 HTML。
 * 这里只截取一小段可读文本用于日志定位，绝不包含密钥。
 */
export function readErrorDetail(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("{") ? trimmed.slice(0, 600) : trimmed.replace(/\s+/g, " ").slice(0, 200);
}

export function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export function logProviderFailure(provider: string, error: unknown, context: Record<string, unknown> = {}) {
  console.error("Image provider call failed", {
    provider,
    status: typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined,
    message: error instanceof Error ? error.message.slice(0, 300) : undefined,
    ...context,
  });
}

/**
 * 把第三方 HTTP 失败映射成可区分、可重试的错误码。429 与 5xx 需要重试；
 * 400 系列里的内容安全拒绝必须直接告诉用户改图，而不是无意义重试。
 */
export function providerHttpError(status: number, body: string): ImageGenerationError {
  const detail = readErrorDetail(body);
  const excerpt = detail ? ` 服务返回：${detail}` : "";
  if (status === 429) {
    return new ImageGenerationError("图片生成服务请求过于频繁，已被限流。", "RATE_LIMITED", 429, detail);
  }
  if (status === 401 || status === 403) {
    return new ImageGenerationError("图片生成服务拒绝了本次鉴权，请检查 API Key 与模型权限。", "CONFIG_MISSING", 502, detail);
  }
  if (status === 408 || status === 504) {
    return new ImageGenerationError("图片生成服务响应超时。", "TIMEOUT", 504, detail);
  }
  if (status === 400 || status === 422) {
    const isContentBlocked = /content|moderation|safety|policy|sensitive|risk|审核|违规|敏感/i.test(detail ?? "");
    if (isContentBlocked) {
      return new ImageGenerationError("图片生成服务以内容安全策略拒绝了本次请求。", "CONTENT_REJECTED", 400, detail);
    }
    return new ImageGenerationError(`图片生成请求被拒绝（HTTP ${status}）。${excerpt}`, "REQUEST_FAILED", 400, detail);
  }
  if (status >= 500) {
    return new ImageGenerationError(`图片生成服务暂时不可用（HTTP ${status}）。${excerpt}`, "PROVIDER_ERROR", 502, detail);
  }
  return new ImageGenerationError(`图片生成服务请求失败（HTTP ${status}）。${excerpt}`, "REQUEST_FAILED", 502, detail);
}

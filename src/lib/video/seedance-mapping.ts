import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import type { VideoJobInput } from "@/lib/video/types";

/**
 * Seedance 2.0 的纯映射逻辑：请求体组装、状态映射与错误翻译。
 * 这里不引入任何运行期依赖，便于直接用 node --test 验证；
 * 网络与重试逻辑位于 seedance.ts。
 */

/** 方舟的“多模态参考生视频”与“首帧生视频”是互斥场景；Seedance 2.0 走多模态参考。 */
export const REFERENCE_IMAGE_ROLE = "reference_image";

export type SeedanceStatus = "queued" | "generating" | "completed" | "failed";

export class SeedanceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 502) {
    super(message);
    this.name = "SeedanceError";
    this.code = code;
    this.status = status;
  }
}

type ArkContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role: typeof REFERENCE_IMAGE_ROLE }
  | { type: "video_url"; video_url: { url: string }; role: "reference_video" }
  | { type: "audio_url"; audio_url: { url: string }; role: "reference_audio" };

/**
 * 组装 content 数组。当前第一版只提交图片与文本，但结构上按官方定义保留
 * reference_video / reference_audio，后续增加参考视频与参考音频无需改协议。
 */
export function buildSeedanceContent(
  prompt: string,
  options: { referenceImages?: string[]; referenceVideos?: string[]; referenceAudios?: string[] } = {},
): ArkContentItem[] {
  const content: ArkContentItem[] = [{ type: "text", text: prompt }];
  for (const url of options.referenceImages ?? []) {
    content.push({ type: "image_url", image_url: { url }, role: REFERENCE_IMAGE_ROLE });
  }
  for (const url of options.referenceVideos ?? []) {
    content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
  }
  for (const url of options.referenceAudios ?? []) {
    content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  }
  return content;
}

export function targetRatio(input: VideoJobInput) {
  return input.orientation === "portrait" ? "9:16" : "16:9";
}

/** 广告片尊重用户选择的清晰度；Seedance 2.0 标准版支持 1080p，2.0 fast 最高 720p。 */
export function targetResolution(input: VideoJobInput, config: ProviderRuntimeConfig) {
  if (config.model.includes("fast")) return "720p";
  if (input.kind === "product_ad") return input.resolution;
  return "720p";
}

/** 方舟请求体。参数名与取值范围严格对应官方 Seedance 2.0 文档。 */
export function buildSeedanceRequestBody(config: ProviderRuntimeConfig, input: VideoJobInput, prompt: string, urls: string[]) {
  return {
    model: config.model,
    content: buildSeedanceContent(prompt, { referenceImages: urls }),
    resolution: targetResolution(input, config),
    ratio: targetRatio(input),
    duration: input.duration,
    generate_audio: input.generateAudio,
    watermark: false,
  };
}

/** 方舟状态：queued / running / succeeded / failed / expired。 */
export function mapSeedanceStatus(raw: string): SeedanceStatus {
  const status = raw.toLowerCase();
  if (status === "queued") return "queued";
  if (status === "succeeded") return "completed";
  if (status === "failed" || status === "expired" || status === "canceled" || status === "cancelled") return "failed";
  return "generating";
}

function errorFields(payload: unknown) {
  const body = payload as { error?: { code?: string; message?: string } } | null;
  const code = (body?.error?.code ?? "").toLowerCase();
  const message = (body?.error?.message ?? "").toLowerCase();
  return { code, hints: `${code} ${message}` };
}

/**
 * 把方舟的错误翻译成用户可以看懂的中文说明。
 * 不向用户暴露 stack trace、原始 JSON、SQL、文件路径或 API Key。
 */
export function mapSeedanceError(status: number, payload: unknown): SeedanceError {
  const { code, hints } = errorFields(payload);

  if (status === 401) {
    return new SeedanceError("API Key 无效，请在系统设置 → 视频模型中重新填写火山方舟密钥。", "ARK_UNAUTHORIZED", 401);
  }
  if (status === 403) {
    if (/face|portrait|human|real|肖像|真人|授权/.test(hints)) {
      return new SeedanceError("该真人素材需要先在火山方舟完成肖像授权后才能用于视频生成。", "ARK_PORTRAIT_CONSENT", 403);
    }
    return new SeedanceError("火山方舟拒绝了本次请求，请检查模型是否已开通并遵守内容规范。", "ARK_FORBIDDEN", 403);
  }
  if (status === 429 || /quota|ratelimit|rate_limit|throttl|limit|余额|额度/.test(hints)) {
    return new SeedanceError("当前火山方舟额度不足或请求过于频繁，请稍后重试。", "ARK_QUOTA", 429);
  }
  if (status === 404) {
    return new SeedanceError("Seedance 2.0 尚未开通，或视频任务已过期，请在火山方舟控制台确认。", "ARK_NOT_ENABLED", 404);
  }
  if (status === 400) {
    if (/model|not.?found|access|开通|no.?permission/.test(hints)) {
      return new SeedanceError("Seedance 2.0 尚未开通，请在火山方舟控制台开通该模型。", "ARK_MODEL_UNAVAILABLE", 400);
    }
    if (/sensitive|moderation|content|policy|审核|违规/.test(hints)) {
      return new SeedanceError("内容审核未通过，请调整参考图或描述后重试。", "ARK_CONTENT_REJECTED", 400);
    }
    if (/duration|ratio|resolution|parameter|invalid/.test(hints)) {
      return new SeedanceError("视频参数不受支持，请调整时长、画幅或清晰度后重试。", "ARK_INVALID_PARAMETER", 400);
    }
    return new SeedanceError("视频生成失败，请重试。", "ARK_BAD_REQUEST", 400);
  }
  if (status >= 500) {
    return new SeedanceError("火山方舟暂时不可用，请稍后重试。", "ARK_UNAVAILABLE", 502);
  }
  console.error("Seedance request failed", { status, code: code || "unknown" });
  return new SeedanceError("视频生成失败，请重试。", "ARK_REQUEST_FAILED", 502);
}

/** 任务本身失败时（查询接口已返回 failed），从 payload 推断原因并给出中文说明。 */
export function failureMessage(providerStatus: string, payload: Record<string, unknown>) {
  if (providerStatus.toLowerCase() === "expired") return "视频任务已超时失效，请重新生成。";
  const { hints } = errorFields(payload);
  if (/face|portrait|human|肖像|真人|授权/.test(hints)) {
    return "该真人素材需要先在火山方舟完成肖像授权后才能用于视频生成。";
  }
  if (/sensitive|moderation|content|policy|审核|违规/.test(hints)) {
    return "内容审核未通过，请调整参考图或描述后重试。";
  }
  if (/quota|balance|额|余额/.test(hints)) return "当前火山方舟额度不足。";
  if (/model|access|开通/.test(hints)) return "Seedance 2.0 尚未开通。";
  return "视频生成失败，请重试。";
}

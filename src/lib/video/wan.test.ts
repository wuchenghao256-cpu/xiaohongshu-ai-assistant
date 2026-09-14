/**
 * 阿里云百炼 Wan2.7 图生视频的映射层回归测试。
 *
 * 覆盖本轮新增 Provider 的全部纯逻辑：请求体协议、状态映射（尤其是 UNKNOWN 不能
 * 被当成终态）、错误翻译、以及业务空间专属域名的拼接。不依赖任何运行期模块，
 * 直接用 node --test 执行。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { toUserMessage } from "./errors.ts";
import { categorizeCreateError, categorizePollError, mayHaveCreatedUpstream, withRecoveryHint } from "./error-category.ts";
import { buildVideoPrompt } from "./prompts.ts";
import { videoProductFidelityConstraints } from "../ai/product-fidelity.ts";
import { videoJobInputSchema, withoutIdempotencyKey } from "./types.ts";
import {
  buildWanRequestBody,
  mapWanError,
  mapWanStatus,
  resolveWanBaseUrl,
  shouldRetryWanCreate,
  shouldRetryWanQuery,
  wanFailureMessage,
  WanError,
} from "./wan-mapping.ts";

const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const config = { provider: "alibaba" as const, baseUrl: "", model: "wan2.7-i2v-2026-04-25", apiKey: "sk-test", workspaceId: "my-space", region: "cn-beijing" };

const imageToVideo = videoJobInputSchema.parse({
  kind: "image_to_video", inputPaths: ["u/video-inputs/a.jpg"], prompt: "镜头缓慢推进",
  duration: 5, orientation: "portrait", generateAudio: false, idempotencyKey,
});

test("请求体使用 Wan2.7 新协议：input.media 首帧 + parameters 固定 5 秒 720P 无水印", () => {
  const body = buildWanRequestBody(config, imageToVideo, "保持商品一致", ["https://signed.example/a.jpg?token=x"]);
  assert.equal(body.model, "wan2.7-i2v-2026-04-25");
  assert.equal(body.input.prompt, "保持商品一致");
  assert.deepEqual(body.input.media, [{ type: "first_frame", url: "https://signed.example/a.jpg?token=x" }]);
  assert.equal(body.parameters.resolution, "720P");
  assert.equal(body.parameters.duration, 5);
  assert.equal(body.parameters.prompt_extend, true);
  assert.equal(body.parameters.watermark, false);
});

test("首帧固定取第一张参考图：多图时不会把非首帧当成 first_frame", () => {
  const multi = videoJobInputSchema.parse({
    kind: "product_ad", inputPaths: ["u/video-inputs/1.jpg", "u/video-inputs/2.jpg"], productInfo: "", concept: "",
    duration: 5, orientation: "portrait", resolution: "720p", productCategory: "general", generateAudio: false, idempotencyKey,
  });
  const body = buildWanRequestBody(config, multi, "prompt", ["https://signed.example/1.jpg", "https://signed.example/2.jpg"]);
  assert.deepEqual(body.input.media, [{ type: "first_frame", url: "https://signed.example/1.jpg" }]);
});

test("没有参考图时直接拒绝，避免提交注定失败的首帧任务", () => {
  assert.throws(() => buildWanRequestBody(config, imageToVideo, "prompt", []), (error: unknown) => {
    assert.ok(error instanceof WanError);
    assert.equal(error.code, "WAN_MISSING_FIRST_FRAME");
    return true;
  });
});

test("请求体忽略时长与画幅：本轮不承诺模型做不到的事情", () => {
  const twelve = videoJobInputSchema.parse({
    kind: "product_ad", inputPaths: ["u/video-inputs/1.jpg"], productInfo: "", concept: "",
    duration: 12, orientation: "landscape", resolution: "1080p", productCategory: "general", generateAudio: true, idempotencyKey,
  });
  const body = buildWanRequestBody(config, twelve, "prompt", ["https://signed.example/1.jpg"]);
  assert.equal(body.parameters.duration, 5, "始终提交 5 秒");
  assert.equal(body.parameters.resolution, "720P", "始终提交 720P");
  assert.equal("ratio" in body.parameters, false, "i2v 的输出比例由首帧图决定，不提交 ratio");
});

test("状态映射：PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED 全部收敛到系统状态", () => {
  assert.equal(mapWanStatus("PENDING"), "queued");
  assert.equal(mapWanStatus("RUNNING"), "generating");
  assert.equal(mapWanStatus("SUCCEEDED"), "completed");
  assert.equal(mapWanStatus("FAILED"), "failed");
  assert.equal(mapWanStatus("CANCELED"), "failed");
  assert.equal(mapWanStatus("CANCELLED"), "failed");
});

test("UNKNOWN 保持不确定：既不算完成也不算失败，交给现有轮询链路继续处理", () => {
  assert.equal(mapWanStatus("UNKNOWN"), "unknown");
  assert.equal(mapWanStatus("unknown"), "unknown");
  assert.equal(mapWanStatus(""), "unknown");
  assert.equal(mapWanStatus("SOMETHING_NEW"), "unknown");
});

test("业务空间专属域名：{WorkspaceId}.cn-beijing.maas.aliyuncs.com", () => {
  assert.equal(resolveWanBaseUrl({ workspaceId: "my-space", region: "cn-beijing" }), "https://my-space.cn-beijing.maas.aliyuncs.com");
  // 显式地址优先，且去掉末尾斜杠。
  assert.equal(resolveWanBaseUrl({ baseUrl: "https://custom.example.com/", workspaceId: "my-space" }), "https://custom.example.com");
  // 非法业务空间 ID 不能拼进主机名，退回实测可用的共享域名。
  assert.equal(resolveWanBaseUrl({ workspaceId: "bad_/space", region: "cn-beijing" }), "https://dashscope.aliyuncs.com");
  // 非北京地域退回共享域名，避免拼出错误主机。
  assert.equal(resolveWanBaseUrl({ workspaceId: "my-space", region: "ap-southeast-1" }), "https://dashscope.aliyuncs.com");
  assert.equal(resolveWanBaseUrl({ region: "cn-beijing" }), "https://dashscope.aliyuncs.com");
});

test("业务空间 ID 填错时给出可照做的中文提示，而不是含糊的失败", () => {
  const error = mapWanError(400, { code: "BadRequest.IllegalEndpoint", message: "Workspace endpoint is invalid." });
  assert.equal(error.code, "WAN_INVALID_WORKSPACE");
  assert.match(error.message, /业务空间 ID/);
  // 这类错误可以确定没有提交给 Provider，因此必须归到「可安全重试」而不是走恢复流程。
  assert.equal(categorizeCreateError(error), "rejected");
  assert.equal(mayHaveCreatedUpstream("rejected"), false);
});

test("错误翻译：鉴权 / 额度 / 审核 / 参数 / 服务端错误都给出中文说明", () => {
  assert.equal(mapWanError(401, { code: "InvalidApiKey" }).code, "WAN_UNAUTHORIZED");
  assert.equal(mapWanError(403, { code: "Forbidden", message: "no permission for workspace" }).code, "WAN_WORKSPACE_FORBIDDEN");
  assert.equal(mapWanError(429, { code: "Throttling" }).code, "WAN_QUOTA");
  assert.equal(mapWanError(400, { code: "DataInspectionFailed" }).code, "WAN_CONTENT_REJECTED");
  assert.equal(mapWanError(400, { code: "InvalidParameter", message: "url download failed" }).code, "WAN_INVALID_PARAMETER");
  assert.equal(mapWanError(404, { code: "ModelNotFound" }).code, "WAN_NOT_ENABLED");
  assert.equal(mapWanError(500, { code: "InternalError" }).code, "WAN_UNAVAILABLE");
  assert.equal(mapWanError(400, { code: "Unknown" }).code, "WAN_BAD_REQUEST");
});

test("查询失败时错误嵌在 output 里，也能被识别", () => {
  const error = mapWanError(400, { output: { code: "InvalidParameter", message: "The size does not match" } });
  assert.equal(error.code, "WAN_INVALID_PARAMETER");
});

test("任务失败文案区分取消、审核与额度", () => {
  assert.match(wanFailureMessage("CANCELED", {}), /取消/);
  assert.match(wanFailureMessage("FAILED", { output: { code: "DataInspectionFailed", message: "sensitive content" } }), /审核/);
  assert.match(wanFailureMessage("FAILED", { output: { code: "Arrearage", message: "balance" } }), /额度/);
  assert.equal(wanFailureMessage("FAILED", {}), "视频生成失败，请重试。");
});

test("创建只对限流重试；查询对 5xx 与限流都重试", () => {
  const quota = new WanError("额度不足", "WAN_QUOTA", 429);
  const timeout = new WanError("超时", "WAN_TIMEOUT", 504);
  const unavailable = new WanError("不可用", "WAN_UNAVAILABLE", 502);
  assert.equal(shouldRetryWanCreate(quota), true);
  assert.equal(shouldRetryWanCreate(timeout), false, "超时可能已计费，绝不能重发创建");
  assert.equal(shouldRetryWanCreate(unavailable), false, "5xx 可能已计费，绝不能重发创建");
  assert.equal(shouldRetryWanQuery(unavailable), true);
  assert.equal(shouldRetryWanQuery(quota), true);
  assert.equal(shouldRetryWanQuery(timeout), false);
});

test("创建失败分类：4xx 确定没提交，可安全重试；其余一律走恢复流程", () => {
  assert.equal(categorizeCreateError(new WanError("密钥无效", "WAN_UNAUTHORIZED", 401)), "auth");
  assert.equal(categorizeCreateError(new WanError("参数错误", "WAN_INVALID_PARAMETER", 400)), "rejected");
  assert.equal(categorizeCreateError(new WanError("内容审核", "WAN_CONTENT_REJECTED", 400)), "rejected");
  assert.equal(categorizeCreateError(new WanError("限流", "WAN_QUOTA", 429)), "rate_limited");
  assert.equal(categorizeCreateError(new WanError("超时", "WAN_TIMEOUT", 504)), "timeout");
  assert.equal(categorizeCreateError(new WanError("不可用", "WAN_UNAVAILABLE", 502)), "unavailable");
  assert.equal(categorizeCreateError(new WanError("连不上", "WAN_UNREACHABLE", 502)), "network");
  assert.equal(categorizeCreateError(new WanError("没有 task_id", "WAN_INVALID_RESPONSE", 502)), "invalid_response");

  // 「可能已经计费」的四类必须走恢复流程，而不是提示用户重试。
  assert.equal(mayHaveCreatedUpstream("timeout"), true);
  assert.equal(mayHaveCreatedUpstream("invalid_response"), true);
  assert.match(withRecoveryHint("阿里云百炼响应超时。", "timeout"), /不要重复提交/);
  assert.match(withRecoveryHint("参考图或视频参数不受支持。", "rejected"), /额度未消耗/);
});

test("轮询错误分类能识别百炼的错误码", () => {
  assert.equal(categorizePollError(new WanError("超时", "WAN_TIMEOUT", 504)), "timeout");
  assert.equal(categorizePollError(new WanError("连不上", "WAN_UNREACHABLE", 502)), "network");
  assert.equal(categorizePollError(new WanError("不可用", "WAN_UNAVAILABLE", 502)), "unavailable");
  assert.equal(categorizePollError(new WanError("服务端拒绝", "WAN_BAD_REQUEST", 400)), "server");
});

test("toUserMessage 原样透出百炼的中文提示，其它错误回退到通用文案", () => {
  assert.equal(toUserMessage(new WanError("当前百炼额度不足或请求过于频繁，请稍后重试。", "WAN_QUOTA", 429)), "当前百炼额度不足或请求过于频繁，请稍后重试。");
  assert.equal(toUserMessage(new Error("connection string leaked")), "视频生成失败，请重试。");
  assert.equal(toUserMessage(new Error("boom"), "参考图地址无效。"), "参考图地址无效。");
});

test("Wan 复用现有视频 Prompt：商品保真约束与 [图1] 约定一字未改", () => {
  const prompt = buildVideoPrompt(imageToVideo);
  assert.match(prompt, /参考 \[图1\] 中的商品/);
  assert.match(prompt, /保持原有外观、颜色、材质、Logo 与文字完全不变/);
  assert.ok(prompt.includes(videoProductFidelityConstraints), "商品保真约束必须原样保留");
  assert.match(prompt, /Do not redesign the product/);
  assert.match(prompt, /no watermark/i);
  assert.match(prompt, /packaging structure/i);
});

test("存库前移除幂等令牌，重新生成会得到新任务", () => {
  const stored = withoutIdempotencyKey(imageToVideo) as Record<string, unknown>;
  assert.equal("idempotencyKey" in stored, false);
  assert.equal(videoJobInputSchema.parse(stored).kind, "image_to_video");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSeedanceContent,
  buildSeedanceRequestBody,
  failureMessage,
  mapSeedanceError,
  mapSeedanceStatus,
  REFERENCE_IMAGE_ROLE,
} from "./seedance-mapping.ts";
import { buildVideoPrompt } from "./prompts.ts";
import { hasPollingTimedOut, isDueForPoll, isStrandedQueuedJob, pollDelaySeconds } from "./poll-schedule.ts";
import { videoJobInputSchema, withoutIdempotencyKey } from "./types.ts";

const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const config = { provider: "volcengine" as const, baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiKey: "test", model: "doubao-seedance-2-0-260128" };

test("多模态参考图按官方结构提交，role 与 image_url 同级，图片不做纯文本转换", () => {
  const content = buildSeedanceContent("保持商品一致", { referenceImages: ["https://a/1.jpg", "https://a/2.jpg"] });
  assert.equal(content[0].type, "text");
  assert.deepEqual(content[1], { type: "image_url", image_url: { url: "https://a/1.jpg" }, role: REFERENCE_IMAGE_ROLE });
  const second = content[2];
  assert.equal(second.type === "image_url" && second.role, REFERENCE_IMAGE_ROLE);
  assert.equal(content.length, 3);
});

test("为参考视频与参考音频保留扩展位，不写死只能接图片", () => {
  const content = buildSeedanceContent("prompt", {
    referenceImages: ["https://a/1.jpg"],
    referenceVideos: ["https://a/v.mp4"],
    referenceAudios: ["https://a/a.mp3"],
  });
  assert.deepEqual(content.map((item) => item.type), ["text", "image_url", "video_url", "audio_url"]);
  const [, , video, audio] = content;
  assert.equal(video.type === "video_url" && video.role, "reference_video");
  assert.equal(audio.type === "audio_url" && audio.role, "reference_audio");
});

test("请求体使用官方参数名，且广告片可提交 1080p、fast 模型降级为 720p", () => {
  const input = videoJobInputSchema.parse({
    kind: "product_ad", inputPaths: ["u/video-inputs/a.jpg"], productInfo: "", concept: "",
    duration: 12, orientation: "portrait", resolution: "1080p", productCategory: "fashion", generateAudio: true, idempotencyKey,
  });
  const body = buildSeedanceRequestBody(config, input, "prompt", ["https://a/1.jpg"]);
  assert.equal(body.model, "doubao-seedance-2-0-260128");
  assert.equal(body.ratio, "9:16");
  assert.equal(body.resolution, "1080p");
  assert.equal(body.duration, 12);
  assert.equal(body.generate_audio, true);
  assert.equal(body.watermark, false);
  assert.equal("camera_fixed" in body, false, "Seedance 2.0 不支持 camera_fixed");

  const fast = buildSeedanceRequestBody({ ...config, model: "doubao-seedance-2-0-fast-260128" }, input, "prompt", []);
  assert.equal(fast.resolution, "720p", "fast 模型最高 720p");
});

test("方舟状态映射到系统统一状态，原始状态不进入 UI", () => {
  assert.equal(mapSeedanceStatus("queued"), "queued");
  assert.equal(mapSeedanceStatus("running"), "generating");
  assert.equal(mapSeedanceStatus("succeeded"), "completed");
  assert.equal(mapSeedanceStatus("failed"), "failed");
  assert.equal(mapSeedanceStatus("expired"), "failed");
  assert.equal(mapSeedanceStatus("anything-else"), "generating");
});

test("错误映射覆盖 401 / 额度 / 未开通 / 参数 / 审核 / 5xx，且不泄露原始信息", () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { error: { code: "AuthenticationError" } }, "API Key 无效，请在系统设置 → 视频模型中重新填写火山方舟密钥。"],
    [429, { error: { code: "QuotaExceeded" } }, "当前火山方舟额度不足或请求过于频繁，请稍后重试。"],
    [404, { error: { code: "NotFound" } }, "Seedance 2.0 尚未开通，或视频任务已过期，请在火山方舟控制台确认。"],
    [400, { error: { code: "InvalidParameter" } }, "视频参数不受支持，请调整时长、画幅或清晰度后重试。"],
    [400, { error: { code: "SensitiveContent" } }, "内容审核未通过，请调整参考图或描述后重试。"],
    [500, { error: { code: "InternalError" } }, "火山方舟暂时不可用，请稍后重试。"],
  ];
  for (const [status, payload, expected] of cases) {
    assert.equal(mapSeedanceError(status, payload).message, expected);
  }
  const portrait = mapSeedanceError(403, { error: { code: "RiskControlReject", message: "real face detected" } });
  assert.equal(portrait.message, "该真人素材需要先在火山方舟完成肖像授权后才能用于视频生成。");
  assert.equal(portrait.status, 403);
});

test("真人肖像与超时给出明确中文说明而不是 Provider Error", () => {
  assert.equal(
    failureMessage("failed", { error: { code: "RiskControlReject", message: "portrait consent required" } }),
    "该真人素材需要先在火山方舟完成肖像授权后才能用于视频生成。",
  );
  assert.equal(failureMessage("expired", {}), "视频任务已超时失效，请重新生成。");
  assert.equal(failureMessage("failed", {}), "视频生成失败，请重试。");
});

test("请求校验：广告片最多 9 张参考图，UGC 需要人物与商品两张图", () => {
  const tooMany = videoJobInputSchema.safeParse({
    kind: "product_ad", inputPaths: Array.from({ length: 10 }, (_, index) => `u/video-inputs/${index}.jpg`),
    duration: 10, orientation: "portrait", resolution: "720p",
  });
  assert.equal(tooMany.success, false, "超过方舟 9 张参考图上限必须被拒绝");

  const ugc = videoJobInputSchema.safeParse({
    kind: "product_ugc", inputPaths: ["u/video-inputs/a.jpg"], productInfo: "", script: "介绍一下这个商品",
    duration: 12, orientation: "portrait",
  });
  assert.equal(ugc.success, false, "AI UGC 必须同时提供人物与商品参考图");
});

test("存库快照移除幂等令牌，重新生成不会命中唯一索引", () => {
  const input = videoJobInputSchema.parse({
    kind: "image_to_video", inputPaths: ["u/video-inputs/a.jpg"], prompt: "镜头推进",
    duration: 5, orientation: "portrait", idempotencyKey,
  });
  assert.equal(input.idempotencyKey, idempotencyKey);
  assert.equal("idempotencyKey" in withoutIdempotencyKey(input), false);
});

test("商品类型不是写死的服装：不同品类生成不同的多镜头节奏", () => {
  const base = {
    kind: "product_ad" as const, inputPaths: ["u/video-inputs/a.jpg"], productInfo: "", concept: "",
    duration: 12, orientation: "portrait" as const, resolution: "720p" as const, generateAudio: false,
  };
  const fashion = buildVideoPrompt(videoJobInputSchema.parse({ ...base, productCategory: "fashion" }));
  const beauty = buildVideoPrompt(videoJobInputSchema.parse({ ...base, productCategory: "beauty" }));
  assert.match(fashion, /服饰/);
  assert.match(beauty, /美妆个护/);
  assert.notEqual(fashion, beauty);
  // 三个功能都必须声明商品一致性约束
  for (const prompt of [fashion, beauty]) {
    assert.match(prompt, /商品身份必须保持一致/);
    assert.match(prompt, /Logo/);
  }
});

test("轮询节奏递增且有上限：不会每秒请求方舟", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(pollDelaySeconds), [5, 10, 15, 20, 25, 30, 30]);
  const now = Date.parse("2026-09-13T00:00:00.000Z");
  assert.equal(isDueForPoll(null, 0, now), true, "首次立即查询");
  assert.equal(isDueForPoll(new Date(now - 3_000).toISOString(), 0, now), false, "刚查过 5 秒内不重复查询");
  assert.equal(isDueForPoll(new Date(now - 6_000).toISOString(), 0, now), true);
  assert.equal(isDueForPoll(new Date(now - 6_000).toISOString(), 1, now), false, "第二次轮询至少间隔 10 秒");
});

test("总超时后停止轮询，中断的提交不会永远停留在排队中", () => {
  const now = Date.parse("2026-09-13T00:00:00.000Z");
  const long = new Date(now - 46 * 60 * 1000).toISOString();
  const recent = new Date(now - 60 * 1000).toISOString();
  assert.equal(hasPollingTimedOut(long, now), true);
  assert.equal(hasPollingTimedOut(recent, now), false);
  assert.equal(hasPollingTimedOut(null, now), false);

  assert.equal(isStrandedQueuedJob({ status: "queued", external_task_id: null, created_at: long }, now), true);
  assert.equal(isStrandedQueuedJob({ status: "queued", external_task_id: null, created_at: recent }, now), false);
  assert.equal(isStrandedQueuedJob({ status: "queued", external_task_id: "cgt-1", created_at: long }, now), false);
  assert.equal(isStrandedQueuedJob({ status: "generating", external_task_id: null, created_at: long }, now), false);
});

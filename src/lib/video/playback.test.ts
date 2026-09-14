/**
 * 视频 Provider 选择规则与播放地址的回归测试。
 *
 * 覆盖本轮修复的两个 blocker 的纯逻辑部分：
 *   1. 多条 enabled 的视频 Provider（Seedance + Wan 同时启用）必须按明确优先级
 *      稳定选出 alibaba，而不是因为 .maybeSingle() 拿到多行而报错。
 *   2. 播放地址必须「Storage 签名地址 > Provider 临时地址」，因为 Wan 的
 *      output_url 只有 24 小时有效期，刷新页面后历史视频必须仍能播放。
 *
 * 这两个模块刻意不引入任何运行期依赖，因此可以直接用 node --test 执行。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isPersistedAsset,
  isOversizedDeclaredLength,
  isRetriableDownloadStatus,
  isUniqueViolation,
  isUsableVideoSize,
  isVideoProviderName,
  MAX_VIDEO_BYTES,
  needsPersistence,
  pickProviderByPriority,
  resolvePlaybackUrl,
  VIDEO_PROVIDER_PRIORITY,
} from "./playback.ts";

const video = (provider: string, enabled = true) => ({ category: "video", provider, enabled });

test("优先级顺序：alibaba > volcengine(Seedance) > runway", () => {
  assert.deepEqual([...VIDEO_PROVIDER_PRIORITY], ["alibaba", "volcengine", "runway"]);
  assert.equal(isVideoProviderName("alibaba"), true);
  assert.equal(isVideoProviderName("volcengine"), true);
  assert.equal(isVideoProviderName("runway"), true);
  // 图片 / 文案 Provider 不是视频 Provider，不能被选进视频链路。
  assert.equal(isVideoProviderName("seedream"), false);
  assert.equal(isVideoProviderName("openai"), false);
});

test("两个视频 Provider 同时启用时，稳定选出 Alibaba（不报错，不依赖只有一条）", () => {
  // 输入顺序刻意打乱：结果必须由优先级决定，而不是由数据库返回顺序决定。
  const picked = pickProviderByPriority([video("runway"), video("volcengine"), video("alibaba")], "video");
  assert.equal(picked?.provider, "alibaba");

  // 数据库按 provider 排序返回时的顺序。
  const sorted = pickProviderByPriority([video("alibaba"), video("runway"), video("volcengine")], "video");
  assert.equal(sorted?.provider, "alibaba");
});

test("Alibaba 未启用时退回 Seedance；Seedance 也未启用才用 Runway", () => {
  assert.equal(pickProviderByPriority([video("runway"), video("volcengine")], "video")?.provider, "volcengine");
  assert.equal(pickProviderByPriority([video("runway")], "video")?.provider, "runway");
});

test("Alibaba 启用但 Seedance 也启用、而 Runway 关闭时仍然是 Alibaba", () => {
  const picked = pickProviderByPriority([video("volcengine"), video("runway", false), video("alibaba")], "video");
  assert.equal(picked?.provider, "alibaba", "关闭的 Provider 不参与选择");
});

test("没有任何启用的视频 Provider 时返回 null，而不是抛错", () => {
  assert.equal(pickProviderByPriority([], "video"), null);
  assert.equal(pickProviderByPriority([video("alibaba", false), video("volcengine", false)], "video"), null);
});

test("只挑选 video category：图片 Provider 启用不会污染视频链路", () => {
  const configs = [
    { category: "image", provider: "seedream", enabled: true },
    video("runway"),
  ];
  assert.equal(pickProviderByPriority(configs, "video")?.provider, "runway");
});

test("未知 Provider 排在所有已知项之后，且同分时结果稳定", () => {
  const configs = [...[video("zeta"), video("alpha")]];
  assert.equal(pickProviderByPriority(configs, "video")?.provider, "alpha", "按 provider 名稳定排序");
  // 已知 Provider 永远优先于未知 Provider。
  assert.equal(pickProviderByPriority([...configs, video("runway")], "video")?.provider, "runway");
});

test("已保存视频优先使用 Storage 签名地址，而不是 Provider 的临时地址", () => {
  const temporary = "https://dashscope-result.oss-cn-beijing.aliyuncs.com/tmp/abc.mp4?Expires=123";
  const signed = "https://proj.supabase.co/storage/v1/object/sign/video-assets/u/1.mp4?token=x";
  assert.equal(resolvePlaybackUrl({ signedUrl: signed }, temporary), signed);
});

test("尚未保存时才回落到 Provider 临时地址", () => {
  const temporary = "https://dashscope-result.oss-cn-beijing.aliyuncs.com/tmp/abc.mp4";
  assert.equal(resolvePlaybackUrl(null, temporary), temporary);
  assert.equal(resolvePlaybackUrl({ signedUrl: null }, temporary), temporary);
  assert.equal(resolvePlaybackUrl({ signedUrl: "  " }, temporary), temporary, "空白签名地址不算数");
});

test("两者都没有时返回 null，让 UI 不渲染空的 <video>", () => {
  assert.equal(resolvePlaybackUrl(null, null), null);
  assert.equal(resolvePlaybackUrl(undefined, undefined), null);
  assert.equal(resolvePlaybackUrl({ signedUrl: null }, ""), null);
  assert.equal(resolvePlaybackUrl({ signedUrl: "   " }, "   "), null);
});

test("isPersistedAsset 以 storage_path 是否存在为准", () => {
  assert.equal(isPersistedAsset({ id: "1", storage_path: "u/1.mp4", original_name: "a.mp4", size_bytes: 10 }), true);
  assert.equal(isPersistedAsset(null), false);
  assert.equal(isPersistedAsset(undefined), false);
  assert.equal(isPersistedAsset({}), false);
  // saved 标记来自前端，不能代替数据库记录；没有 storage_path 一律视为未保存。
  assert.equal(isPersistedAsset({ id: "1", saved: true }), false);
});

// ============================================================================
// 转存判定：决定「什么时候保存」和「重复 poll 为什么不会重复保存」
// ============================================================================

const completedJob = { status: "completed", output_url: "https://provider.example/tmp/a.mp4" };
const storedAsset = { id: "a1", storage_path: "u/1.mp4", original_name: "AI视频.mp4", size_bytes: 1024 };

test("completed Wan job 需要自动持久化", () => {
  assert.equal(needsPersistence(completedJob, null), true);
  assert.equal(needsPersistence(completedJob, undefined), true);
});

test("重复 poll 不重复保存：已有 video_assets 记录就跳过", () => {
  // 第二次、第三次刷新看到的是同一条已入库记录，因此都不会再下载/上传。
  assert.equal(needsPersistence(completedJob, storedAsset), false);
  assert.equal(needsPersistence(completedJob, storedAsset), false);
});

test("未完成、失败、或缺临时地址的任务都不触发转存", () => {
  assert.equal(needsPersistence({ status: "generating", output_url: null }, null), false);
  assert.equal(needsPersistence({ status: "queued", output_url: null }, null), false);
  assert.equal(needsPersistence({ status: "failed", output_url: "https://x/a.mp4" }, null), false);
  // completed 但没有临时地址：没有东西可下载，不触发。
  assert.equal(needsPersistence({ status: "completed", output_url: null }, null), false);
});

test("唯一约束冲突（23505）被当成「已保存」，不是错误", () => {
  assert.equal(isUniqueViolation("23505"), true);
  assert.equal(isUniqueViolation("42P01"), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
});

test("临时地址过期（403/404）不重试；瞬时故障（408/429/5xx）才重试", () => {
  assert.equal(isRetriableDownloadStatus(403), false, "过期地址重试只会白等");
  assert.equal(isRetriableDownloadStatus(404), false, "过期地址重试只会白等");
  assert.equal(isRetriableDownloadStatus(408), true);
  assert.equal(isRetriableDownloadStatus(429), true);
  assert.equal(isRetriableDownloadStatus(500), true);
  assert.equal(isRetriableDownloadStatus(502), true);
});

test("体积上限与 video_assets.size_bytes 的 check 约束一致（100MB）", () => {
  assert.equal(MAX_VIDEO_BYTES, 100 * 1024 * 1024);
  assert.equal(isOversizedDeclaredLength(MAX_VIDEO_BYTES + 1), true);
  assert.equal(isOversizedDeclaredLength(MAX_VIDEO_BYTES), false);
  // content-length 缺失（0）时不拦截，交给实际读取后的字节数判断。
  assert.equal(isOversizedDeclaredLength(0), false);
});

test("空响应与超限响应都不上传", () => {
  assert.equal(isUsableVideoSize(0), false);
  assert.equal(isUsableVideoSize(1024), true);
  assert.equal(isUsableVideoSize(MAX_VIDEO_BYTES), true);
  assert.equal(isUsableVideoSize(MAX_VIDEO_BYTES + 1), false);
});

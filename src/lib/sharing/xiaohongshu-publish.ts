/**
 * 小红书发布助手的纯逻辑：最终文案拼装、视频文件名、按钮状态与失败后的回退决策。
 *
 * 与 playback.ts 同一套路 —— 刻意不 import 任何运行期依赖（不 import server-only、
 * 不 import React），因此可以直接用 `node --test` 验证「什么时候该走系统分享、
 * 什么时候必须回退成下载」。这条决策是本次交付里最容易出错的地方：
 * 用户在分享面板上按了取消，和分享真的失败，是两件完全不同的事。
 */

export type PublishCopy = { title: string; body: string; hashtags: string[] };

/** 与 xiaohongshu-share-actions.tsx 的 finalCopy 保持一致：标题、正文、话题各成一段。 */
export function composeFinalCopy(copy: PublishCopy): string {
  const hashtags = copy.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ");
  return [copy.title.trim(), copy.body.trim(), hashtags].filter(Boolean).join("\n\n");
}

/**
 * 分享出去的视频文件名。
 *
 * 必须是 ASCII 且带 .mp4 后缀：`navigator.share` 的 File 名字会原样出现在系统分享
 * 面板和目标 App 里，中文名在部分 Android 机型上会变成乱码或让 canShare 直接返回 false。
 */
export function shareVideoFileName(jobId: string) {
  return `xiaohongshu-video-${jobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "clip"}.mp4`;
}

/** 是否具备调用系统分享面板的能力。两个 API 必须同时存在，缺一个都不能用。 */
export function canUseSystemShare(hasShare: unknown, hasCanShare: unknown) {
  return typeof hasShare === "function" && typeof hasCanShare === "function";
}

export type PrepareOutcome =
  | { kind: "shared" }
  /** 用户自己取消了分享面板。文案已经复制成功，不该当成失败报错。 */
  | { kind: "cancelled" }
  /** 不能分享（设备不支持或面板报错）—— 必须回退成「下载视频 + 提示文案已复制」。 */
  | { kind: "fallback"; reason: string }
  /** 连准备都没完成（取视频失败 / 剪贴板失败），没有可回退的东西。 */
  | { kind: "failed"; reason: string };

type ShareErrorLike = { name?: string; message?: string };

/**
 * 把系统分享的结果收敛成四种结局之一。
 *
 * 最关键的一条：`AbortError` 表示用户主动取消，而不是分享失败。各家实现里它可能
 * 是 DOMException，也可能只是一个带 name 的普通对象，因此按 name 判断而不是 instanceof。
 */
export function classifyShareOutcome(error?: ShareErrorLike | null): PrepareOutcome {
  if (!error) return { kind: "shared" };
  if (error.name === "AbortError") return { kind: "cancelled" };
  // NotAllowedError：页面没有用户手势上下文（分享面板被浏览器拒绝打开）。
  // 这种情况下系统分享确实没发生，回退成下载是唯一能让用户拿到视频的路径。
  return { kind: "fallback", reason: error.message?.trim() || "系统分享面板无法打开。" };
}

/** 主按钮文案。任何状态都不写「自动发布」—— 本功能只准备素材，不代替用户发布。 */
export function prepareButtonLabel(state: "idle" | "preparing" | "sharing") {
  return state === "preparing" ? "正在准备…" : state === "sharing" ? "正在打开分享面板…" : "一键准备发布";
}

/**
 * 未选择时的提示。返回 null 表示可以提交。
 * 视频是硬性条件 —— 没有视频的「视频发布助手」没有意义。
 */
export function missingSelection(videoId: string | null, copyId: string | null) {
  if (!videoId) return "请先选择一条已生成的视频。";
  if (!copyId) return "请先选择一条已生成的文案。";
  return null;
}

/** 回退路径下给用户的提示：必须同时点明「视频已保存」和「文案已复制」，否则用户会以为丢了东西。 */
export const FALLBACK_NOTICE = "视频已保存，文案已复制，请打开小红书完成发布。";

/**
 * 封面候选。`source` 只用于给用户看「这张是哪来的」，不参与任何发布决策。
 *
 * 封面保持**可选**：没有任何候选时整个封面区块收起，而不是显示一个空框。
 * 这里只去重不排序也不截断 —— 数量由服务端决定，前端按原顺序展示即可。
 */
export type CoverCandidate = { id: string; url: string; label: string; source: "video" | "copy" };

export function coverCandidates(input: {
  videoFrames?: Array<{ id: string; url: string; label: string }>;
  copyImages?: Array<{ id: string; url: string; label: string }>;
}): CoverCandidate[] {
  const seen = new Set<string>();
  const out: CoverCandidate[] = [];
  for (const frame of input.videoFrames ?? []) {
    if (!frame.url || seen.has(frame.id)) continue;
    seen.add(frame.id);
    out.push({ ...frame, source: "video" });
  }
  for (const image of input.copyImages ?? []) {
    if (!image.url || seen.has(image.id)) continue;
    seen.add(image.id);
    out.push({ ...image, source: "copy" });
  }
  return out;
}

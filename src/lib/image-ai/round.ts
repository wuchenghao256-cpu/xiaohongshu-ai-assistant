/**
 * 「一轮创作」的生命周期判定。
 *
 * 一轮创作 = 一个 content_task 累计 9 张图片的额度。额度用满后必须新建 task_id，
 * 新一轮从 0 开始计数；未满的任务（含生成到一半、失败待重试）刷新后仍然复用。
 *
 * 判定只看服务端权威数据：content_task 是否存在 + assets 表里该 task 的行数
 * （与 /api/images/generate 的上限检查同源，否则前后端会对同一轮给出不同结论）。
 * 刻意不看 content_tasks.generation_status——那一列只由文案生成写入，图片流程
 * 永远不会把它置成 generating，靠它会得出错误结论。
 */
export const ROUND_ASSET_LIMIT = 9;

export type RoundState = "none" | "active" | "finished";

export function classifyRound({ hasTask, assetCount }: { hasTask: boolean; assetCount: number }): RoundState {
  if (!hasTask) return "none";
  return assetCount < ROUND_ASSET_LIMIT ? "active" : "finished";
}

export function remainingRoundCapacity(assetCount: number) {
  return Math.max(0, ROUND_ASSET_LIMIT - assetCount);
}

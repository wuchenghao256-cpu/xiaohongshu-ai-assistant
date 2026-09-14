import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";
import { isPersistedAsset } from "@/lib/video/playback";
import { findVideoAsset, persistVideoAsset, signVideoAsset } from "@/lib/video/persist";

/**
 * 手动保存：用户点「保存到作品库」。
 *
 * 转存本身以及重试、幂等、唯一约束冲突的处理全部在 lib/video/persist.ts 里，
 * 与轮询自动保存共用同一条实现 —— 两处各写一套就会在「重试几次、冲突怎么办」
 * 上逐渐漂移。
 *
 * 这里只负责把它包成 HTTP 语义：已经存过返回 200，新存成功返回 201，
 * 暂时失败返回 502 并明确告诉用户「任务仍在，可以稍后重试」。
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const { user, supabase } = await requireUser();

    // 已经存过就直接返回：重复点击不会产生第二份拷贝，也修掉了刷新后
    // 按钮消失、视频无法再入库的问题。同时补一个签名地址，前端拿到即可播放。
    const existing = await findVideoAsset(supabase, id);
    if (isPersistedAsset(existing) && existing) {
      return Response.json({ asset: existing, playbackUrl: await signVideoAsset(supabase, existing) });
    }

    const result = await persistVideoAsset(supabase, user.id, id, { alreadySaved: null });
    if ("asset" in result) {
      return Response.json(
        { asset: result.asset, playbackUrl: await signVideoAsset(supabase, result.asset) },
        { status: result.created ? 201 : 200 },
      );
    }
    if ("skipped" in result) {
      return Response.json({ error: "视频尚未生成完成。" }, { status: 409 });
    }
    return Response.json({ error: "视频保存失败，请稍后重试。视频仍保留在任务列表中。" }, { status: 502 });
  } catch (error) { return jsonError(error); }
}

import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";
import { logVideoEvent } from "@/lib/video/log";

/**
 * 关闭一条没有上游任务 ID 的记录（never_accepted）。
 *
 * 这是唯一会把这类记录从「排队中」迁移出去的操作，并且必须由用户显式触发：
 * 服务端在提交被中断时无法判断方舟是否已经受理，自动标记失败有可能会把一条
 * 正在计费的付费任务从界面上抹掉。用户确认过（例如在方舟控制台查过没有该任务）
 * 再关闭，语义才明确。
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase } = await requireUser();
    const current = await supabase.from("video_jobs").select("status,external_task_id,submitted_at").eq("id", id).single();
    if (current.error) return Response.json({ error: "视频任务不存在。" }, { status: 404 });
    // 已经拿到上游 task id、或者创建请求已经发出（submitted_at 已写）时不允许关闭：
    // 那时候任务很可能正在计费，用户会误以为没花钱。
    if (current.data.external_task_id || current.data.submitted_at || current.data.status !== "queued") {
      return Response.json({ error: "只有从未提交成功的任务可以关闭。" }, { status: 400 });
    }
    const updated = await supabase.from("video_jobs").update({
      status: "never_accepted",
      error_message: "已确认没有生成任务，本次未产生费用。",
    }).eq("id", id).select("id").single();
    if (updated.error) throw updated.error;
    logVideoEvent("discard.user", { jobId: id, status: "never_accepted" });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

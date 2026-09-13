import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

const inputSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().max(120).default(""),
  body: z.string().max(5000).default(""),
  hashtags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

/**
 * 「发布」需要 posts 处于 final 状态才会被发布中心接受，而生成流程创建的草稿行
 * 是 draft。这里把文案与状态一次性提升，并把成图标记为待发布图，
 * 之后统一跳到发布中心，不再重复实现一套发布逻辑。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await context.params;
    const input = inputSchema.parse(await request.json());
    const { user, supabase } = await requireUser();

    const task = await supabase
      .from("content_tasks")
      .select("id, product_name")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (task.error) throw task.error;
    if (!task.data) return Response.json({ error: "任务不存在或无权访问。" }, { status: 404 });

    const title = input.title.trim() || task.data.product_name || "商品图片草稿";
    const existing = await supabase.from("posts").select("id").eq("task_id", taskId).eq("user_id", user.id).maybeSingle();
    if (existing.error) throw existing.error;

    const payload = {
      user_id: user.id,
      task_id: taskId,
      title,
      body: input.body,
      hashtags: input.hashtags,
      status: "final" as const,
      publish_status: "draft" as const,
      error_message: null,
    };
    const saved = existing.data
      ? await supabase.from("posts").update(payload).eq("id", existing.data.id).select("id").single()
      : await supabase.from("posts").insert(payload).select("id").single();
    if (saved.error) throw saved.error;

    // 发布中心要求至少一张 selected_for_publishing 的图片；生成的图片都应该是候选。
    const selected = await supabase
      .from("assets")
      .update({ selected_for_publishing: true })
      .eq("task_id", taskId)
      .eq("user_id", user.id)
      .select("id");
    if (selected.error) throw selected.error;

    return Response.json({ postId: saved.data.id, imageCount: (selected.data ?? []).length });
  } catch (error) { return jsonError(error); }
}

import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

const inputSchema = z.object({ variantId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await context.params;
    const { variantId } = inputSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const selected = await supabase.from("post_variants").select("*").eq("id", variantId).eq("task_id", taskId).single();
    if (selected.error) throw selected.error;
    const clear = await supabase.from("post_variants").update({ is_final: false }).eq("task_id", taskId);
    if (clear.error) throw clear.error;
    const mark = await supabase.from("post_variants").update({ is_final: true }).eq("id", variantId);
    if (mark.error) throw mark.error;
    const saved = await supabase.from("posts").upsert({
      user_id: user.id,
      task_id: taskId,
      title: selected.data.title,
      body: selected.data.body,
      hashtags: selected.data.hashtags,
      status: "final",
      publish_status: "draft",
    }, { onConflict: "task_id" }).select("*").single();
    if (saved.error) throw saved.error;
    return Response.json({ post: saved.data });
  } catch (error) { return jsonError(error); }
}

import { jsonError } from "@/lib/http";
import { draftSelectColumns, draftUpdateSchema, toDraftRow, type ContentDraftRow } from "@/lib/drafts/types";
import { requireUser } from "@/lib/supabase/auth";

async function loadDraft(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { user, supabase } = await requireUser();
  return { id, user, supabase };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id, user, supabase } = await loadDraft(context);
    const input = draftUpdateSchema.parse(await request.json());
    const { status, ...payload } = input;
    const update: Record<string, unknown> = toDraftRow(payload);
    if (status) {
      update.status = status;
      // published_at 只做「第一次发布」的时间戳，重复点发布不会覆盖历史时间。
      if (status === "published") update.published_at = new Date().toISOString();
    }
    const { data, error } = await supabase
      .from("content_drafts")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(draftSelectColumns)
      .single();
    if (error) throw error;
    return Response.json({ draft: data as ContentDraftRow });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id, user, supabase } = await loadDraft(context);
    const { error } = await supabase.from("content_drafts").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

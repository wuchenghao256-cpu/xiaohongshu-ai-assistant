import { jsonError } from "@/lib/http";
import { draftPayloadSchema, draftSelectColumns, toDraftRow, type ContentDraftRow } from "@/lib/drafts/types";
import { requireUser } from "@/lib/supabase/auth";

export async function GET(request: Request) {
  try {
    const status = new URL(request.url).searchParams.get("status");
    const { user, supabase } = await requireUser();
    let query = supabase
      .from("content_drafts")
      .select(draftSelectColumns)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (status === "draft" || status === "published") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json({ drafts: (data ?? []) as ContentDraftRow[] });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const input = draftPayloadSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const { data, error } = await supabase
      .from("content_drafts")
      .insert({ user_id: user.id, task_id: input.taskId, ...toDraftRow(input) })
      .select(draftSelectColumns)
      .single();
    if (error) throw error;
    return Response.json({ draft: data as ContentDraftRow }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

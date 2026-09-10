import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";
import { templateSelectColumns, templateUpdateSchema, toTemplateRow } from "@/lib/templates/types";

const idSchema = z.string().uuid();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    idSchema.parse(id);
    const input = templateUpdateSchema.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("content_templates")
      .update(toTemplateRow(input))
      .eq("id", id)
      .select(templateSelectColumns)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "模板不存在或无权修改。" }, { status: 404 });
    return Response.json({ template: data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    idSchema.parse(id);
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("content_templates")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "模板不存在或无权删除。" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";
import { templatePayloadSchema, templateSelectColumns, toTemplateRow } from "@/lib/templates/types";

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("content_templates")
      .select(templateSelectColumns)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json({ templates: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = templatePayloadSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const { data, error } = await supabase
      .from("content_templates")
      .insert({ user_id: user.id, ...toTemplateRow(input) })
      .select(templateSelectColumns)
      .single();
    if (error) throw error;
    return Response.json({ template: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

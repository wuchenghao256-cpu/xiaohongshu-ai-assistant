import { postVariantSchema } from "@/lib/ai/types";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = postVariantSchema.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("post_variants").update(input).eq("id", id).select("*").single();
    if (error) throw error;
    return Response.json({ variant: data });
  } catch (error) { return jsonError(error); }
}

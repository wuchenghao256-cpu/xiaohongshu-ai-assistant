import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  hashtags: z.array(z.string().trim().min(1).max(50)).max(20),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("posts").update(input).eq("id", id).select("*").single();
    if (error) throw error;
    return Response.json({ post: data });
  } catch (error) { return jsonError(error); }
}

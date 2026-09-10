import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

const taskSchema = z.object({ productName: z.string().trim().max(120).default("") });

export async function POST(request: Request) {
  try {
    const input = taskSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const { data, error } = await supabase.from("content_tasks").insert({
      user_id: user.id,
      product_name: input.productName,
    }).select("id").single();
    if (error) throw error;
    return Response.json({ taskId: data.id }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

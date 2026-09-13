import { getAiProvider } from "@/lib/ai/client";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

export async function POST() {
  try {
    const { user } = await requireUser();
    return Response.json(await (await getAiProvider(user.id)).healthCheck());
  } catch (error) { return jsonError(error); }
}

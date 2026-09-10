import { getAiProvider } from "@/lib/ai/client";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

export async function POST() {
  try {
    await requireUser();
    return Response.json(await getAiProvider().healthCheck());
  } catch (error) { return jsonError(error); }
}

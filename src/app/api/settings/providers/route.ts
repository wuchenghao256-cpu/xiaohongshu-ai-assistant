import { jsonError } from "@/lib/http";
import { listProviderConfigs, saveProviderConfig } from "@/lib/providers/repository";
import { providerConfigInputSchema } from "@/lib/providers/types";
import { requireUser } from "@/lib/supabase/auth";

export async function GET() { try { const { user } = await requireUser(); return Response.json({ configs: await listProviderConfigs(user.id) }); } catch (error) { return jsonError(error); } }
export async function POST(request: Request) { try { const { user } = await requireUser(); const input = providerConfigInputSchema.parse(await request.json()); return Response.json({ configs: await saveProviderConfig(user.id, input) }); } catch (error) { return jsonError(error); } }

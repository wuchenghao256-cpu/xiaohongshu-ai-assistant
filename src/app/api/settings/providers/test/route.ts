import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { testProviderConnection } from "@/lib/providers/test-connection";
import { providerConfigInputSchema } from "@/lib/providers/types";
import { requireUser } from "@/lib/supabase/auth";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(); const input = providerConfigInputSchema.parse(await request.json());
    const saved = input.apiKey ? null : await getEnabledProviderConfig(user.id, input.category);
    const apiKey = input.apiKey ?? (saved?.provider === input.provider ? saved.apiKey : undefined);
    if (!apiKey) return Response.json({ success: false, provider: input.provider, model: input.model, message: "请先输入 API Key" }, { status: 400 });
    const result = await testProviderConnection({ provider: input.provider, baseUrl: input.baseUrl, model: input.model, apiKey });
    return Response.json({ ...result, provider: input.provider, model: input.model }, { status: result.success ? 200 : 400 });
  } catch (error) { return jsonError(error); }
}

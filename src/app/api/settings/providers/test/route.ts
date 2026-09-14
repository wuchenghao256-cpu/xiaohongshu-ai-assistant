import { jsonError } from "@/lib/http";
import { getDashscopeEnv, hasDashscopeApiKey } from "@/lib/env";
import { getEnabledProviderConfig, withDashscopeEnv } from "@/lib/providers/repository";
import { testProviderConnection } from "@/lib/providers/test-connection";
import { providerConfigInputSchema } from "@/lib/providers/types";
import { requireUser } from "@/lib/supabase/auth";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(); const input = providerConfigInputSchema.parse(await request.json());

    // 阿里云百炼的密钥不在表单里，也不在数据库里：它只能来自服务端环境变量。
    if (input.provider === "alibaba") {
      const env = getDashscopeEnv();
      if (!env) {
        return Response.json({ success: false, provider: input.provider, model: input.model, message: hasDashscopeApiKey() ? "DASHSCOPE_WORKSPACE_ID 或 DASHSCOPE_REGION 配置不正确" : "服务端未配置 DASHSCOPE_API_KEY" }, { status: 400 });
      }
      // 表单填写的业务空间 ID 优先，其次才是环境变量里的那一个。
      const config = withDashscopeEnv({ provider: "alibaba", baseUrl: "", model: input.model, apiKey: env.DASHSCOPE_API_KEY, workspaceId: input.workspaceId ?? env.DASHSCOPE_WORKSPACE_ID, region: input.region ?? env.DASHSCOPE_REGION });
      const result = await testProviderConnection(config!);
      return Response.json({ ...result, provider: input.provider, model: input.model }, { status: result.success ? 200 : 400 });
    }

    const saved = input.apiKey ? null : await getEnabledProviderConfig(user.id, input.category);
    const apiKey = input.apiKey ?? (saved?.provider === input.provider ? saved.apiKey : undefined);
    if (!apiKey) return Response.json({ success: false, provider: input.provider, model: input.model, message: "请先输入 API Key" }, { status: 400 });
    if (!input.baseUrl) return Response.json({ success: false, provider: input.provider, model: input.model, message: "请先填写 API Base URL" }, { status: 400 });
    const result = await testProviderConnection({ provider: input.provider, baseUrl: input.baseUrl, model: input.model, apiKey });
    return Response.json({ ...result, provider: input.provider, model: input.model }, { status: result.success ? 200 : 400 });
  } catch (error) { return jsonError(error); }
}

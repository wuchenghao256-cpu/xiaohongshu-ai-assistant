import { cookies } from "next/headers";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { CreateWorkspace, type CreateWorkspaceInsertAsset } from "@/components/create/create-workspace";
import { getSupabasePublicEnv, getImageAiConfigStatus, hasProviderEncryptionKey } from "@/lib/env";
import { loadCreateSession, type CreateSession } from "@/lib/image-ai/create-session";
import { CURRENT_TASK_COOKIE } from "@/lib/image-ai/current-task-cookie";
import { listProviderConfigs } from "@/lib/providers/repository";
import { getCurrentUser } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import {
  templateSelectColumns,
  type ContentTemplate,
} from "@/lib/templates/types";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ taskId?: string; insertAssetId?: string }>;
}) {
  const { taskId: requestedTaskId, insertAssetId } = await searchParams;
  const configured = Boolean(getSupabasePublicEnv());
  let templates: ContentTemplate[] = [];
  let savedImageProvider = false;
  let initialInsertAsset: CreateWorkspaceInsertAsset | undefined;
  let initialSession: CreateSession | null = null;
  if (configured) {
    const supabase = await createClient();
    const result = await supabase
      .from("content_templates")
      .select(templateSelectColumns)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    templates = (result.data ?? []) as ContentTemplate[];
    const user = await getCurrentUser();
    if (user && hasProviderEncryptionKey()) {
      const providers = await listProviderConfigs(user.id).catch(() => []);
      savedImageProvider = providers.some((item) => item.category === "image" && item.enabled);
    }
    // ?taskId= 是素材库/草稿带过来的显式意图，优先于 cookie 里上一轮的轮次标记。
    const cookieTaskId = (await cookies()).get(CURRENT_TASK_COOKIE)?.value;
    const candidateTaskId = requestedTaskId ?? (z.string().uuid().safeParse(cookieTaskId).success ? cookieTaskId! : null);
    if (user && candidateTaskId) {
      // 服务端按数据库事实判断这一轮还能不能继续用：额度没满就恢复，满了前端就会开新任务。
      initialSession = await loadCreateSession(supabase, user.id, candidateTaskId);
    }
    // 素材库点「插入当前创作」会带 insertAssetId 跳进来，这里先把素材与签名链接准备好，
    // 避免客户端再走一次往返。
    if (user && insertAssetId) {
      const assetResult = await supabase
        .from("assets")
        .select("id,task_id,storage_bucket,storage_path,original_name,size_bytes")
        .eq("id", insertAssetId)
        .maybeSingle();
      if (assetResult.data) {
        const signed = await supabase.storage
          .from(assetResult.data.storage_bucket)
          .createSignedUrl(assetResult.data.storage_path, 3600);
        if (signed.data?.signedUrl) {
          initialInsertAsset = {
            id: assetResult.data.id,
            taskId: assetResult.data.task_id,
            storagePath: assetResult.data.storage_path,
            name: assetResult.data.original_name,
            size: assetResult.data.size_bytes,
            preview: signed.data.signedUrl,
            kind: assetResult.data.original_name.startsWith("AI") ? "generated" : "uploaded",
          };
        }
      }
    }
  }
  return (
    <>
      <PageHeader
        title="创作"
        description="上传商品参考图，选择模板并生成可发布的商品内容"
      />
      <CreateWorkspace
        configured={configured}
        imageAiConfigured={getImageAiConfigStatus().configured || savedImageProvider}
        initialTemplates={templates}
        initialSession={initialSession}
        initialInsertAsset={initialInsertAsset}
      />
    </>
  );
}

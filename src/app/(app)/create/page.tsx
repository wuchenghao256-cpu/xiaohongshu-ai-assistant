import { PageHeader } from "@/components/page-header";
import { CreateWorkspace } from "@/components/create/create-workspace";
import { getImageAiConfigStatus, getSupabasePublicEnv, hasProviderEncryptionKey } from "@/lib/env";
import { listProviderConfigs } from "@/lib/providers/repository";
import { getCurrentUser } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import {
  templateSelectColumns,
  type ContentTemplate,
} from "@/lib/templates/types";

export default async function CreatePage() {
  const configured = Boolean(getSupabasePublicEnv());
  let templates: ContentTemplate[] = [];
  let savedImageProvider = false;
  if (configured) {
    const result = await (await createClient())
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
      />
    </>
  );
}

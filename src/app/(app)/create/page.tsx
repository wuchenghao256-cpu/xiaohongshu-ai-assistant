import { PageHeader } from "@/components/page-header";
import { CreateWorkspace } from "@/components/create/create-workspace";
import { getImageAiConfigStatus, getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  templateSelectColumns,
  type ContentTemplate,
} from "@/lib/templates/types";

export default async function CreatePage() {
  const configured = Boolean(getSupabasePublicEnv());
  let templates: ContentTemplate[] = [];
  if (configured) {
    const result = await (await createClient())
      .from("content_templates")
      .select(templateSelectColumns)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    templates = (result.data ?? []) as ContentTemplate[];
  }
  return (
    <>
      <PageHeader
        title="创作"
        description="上传商品参考图，选择模板并生成可发布的商品内容"
      />
      <CreateWorkspace
        configured={configured}
        imageAiConfigured={getImageAiConfigStatus().configured}
        initialTemplates={templates}
      />
    </>
  );
}

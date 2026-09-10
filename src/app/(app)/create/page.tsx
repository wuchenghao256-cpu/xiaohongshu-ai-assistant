import { PageHeader } from "@/components/page-header";
import { CreateWorkspace } from "@/components/create/create-workspace";
import { getImageAiConfigStatus, getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { templateSelectColumns, type ContentTemplate } from "@/lib/templates/types";

export default async function CreatePage() {
  const configured = Boolean(getSupabasePublicEnv());
  let templates: ContentTemplate[] = [];
  if (configured) {
    const result = await (await createClient()).from("content_templates").select(templateSelectColumns).order("is_default", { ascending: false }).order("updated_at", { ascending: false });
    templates = (result.data ?? []) as ContentTemplate[];
  }
  return <><PageHeader title="创建内容" description="填写产品信息，生成 3 个不同角度的小红书内容版本" /><CreateWorkspace configured={configured} imageAiConfigured={getImageAiConfigStatus().configured} initialTemplates={templates} /></>;
}

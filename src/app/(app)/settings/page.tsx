import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import { AiHealthCheck } from "@/components/settings/ai-health-check";
import { TemplateManager } from "@/components/settings/template-manager";
import { ProviderSettings } from "@/components/settings/provider-settings";
import { getAiConfigStatus, getSupabasePublicEnv, hasProviderEncryptionKey } from "@/lib/env";
import { listProviderConfigs } from "@/lib/providers/repository";
import { getCurrentUser } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { templateSelectColumns, type ContentTemplate } from "@/lib/templates/types";

export default async function SettingsPage() {
  const ai = getAiConfigStatus();
  const supabaseReady = Boolean(getSupabasePublicEnv());
  let templates: ContentTemplate[] = [];
  let providerConfigs = [] as Awaited<ReturnType<typeof listProviderConfigs>>;
  if (supabaseReady) {
    const result = await (await createClient()).from("content_templates").select(templateSelectColumns).order("is_default", { ascending: false }).order("updated_at", { ascending: false });
    templates = (result.data ?? []) as ContentTemplate[];
    const user = await getCurrentUser();
    if (user && hasProviderEncryptionKey()) providerConfigs = await listProviderConfigs(user.id).catch(() => []);
  }
  return <><PageHeader title="Settings" description="管理工作区偏好、内容模板与服务端 AI Provider" /><div className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-8 lg:grid-cols-[180px_minmax(0,1fr)]"><nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="设置分区"><a href="#general" className="settings-nav-link">General</a><a href="#content-templates" className="settings-nav-link">Content Templates</a><a href="#ai-providers" className="settings-nav-link">AI Providers</a></nav><div className="min-w-0 space-y-6">{!supabaseReady ? <ConfigurationAlert /> : null}<section id="general"><Card><CardHeader><CardTitle>General</CardTitle><CardDescription>工作区安装与基础连接状态</CardDescription></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><div><p className="text-sm font-medium">文案服务</p><p className="mt-1 text-sm text-muted-foreground">{ai.configured ? `${ai.model} · 环境变量 fallback` : "未配置"}</p><AiHealthCheck disabled={!ai.configured || !supabaseReady} /></div><div><p className="text-sm font-medium">在 iPhone 上安装</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Safari 分享 → 添加到主屏幕 → 作为网页 App 打开。</p></div></CardContent></Card></section>{supabaseReady && hasProviderEncryptionKey() ? <ProviderSettings initialConfigs={providerConfigs} /> : <Card><CardHeader><CardTitle>AI 模型配置</CardTitle><CardDescription>服务端缺少 PROVIDER_CONFIG_ENCRYPTION_KEY，暂不能保存 Provider 密钥。</CardDescription></CardHeader></Card>}<section id="content-templates"><TemplateManager initialTemplates={templates} /></section></div></div></>;
}

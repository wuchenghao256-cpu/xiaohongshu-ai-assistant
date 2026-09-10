import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import { AiHealthCheck } from "@/components/settings/ai-health-check";
import { TemplateManager } from "@/components/settings/template-manager";
import { getAiConfigStatus, getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { templateSelectColumns, type ContentTemplate } from "@/lib/templates/types";

export default async function SettingsPage() {
  const ai = getAiConfigStatus();
  const supabaseReady = Boolean(getSupabasePublicEnv());
  let templates: ContentTemplate[] = [];
  if (supabaseReady) {
    const result = await (await createClient()).from("content_templates").select(templateSelectColumns).order("is_default", { ascending: false }).order("updated_at", { ascending: false });
    templates = (result.data ?? []) as ContentTemplate[];
  }
  return <><PageHeader title="设置" description="管理常用模板并检查服务端连接状态；密钥内容不会发送到浏览器" /><div className="flex max-w-3xl flex-col gap-5 p-4 sm:p-8">{!supabaseReady ? <ConfigurationAlert /> : null}<TemplateManager initialTemplates={templates} /><Card><CardHeader><CardTitle>在 iPhone 上安装</CardTitle><CardDescription>无需 App Store，使用 Safari 即可添加到主屏幕。</CardDescription></CardHeader><CardContent><ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground"><li>使用 Safari 打开本网站</li><li>点击 Safari 的分享按钮</li><li>选择“添加到主屏幕”</li><li>开启“作为网页 App 打开”</li><li>点击“添加”</li></ol></CardContent></Card><Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>AI Provider</CardTitle><CardDescription>OpenAI Chat Completions 兼容接口</CardDescription></div><Badge variant={ai.configured ? "secondary" : "outline"}>{ai.configured ? "已配置" : "未配置"}</Badge></CardHeader><CardContent className="flex flex-col gap-4"><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">模型名称</dt><dd className="mt-1 font-medium">{ai.model}</dd></div><div><dt className="text-muted-foreground">接口域名</dt><dd className="mt-1 font-medium">{ai.baseUrl}</dd></div><div><dt className="text-muted-foreground">API Key</dt><dd className="mt-1 font-medium">{ai.configured ? "已在服务端配置（已隐藏）" : "未配置"}</dd></div><div><dt className="text-muted-foreground">直接发布</dt><dd className="mt-1 font-medium">当前版本需要人工确认发布</dd></div></dl><AiHealthCheck disabled={!ai.configured || !supabaseReady} /></CardContent></Card></div></>;
}

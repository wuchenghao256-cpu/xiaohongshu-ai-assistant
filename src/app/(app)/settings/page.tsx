import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import { AiHealthCheck } from "@/components/settings/ai-health-check";
import { TemplateManager } from "@/components/settings/template-manager";
import { ProviderSettings } from "@/components/settings/provider-settings";
import {
  getAiConfigStatus,
  getSupabasePublicEnv,
  hasDashscopeApiKey,
  hasProviderEncryptionKey,
} from "@/lib/env";
import { listProviderConfigs, hasReusableArkKey } from "@/lib/providers/repository";
import { getCurrentUser } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import {
  templateSelectColumns,
  type ContentTemplate,
} from "@/lib/templates/types";

export default async function SettingsPage() {
  const ai = getAiConfigStatus();
  const supabaseReady = Boolean(getSupabasePublicEnv());
  let templates: ContentTemplate[] = [];
  let providerConfigs = [] as Awaited<ReturnType<typeof listProviderConfigs>>;
  let arkKeyReusable = false;
  if (supabaseReady) {
    const result = await (await createClient())
      .from("content_templates")
      .select(templateSelectColumns)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    templates = (result.data ?? []) as ContentTemplate[];
    const user = await getCurrentUser();
    if (user && hasProviderEncryptionKey()) {
      providerConfigs = await listProviderConfigs(user.id).catch(() => []);
      arkKeyReusable = await hasReusableArkKey(user.id).catch(() => false);
    }
  }
  return (
    <>
      <PageHeader
        title="系统设置"
        description="管理基础偏好、AI 服务商与内容模板"
      />
      <div className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav
          className="flex gap-1 overflow-x-auto lg:flex-col"
          aria-label="设置分区"
        >
          <a href="#general" className="settings-nav-link">
            基础设置
          </a>
          <a href="#ai-providers" className="settings-nav-link">
            AI 服务商
          </a>
          <a href="#ai-providers" className="settings-nav-link">
            视频 API
          </a>
          <a href="#accounts" className="settings-nav-link">
            账号管理
          </a>
          <a href="#other" className="settings-nav-link">
            其他设置
          </a>
        </nav>
        <div className="min-w-0 space-y-6">
          {!supabaseReady ? <ConfigurationAlert /> : null}
          <section id="general">
            <Card>
              <CardHeader>
                <CardTitle>基础设置</CardTitle>
                <CardDescription>工作区安装与基础连接状态</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium">文案服务</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {ai.configured
                      ? `${ai.model} · 环境变量备用配置`
                      : "未配置"}
                  </p>
                  <AiHealthCheck disabled={!ai.configured || !supabaseReady} />
                </div>
                <div>
                  <p className="text-sm font-medium">在 iPhone 上安装</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Safari 分享 → 添加到主屏幕 → 作为网页 App 打开。
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>
          {supabaseReady && hasProviderEncryptionKey() ? (
            <ProviderSettings
              initialConfigs={providerConfigs}
              arkKeyReusable={arkKeyReusable}
              dashscopeKeyConfigured={hasDashscopeApiKey()}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>AI 模型配置</CardTitle>
                <CardDescription>
                  服务端缺少加密密钥，暂不能保存 AI 服务商密钥。
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          <section id="accounts">
            <Card>
              <CardHeader>
                <CardTitle>账号管理</CardTitle>
                <CardDescription>当前账号与发布连接状态</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  发布账号仍按现有安全流程管理，本轮未改变连接或发布逻辑。
                </p>
              </CardContent>
            </Card>
          </section>
          <section id="other" className="space-y-6">
            <div>
              <h2 className="text-base font-semibold">其他设置</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                管理内容模板与辅助功能。
              </p>
            </div>
            <TemplateManager initialTemplates={templates} />
          </section>
        </div>
      </div>
    </>
  );
}

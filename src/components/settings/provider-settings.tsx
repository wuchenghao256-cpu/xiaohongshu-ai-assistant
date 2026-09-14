"use client";

import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ProviderCategory,
  ProviderName,
  SafeProviderConfig,
} from "@/lib/providers/types";
import { cn } from "@/lib/utils";

const providers: Array<{
  id: ProviderName;
  name: string;
  description: string;
  baseUrl: string;
  models: string[];
}> = [
  {
    id: "seedream",
    name: "Seedream",
    description: "字节火山引擎图片生成",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seedream-4-0-250828", "doubao-seedream-3-0-t2i-250415"],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI Images API",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-image-1.5", "gpt-image-1"],
  },
  {
    id: "google",
    name: "Google Gemini",
    description: "Gemini 原生图片模型",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"],
  },
  {
    id: "custom",
    name: "Custom",
    description: "OpenAI-compatible 图片接口",
    baseUrl: "",
    models: [],
  },
  {
    id: "runway",
    name: "Runway",
    description: "Runway 视频生成与 Product Recipes（当前非默认 Provider）",
    baseUrl: "https://api.dev.runwayml.com/v1",
    models: ["gen4_turbo", "gen4.5"],
  },
  {
    id: "volcengine",
    name: "豆包 Seedance 2.0",
    description: "火山方舟多模态参考生视频，与 Seedream 图片共用同一把 Ark API Key",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"],
  },
  {
    id: "alibaba",
    name: "阿里云 Wan",
    description: "阿里云百炼 Wan2.7 图生视频（首帧）。密钥只从服务端环境变量读取",
    // 华北2（北京）的 Endpoint 是业务空间专属域名，由下面的业务空间 ID 决定；
    // 这里留空表示「按业务空间 ID 生成」，而不是写死一个通用地址。
    baseUrl: "",
    models: ["wan2.7-i2v-2026-04-25"],
  },
];

type Draft = {
  baseUrl: string;
  apiKey: string;
  modelPreset: string;
  customModel: string;
  qualityModel: string;
  workspaceId: string;
  region: string;
  enabled: boolean;
};

/** 阿里云百炼的密钥来自服务端环境变量，设置页永远不收集、也不回显它。 */
const isDashscope = (provider: ProviderName) => provider === "alibaba";

export function ProviderSettings({
  initialConfigs,
  arkKeyReusable = false,
  dashscopeKeyConfigured = false,
}: {
  initialConfigs: SafeProviderConfig[];
  arkKeyReusable?: boolean;
  dashscopeKeyConfigured?: boolean;
}) {
  const [category, setCategory] = useState<ProviderCategory>("image");
  const [configs, setConfigs] = useState(initialConfigs);
  const [open, setOpen] = useState<ProviderName>("seedream");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const provider = providers.find((item) => item.id === open)!;
  const existing = useMemo(
    () =>
      configs.find(
        (item) => item.category === category && item.provider === open,
      ),
    [configs, category, open],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const key = `${category}:${open}`;
  const draft = drafts[key] ?? {
    baseUrl: existing?.baseUrl ?? provider.baseUrl,
    apiKey: "",
    modelPreset:
      existing && provider.models.includes(existing.model)
        ? existing.model
        : (provider.models[0] ?? ""),
    customModel:
      existing && !provider.models.includes(existing.model)
        ? existing.model
        : "",
    qualityModel: existing?.qualityModel ?? (open === "volcengine" ? "doubao-seedance-2-0-260128" : "gen4.5"),
    workspaceId: existing?.workspaceId ?? "",
    region: existing?.region ?? "cn-beijing",
    enabled: existing?.enabled ?? false,
  };
  const update = (partial: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [key]: { ...draft, ...partial } }));
  const model = draft.customModel.trim() || draft.modelPreset;
  /** 火山方舟的图片与视频共用同一把 Key：已为 Seedream 配置过就不必再次填写。 */
  const reusesArkKey = open === "volcengine" && !draft.apiKey.trim() && arkKeyReusable;
  /** 百炼的密钥由服务端环境变量提供，表单里不需要、也不应该填写。 */
  const usesEnvKey = isDashscope(open);

  async function submit(action: "save" | "test") {
    // 百炼不校验 API Key 输入框：它的密钥在服务端，这里只需业务空间 ID。
    if (usesEnvKey && !draft.workspaceId.trim()) {
      toast.error("请填写百炼业务空间 ID");
      return;
    }
    if (!draft.baseUrl.trim() && !usesEnvKey) {
      toast.error("请填写 API Base URL");
      return;
    }
    if (!model || (!usesEnvKey && !draft.apiKey && !existing && !reusesArkKey)) {
      toast.error("请完整填写接口地址、模型和 API Key");
      return;
    }
    setBusy(action);
    try {
      const response = await fetch(
        action === "save"
          ? "/api/settings/providers"
          : "/api/settings/providers/test",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            provider: open,
            // 百炼的 Base URL 永远由服务端按业务空间 ID 推导。不回传旧值，
            // 否则改了业务空间 ID 也会被上一次保存的域名覆盖。
            baseUrl: usesEnvKey ? undefined : draft.baseUrl,
            apiKey: draft.apiKey || undefined,
            model,
            qualityModel: category === "video" ? draft.qualityModel : undefined,
            workspaceId: usesEnvKey ? draft.workspaceId.trim() : undefined,
            region: usesEnvKey ? draft.region : undefined,
            enabled: draft.enabled,
          }),
        },
      );
      const data = (await response.json()) as {
        configs?: SafeProviderConfig[];
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.message ?? data.error ?? "操作失败");
      if (data.configs) {
        setConfigs(data.configs);
        update({ apiKey: "" });
        toast.success("配置已安全保存");
      } else toast.success(data.message ?? "连接成功");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card id="ai-providers" className="overflow-hidden">
      <CardHeader className="border-b">
        <CardTitle>AI 服务商</CardTitle>
        <CardDescription>
          配置文案、图片与视频模型。密钥仅在服务端加密保存，页面不会读取完整密钥。
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex border-b px-4 pt-2 sm:px-6" role="tablist">
          {(["text", "image", "video"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              onClick={() => {
                setCategory(item);
                setOpen(
                  item === "text"
                    ? "custom"
                    : item === "video"
                      ? "volcengine"
                      : "seedream",
                );
              }}
              className={cn(
                "min-h-11 border-b-2 px-4 text-sm font-medium",
                category === item
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {item === "text" ? "文案模型" : item === "video" ? "视频模型" : "图片模型"}
            </button>
          ))}
        </div>
        <div className="grid min-w-0 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b p-3 lg:border-r lg:border-b-0">
            {providers
              .filter(
                (item) =>
                  category === "video"
                    ? item.id === "volcengine" || item.id === "runway" || item.id === "alibaba"
                    : category === "image"
                      ? item.id !== "runway" && item.id !== "alibaba"
                      : item.id === "openai" || item.id === "custom",
              )
              .map((item) => {
                const config = configs.find(
                  (value) =>
                    value.category === category && value.provider === item.id,
                );
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setOpen(item.id);
                      setVisible(false);
                    }}
                    className={cn(
                      "flex min-h-16 w-full items-center justify-between rounded-md px-3 text-left transition-colors hover:bg-muted",
                      open === item.id && "bg-muted",
                    )}
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {item.id === "custom" ? "自定义" : item.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {config?.enabled ? "已启用" : "未启用"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      配置
                      {config?.enabled ? (
                        <span
                          className="size-2 rounded-full bg-emerald-500"
                          aria-label="已启用"
                        />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </span>
                  </button>
                );
              })}
          </div>
          <div className="min-w-0 p-4 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">
                  {provider.id === "custom" ? "自定义" : provider.name}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {category === "text"
                    ? "兼容 OpenAI 协议的文案接口"
                    : provider.description}
                </p>
              </div>
              <Badge variant={existing?.enabled ? "secondary" : "outline"}>
                {existing?.enabled ? (
                  <>
                    <Check className="size-3" />
                    已启用
                  </>
                ) : (
                  "未启用"
                )}
              </Badge>
            </div>
            <div className="grid min-w-0 gap-5">
              {usesEnvKey ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="provider-workspace-id">业务空间 ID</FieldLabel>
                    <Input
                      id="provider-workspace-id"
                      value={draft.workspaceId}
                      onChange={(event) => update({ workspaceId: event.target.value })}
                      placeholder="例如 my-workspace"
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      华北2（北京）的 Endpoint 是按业务空间划分的专属域名：
                      {" "}
                      <span className="font-mono">{`https://${draft.workspaceId.trim() || "{WorkspaceId}"}.cn-beijing.maas.aliyuncs.com`}</span>
                      。请填写百炼控制台里的业务空间 ID。
                    </p>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="provider-region">地域</FieldLabel>
                    <Select value={draft.region} onValueChange={(value) => value && update({ region: value })}>
                      <SelectTrigger id="provider-region" className="w-full">
                        <SelectValue>{draft.region}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cn-beijing">cn-beijing（华北2 北京）</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Alert>
                    <KeyRound />
                    <AlertTitle>API Key 由服务端环境变量提供</AlertTitle>
                    <AlertDescription>
                      {dashscopeKeyConfigured
                        ? "已在服务端检测到 DASHSCOPE_API_KEY。这里的表单不会读取、保存或回显密钥，它只保存业务空间 ID。"
                        : "尚未在服务端检测到 DASHSCOPE_API_KEY。请先在部署环境配置该变量（连同 DASHSCOPE_WORKSPACE_ID、DASHSCOPE_REGION），再回到这里保存并启用。密钥只存在于服务端，不会下发到浏览器。"}
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="provider-base-url">
                    API Base URL
                  </FieldLabel>
                  <Input
                    id="provider-base-url"
                    value={draft.baseUrl}
                    onChange={(event) => update({ baseUrl: event.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </Field>
              )}
              {usesEnvKey ? null : (
                <Field>
                  <FieldLabel htmlFor="provider-key">API Key</FieldLabel>
                  <div className="relative">
                    <Input
                      id="provider-key"
                      type={visible ? "text" : "password"}
                      value={draft.apiKey}
                      onChange={(event) => update({ apiKey: event.target.value })}
                      placeholder={existing?.hasApiKey ? "已安全保存；留空保持不变" : reusesArkKey ? "已复用 Seedream 的 Ark API Key；留空即可" : "输入 API Key"}
                      autoComplete="new-password"
                      className="pr-11"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setVisible((value) => !value)}
                      aria-label={visible ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {visible ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {existing
                      ? "API Key 已在服务端加密保存。留空将保留原密钥，页面和接口响应不会返回任何密钥片段。"
                      : reusesArkKey
                        ? "无需重复填写：将自动复用已保存的 Seedream 火山方舟 API Key。"
                        : "使用 AES-256-GCM 加密后保存。"}
                  </p>
                </Field>
              )}
              {provider.models.length ? (
                <Field>
                  <FieldLabel htmlFor="provider-preset">
                    {category === "video" ? "默认快速模型" : "推荐模型"}
                  </FieldLabel>
                  <Select
                    value={draft.modelPreset}
                    onValueChange={(value) =>
                      value && update({ modelPreset: value })
                    }
                  >
                    <SelectTrigger id="provider-preset" className="w-full">
                      <SelectValue>{draft.modelPreset}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {provider.models.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="provider-custom-model">
                  自定义 Model ID
                </FieldLabel>
                <Input
                  id="provider-custom-model"
                  value={draft.customModel}
                  onChange={(event) =>
                    update({ customModel: event.target.value })
                  }
                  placeholder={
                    provider.models.length
                      ? "可选；填写后优先使用"
                      : "输入模型 ID"
                  }
                />
              </Field>
              {category === "video" ? (
                <Field>
                  <FieldLabel htmlFor="provider-quality-model">默认高质量模型</FieldLabel>
                  <Select
                    value={draft.qualityModel}
                    onValueChange={(value) => value && update({ qualityModel: value })}
                  >
                    <SelectTrigger id="provider-quality-model" className="w-full">
                      <SelectValue>{draft.qualityModel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {provider.models.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {open === "volcengine"
                      ? "豆包 Seedance 2.0 由火山方舟提供，与 Seedream 图片共用同一把 Ark API Key。"
                      : open === "alibaba"
                        ? "Wan2.7 图生视频本轮只实现首帧生视频：固定 5 秒、720P、不加水印。模型 ID 为 wan2.7-i2v-2026-04-25。"
                        : "模型列表为可扩展配置，后续可加入 Veo、Seedance、Hailuo。"}
                  </p>
                </Field>
              ) : null}
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) =>
                    update({ enabled: event.target.checked })
                  }
                  className="size-4 accent-foreground"
                />
                保存后启用此配置
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void submit("test")}
                >
                  {busy === "test" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <PlugZap />
                  )}
                  测试连接
                </Button>
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void submit("save")}
                >
                  {busy === "save" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Save />
                  )}
                  保存配置
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

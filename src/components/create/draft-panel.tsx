"use client";

import { Loader2, Save, Send, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ContentDraftRow } from "@/lib/drafts/types";
import type { Platform } from "@/lib/publishing/provider";
import { publishStatusLabels } from "@/lib/format";

const platformLabels: Record<Platform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  weibo: "微博",
  wechat_moments: "微信朋友圈",
};

export type DraftPanelProps = {
  taskId?: string;
  /** 本次生成用的第一张参考图与第一张成图，作为草稿的封面与保真依据。 */
  sourceAssetId?: string;
  generatedAssetId?: string;
  /** 可选的发布文案来源；没有文案时也能保存图片草稿。 */
  body: string;
  hashtags: string[];
  fallbackTitle: string;
  prompt?: string;
  template?: string;
  stylePreset?: string;
};

export function DraftPanel({
  taskId,
  sourceAssetId,
  generatedAssetId,
  body,
  hashtags,
  fallbackTitle,
  prompt,
  template,
  stylePreset,
}: DraftPanelProps) {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string>();
  const [platform, setPlatform] = useState<Platform>("xiaohongshu");
  const [title, setTitle] = useState("");
  const [copy, setCopy] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const ready = Boolean(taskId && generatedAssetId);

  function payload() {
    return {
      taskId,
      platform,
      title: (title.trim() || fallbackTitle).slice(0, 120),
      body: copy,
      hashtags,
      sourceAssetId: sourceAssetId ?? null,
      generatedAssetId: generatedAssetId ?? null,
      prompt: prompt ?? null,
      template: template ?? null,
      stylePreset: stylePreset ?? null,
    };
  }

  async function saveDraft() {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const response = await fetch(
        draftId ? `/api/drafts/${draftId}` : "/api/drafts",
        {
          method: draftId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        },
      );
      const data = (await response.json()) as { draft?: ContentDraftRow; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "草稿保存失败。");
      setDraftId(data.draft.id);
      toast.success("草稿已保存，可在历史记录中再次打开");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "草稿保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!ready || publishing) return;
    setPublishing(true);
    try {
      // 先落一次文案，避免用户改了文案但没点保存就直接发布。
      const currentBody = copy || body;
      const response = await fetch(`/api/tasks/${taskId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          title: title.trim() || fallbackTitle,
          body: currentBody,
          hashtags,
        }),
      });
      const data = (await response.json()) as { postId?: string; imageCount?: number; error?: string };
      if (!response.ok || !data.postId) throw new Error(data.error || "准备发布失败。");
      if (!data.imageCount) throw new Error("这条任务没有可用图片，请先生成图片。");
      // 同步草稿状态，让草稿列表能区分「已发布」。
      if (draftId) {
        await fetch(`/api/drafts/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "published" }),
        });
      }
      toast.success("内容已设为最终版本，正在跳转到发布中心…");
      // 成功后不复位 publishing：真要靠 router.push 卸载组件，提前复位会让按钮
      // 在跳转前闪回可点状态，用户可能再点一次发出第二个发布请求。
      router.push(`/publishing?postId=${data.postId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "准备发布失败。");
      setPublishing(false);
    }
  }

  return (
    <section aria-labelledby="draft-panel-title" className="workspace-section">
      <div className="workspace-section-heading">
        <div>
          <h2 id="draft-panel-title">保存草稿 / 发布</h2>
          <p>
            保存后刷新页面依然存在，可从「历史记录」重新打开继续编辑或发布。
          </p>
        </div>
      </div>

      {!ready ? (
        <p className="mt-3 rounded-lg bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          生成出至少一张图片后即可保存草稿。
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="draft-platform">发布平台</FieldLabel>
              <Select
                value={platform}
                onValueChange={(value) => value && setPlatform(value as Platform)}
              >
                <SelectTrigger id="draft-platform" className="w-full">
                  <SelectValue>{platformLabels[platform]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(platformLabels) as Platform[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {platformLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="draft-title">标题</FieldLabel>
              <Input
                id="draft-title"
                value={title}
                placeholder={fallbackTitle}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="draft-body">文案</FieldLabel>
            <Textarea
              id="draft-body"
              className="min-h-32 leading-6"
              value={copy}
              placeholder={body || "可以留空，之后在草稿里继续补充文案。"}
              onChange={(event) => setCopy(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {body
                ? "留空则使用生成结果里的当前文案。"
                : "还没有生成文案，可以先保存图片草稿。"}
            </p>
          </Field>
          <p className="text-xs text-muted-foreground">
            草稿会一并记录：参考图、生成图、prompt、模板
            {stylePreset ? `、风格预设（${stylePreset}）` : ""}、创建与更新时间。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={saveDraft} disabled={saving}>
              {saving ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : draftId ? (
                <UploadCloud data-icon="inline-start" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {saving ? "正在保存…" : draftId ? "更新草稿" : "保存草稿"}
            </Button>
            <Button type="button" onClick={publish} disabled={publishing}>
              {publishing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Send data-icon="inline-start" />
              )}
              {publishing ? "正在准备发布…" : "发布"}
            </Button>
          </div>
          {draftId ? (
            <p className="text-xs text-muted-foreground">
              当前草稿状态：{publishStatusLabels.draft} · 再次点击「更新草稿」会覆盖这条草稿。
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

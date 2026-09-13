"use client";

import { Check, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  modelGenerationModeLabels,
  modelGenerationModes,
  creativeVariationLevels,
  creativeVariationLevelLabels,
  modelGenderLabels,
  modelImageAspectRatios,
  modelImageTemplates,
  type ModelGenerationMode,
  type CreativeVariationLevel,
  type ModelImageAspectRatio,
  type ModelProductCategory,
  type ModelProductFocus,
  type ModelStyle,
  type ModelGender,
} from "@/lib/ai/image-template-config";
import {
  defaultImageStylePresetId,
  imageStylePresets,
  type ImageStylePresetId,
} from "@/lib/ai/style-presets";
import { describeFailure, type ImageFailureCategory } from "@/lib/image-ai/failure";
import { cn } from "@/lib/utils";

export type GeneratedAssetRecord = {
  id: string;
  storage_path: string;
  original_name: string;
  size_bytes: number;
  signedUrl: string;
};
type JobStatus = "queued" | "generating" | "completed" | "failed";
type ChildJob = { id: string; position: number; status: JobStatus; attempts: number; asset_id?: string | null; error_message?: string | null };
type BatchState = {
  batch: { id: string; task_id: string; status: JobStatus; total_count: number; completed_count: number; failed_count: number; request_snapshot?: Record<string, unknown> };
  children: ChildJob[];
  assets: GeneratedAssetRecord[];
  supportsOutputCount?: boolean;
};
const jobStatusLabels: Record<JobStatus, string> = { queued: "排队中", generating: "生成中", completed: "已完成", failed: "失败" };
const generationCounts = [1, 2, 4] as const;
const sceneLabels: Record<string, string> = {
  studio: "极简棚拍",
  street: "都市街头",
  cafe: "咖啡馆",
  indoor_minimal: "室内生活方式",
};
const framingLabels: Record<string, string> = {
  full_body: "全身构图",
  half_body: "半身构图",
  close_up: "细节特写",
  product_focus: "商品特写",
};

function templateTitle(name: string) {
  return name.replaceAll("-", " · ");
}

/**
 * 子任务表把失败分类写成 `[CATEGORY] 中文说明`。这里拆开，分类用于选择提示语气，
 * 去掉前缀的说明才是给用户看的正文。
 */
function parseChildError(errorMessage?: string | null) {
  const match = /^\[([A-Z_]+)\]\s*([\s\S]*)$/.exec(errorMessage ?? "");
  if (!match) return { category: undefined, message: errorMessage ?? "" };
  return { category: match[1] as ImageFailureCategory, message: match[2] };
}

export function AiImageGenerator({
  configured,
  disabled,
  referenceAssetIds,
  existingAssetCount,
  ensureTask,
  onGenerated,
  taskId,
}: {
  configured: boolean;
  disabled: boolean;
  referenceAssetIds: string[];
  existingAssetCount: number;
  ensureTask: () => Promise<string>;
  onGenerated: (assets: GeneratedAssetRecord[]) => void;
  taskId?: string;
}) {
  const defaultTemplate =
    modelImageTemplates.find((template) => template.isDefault) ??
    modelImageTemplates[0];
  const [templateId, setTemplateId] = useState(defaultTemplate.id);
  const [productCategory, setProductCategory] = useState<ModelProductCategory>(
    defaultTemplate.productCategory,
  );
  const [gender, setGender] = useState<ModelGender>(defaultTemplate.gender);
  const [style, setStyle] = useState<ModelStyle>(defaultTemplate.style);
  const [aspectRatio, setAspectRatio] = useState<ModelImageAspectRatio>(
    defaultTemplate.aspectRatio,
  );
  const [count, setCount] = useState<1 | 2 | 4>(
    defaultTemplate.shotsCountDefault,
  );
  const [productFocus, setProductFocus] =
    useState<ModelProductFocus>("product");
  const [generationMode, setGenerationMode] =
    useState<ModelGenerationMode>("precise_edit");
  const [creativeVariation, setCreativeVariation] =
    useState<CreativeVariationLevel>("medium");
  const [stylePresetId, setStylePresetId] = useState<ImageStylePresetId>(
    defaultImageStylePresetId,
  );
  const [generating, setGenerating] = useState(false);
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const selectedTemplate =
    modelImageTemplates.find((template) => template.id === templateId) ??
    defaultTemplate;
  const selectedPreset =
    imageStylePresets.find((preset) => preset.id === stylePresetId) ??
    imageStylePresets[0];
  const exceedsAssetLimit = existingAssetCount + count > 9;
  const batchActive = batchState?.children.some((job) => job.status === "queued" || job.status === "generating") ?? false;

  const loadBatch = useCallback(async (currentTaskId: string) => {
    let response: Response;
    try {
      response = await fetch(`/api/image-jobs?taskId=${encodeURIComponent(currentTaskId)}`, { cache: "no-store" });
    } catch (error) {
      // 网络层失败也要让页面说话，否则进度会永远停在「生成中」。
      setPollError(error instanceof Error ? error.message : "网络请求失败");
      toast.error("查询生成进度失败，正在自动重试…");
      return null;
    }
    const data = await response.json().catch(() => null) as (BatchState & { error?: string; category?: ImageFailureCategory }) | null;
    if (!response.ok) {
      const category = data?.category;
      setPollError(data?.error ?? "查询图片进度失败");
      toast.error(category ? `${describeFailure(category).message}${describeFailure(category).hint}` : "查询生成进度失败，正在自动重试…");
      return null;
    }
    setPollError(null);
    if (data?.batch) {
      setBatchState(data);
      if (data.assets?.length) onGenerated(data.assets);
      return data;
    }
    return null;
  }, [onGenerated]);

  useEffect(() => {
    if (!taskId) return;
    const timer = window.setTimeout(() => void loadBatch(taskId), 0);
    return () => window.clearTimeout(timer);
  }, [taskId, loadBatch]);

  useEffect(() => {
    if (!taskId || !batchState?.children.some((job) => job.status === "queued" || job.status === "generating")) return;
    const timer = window.setInterval(() => void loadBatch(taskId), 2000);
    return () => window.clearInterval(timer);
  }, [taskId, batchState?.children, loadBatch]);

  function requestPayload(currentTaskId: string, requestedCount: number) {
    return { mode: "model-template", taskId: currentTaskId, referenceAssetIds, templateId, productCategory, gender, style, aspectRatio, count: requestedCount, productFocus, generationMode, creativeVariation, stylePresetId };
  }


  function applyTemplate(nextTemplateId: string) {
    const template = modelImageTemplates.find(
      (item) => item.id === nextTemplateId,
    );
    if (!template) return;
    setTemplateId(template.id);
    setProductCategory(template.productCategory);
    setGender(template.gender);
    setStyle(template.style);
    setAspectRatio(template.aspectRatio);
    setCount(template.shotsCountDefault);
    setProductFocus(
      template.framing === "product_focus" ? "product" : "balanced",
    );
    setGenerationMode("precise_edit");
    setCreativeVariation("medium");
  }

  async function generate() {
    if (!referenceAssetIds.length) {
      toast.error("请先上传至少一张商品参考图");
      return;
    }
    if (exceedsAssetLimit) {
      toast.error(
        `当前还可保存 ${Math.max(0, 9 - existingAssetCount)} 张图片，请减少生成数量`,
      );
      return;
    }
    setGenerating(true);
    try {
      const taskId = await ensureTask();
      const payload = requestPayload(taskId, count);
      const response = await fetch("/api/image-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as BatchState & { error?: string };
      if (!response.ok || !data.batch) throw new Error(data.error || "图片任务创建失败");
      setBatchState(data);
      toast.success("图片批次已创建，正在后台生成");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "图片生成失败，请稍后重试",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function retryFailed() {
    if (!batchState) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/image-jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: batchState.batch.id }) });
      const state = await response.json() as BatchState & { error?: string };
      if (!response.ok) throw new Error(state.error ?? "重试任务失败");
      setBatchState(state);
      toast.success("已重新提交失败图片");
    } catch (error) { toast.error(error instanceof Error ? error.message : "重试失败"); }
    finally { setGenerating(false); }
  }

  return (
    <section
      aria-labelledby="generation-settings-title"
      className="workspace-section"
    >
      <div className="workspace-section-heading">
        <div>
          <h2 id="generation-settings-title">生成设置</h2>
          <p>控制图片比例、生成数量和视觉表现。</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="model-aspect-ratio">图片比例</FieldLabel>
          <Select
            value={aspectRatio}
            onValueChange={(value) =>
              value && setAspectRatio(value as ModelImageAspectRatio)
            }
          >
            <SelectTrigger id="model-aspect-ratio" className="w-full">
              <SelectValue>{aspectRatio}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {modelImageAspectRatios.map((ratio) => (
                <SelectItem key={ratio} value={ratio}>
                  {ratio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-image-count">生成数量</FieldLabel>
          <Select
            value={String(count)}
            onValueChange={(value) =>
              value && setCount(Number(value) as 1 | 2 | 4)
            }
          >
            <SelectTrigger id="model-image-count" className="w-full">
              <SelectValue>{count} 张</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {generationCounts.map((value) => (
                <SelectItem
                  key={value}
                  value={String(value)}
                  disabled={existingAssetCount + value > 9}
                >
                  {value} 张
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-generation-mode">生成模式</FieldLabel>
          <Select
            value={generationMode}
            onValueChange={(value) =>
              value && setGenerationMode(value as ModelGenerationMode)
            }
          >
            <SelectTrigger id="model-generation-mode" className="w-full">
              <SelectValue>
                {modelGenerationModeLabels[generationMode]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {modelGenerationModes.map((value) => (
                <SelectItem key={value} value={value}>
                  {modelGenerationModeLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="creative-variation">创意变化强度</FieldLabel>
          <Select
            value={creativeVariation}
            disabled={generationMode !== "creative_ad"}
            onValueChange={(value) => value && setCreativeVariation(value as CreativeVariationLevel)}
          >
            <SelectTrigger id="creative-variation" className="w-full">
              <SelectValue>{creativeVariationLevelLabels[creativeVariation]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {creativeVariationLevels.map((value) => (
                <SelectItem key={value} value={value}>{creativeVariationLevelLabels[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {generationMode === "creative_ad"
          ? "只锁定商品身份信息，主动改变人物、动作、场景、灯光、镜头和广告构图。"
          : "保持现有高保真编辑逻辑，尽量贴近原图呈现。"}
      </p>

      <div className="mt-6 border-t pt-5">
        <div className="workspace-section-heading">
          <div>
            <h2>广告风格</h2>
            <p>在模板之上叠加一层商业大片质感，模板决定「谁·在哪·怎么拍」，风格决定「像哪一类广告」。</p>
          </div>
        </div>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="广告风格预设"
        >
          {imageStylePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={preset.id === stylePresetId}
              onClick={() => setStylePresetId(preset.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors hover:bg-muted/45",
                preset.id === stylePresetId && "border-primary/60 bg-accent/60",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{preset.name}</span>
                <span className="text-xs text-muted-foreground">
                  {preset.label}
                </span>
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {preset.description}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          当前风格：{selectedPreset.name} · {selectedPreset.label}
          {selectedPreset.aspectHint ? ` · ${selectedPreset.aspectHint}` : ""}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          所有风格都会强制附加商品保真约束：保留商品形状、包装结构、Logo
          位置与材质配色，不重设计商品，不扭曲商品文字区域，不加水印。
        </p>
      </div>

      <div className="mt-6 border-t pt-5">
        <div className="workspace-section-heading">
          <div>
            <h2>选择模板</h2>
            <p>模板会自动设置模特、场景与构图，不展示内部技术参数。</p>
          </div>
        </div>
        <div
          className="template-grid grid max-h-[410px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3"
          role="radiogroup"
          aria-label="图片模板"
        >
          {modelImageTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={template.id === templateId}
              onClick={() => applyTemplate(template.id)}
              className={cn(
                "template-card",
                template.id === templateId && "template-card-selected",
              )}
            >
              <span className="template-thumbnail">
                <Image
                  src={template.previewImage}
                  alt={`${templateTitle(template.name)}预览`}
                  fill
                  sizes="(max-width: 640px) 42vw, 180px"
                  className="template-preview-image"
                />
              </span>
              {template.id === templateId ? (
                <span className="template-selected-mark" aria-hidden="true">
                  <Check />
                </span>
              ) : null}
              <span className="block text-sm font-medium leading-5">
                {templateTitle(template.name)}
              </span>
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                {modelGenderLabels[template.gender]} ·{" "}
                {sceneLabels[template.scene]} ·{" "}
                {framingLabels[template.framing]}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          当前模板：{templateTitle(selectedTemplate.name)}
        </p>
      </div>
      {exceedsAssetLimit ? (
        <p className="mt-4 text-sm text-destructive">
          当前任务最多保存 9 张图片，请选择更少的生成数量。
        </p>
      ) : null}
      <Button
        type="button"
        className="mt-5 w-full"
        onClick={generate}
        disabled={
          !configured ||
          disabled ||
          generating ||
          batchActive ||
          !referenceAssetIds.length ||
          exceedsAssetLimit
        }
      >
        {generating || batchActive ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        {generating ? "正在创建批次…" : batchActive ? "批次后台生成中…" : `生成 ${count} 张商品图`}
      </Button>
      {batchState ? (
        <div className="mt-4 rounded-lg border bg-muted/20 p-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">本批次图片任务</p>
            {batchState.children.some((job) => job.status === "failed") ? (
              <Button type="button" size="sm" variant="outline" disabled={generating} onClick={() => void retryFailed()}>
                <RotateCcw />只重试失败图片
              </Button>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {batchState.children.map((job) => {
              const parsed = parseChildError(job.error_message);
              const retrying = job.status === "generating" && job.attempts > 1;
              return (
                <div key={job.id} className="rounded-md border bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">图片 {job.position}</p>
                  <Badge className="mt-1" variant={job.status === "failed" ? "destructive" : "secondary"}>
                    {job.status === "generating" ? <Loader2 className="animate-spin" /> : null}
                    {retrying ? `正在重试（第 ${job.attempts} 次）` : jobStatusLabels[job.status]}
                  </Badge>
                  {job.status === "failed" && job.error_message ? (
                    <p className="mt-1.5 break-words text-[11px] leading-4 text-destructive">
                      {parsed.message}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {batchState.children.some((job) => job.status === "failed") ? (
            <div className="mt-3 flex flex-col gap-1 border-t pt-3">
              {Array.from(
                new Set(
                  batchState.children
                    .filter((job) => job.status === "failed")
                    .map((job) => parseChildError(job.error_message).category)
                    .filter(Boolean) as ImageFailureCategory[],
                ),
              ).map((category) => (
                <p key={category} className="text-xs leading-5 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {describeFailure(category).message}
                  </span>{" "}
                  {describeFailure(category).hint}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {pollError ? (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
          查询生成进度失败：{pollError}。页面每 2 秒自动重试，恢复后进度会继续更新。
        </div>
      ) : null}
    </section>
  );
}

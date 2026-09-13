"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  modelGenderLabels,
  modelImageAspectRatios,
  modelImageTemplates,
  type ModelGenerationMode,
  type ModelImageAspectRatio,
  type ModelProductCategory,
  type ModelProductFocus,
  type ModelStyle,
  type ModelGender,
} from "@/lib/ai/image-template-config";
import { cn } from "@/lib/utils";

export type GeneratedAssetRecord = {
  id: string;
  storage_path: string;
  original_name: string;
  size_bytes: number;
  signedUrl: string;
};
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

export function AiImageGenerator({
  configured,
  disabled,
  referenceAssetIds,
  existingAssetCount,
  ensureTask,
  onGenerated,
}: {
  configured: boolean;
  disabled: boolean;
  referenceAssetIds: string[];
  existingAssetCount: number;
  ensureTask: () => Promise<string>;
  onGenerated: (assets: GeneratedAssetRecord[]) => void;
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
    useState<ModelGenerationMode>("fidelity");
  const [generating, setGenerating] = useState(false);
  const selectedTemplate =
    modelImageTemplates.find((template) => template.id === templateId) ??
    defaultTemplate;
  const exceedsAssetLimit = existingAssetCount + count > 9;

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
    setGenerationMode("fidelity");
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
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "model-template",
          taskId,
          referenceAssetIds,
          templateId,
          productCategory,
          gender,
          style,
          aspectRatio,
          count,
          productFocus,
          generationMode,
        }),
      });
      const data = (await response.json()) as {
        assets?: GeneratedAssetRecord[];
        error?: string;
      };
      if (!response.ok || !data.assets)
        throw new Error(data.error || "图片生成失败");
      onGenerated(data.assets);
      toast.success(`已生成并保存 ${data.assets.length} 张商品图`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "图片生成失败，请稍后重试",
      );
    } finally {
      setGenerating(false);
    }
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
      <div className="grid gap-4 sm:grid-cols-3">
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
      </div>

      <div className="mt-6 border-t pt-5">
        <div className="workspace-section-heading">
          <div>
            <h2>选择模板</h2>
            <p>模板会自动设置模特、场景与构图，不展示内部技术参数。</p>
          </div>
        </div>
        <div
          className="grid max-h-[410px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3"
          role="radiogroup"
          aria-label="图片模板"
        >
          {modelImageTemplates.map((template, index) => (
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
              <span className="template-thumbnail" aria-hidden="true">
                <span
                  className={
                    index % 2 ? "template-figure-left" : "template-figure-right"
                  }
                />
              </span>
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
          !referenceAssetIds.length ||
          exceedsAssetLimit
        }
      >
        {generating ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        {generating ? "正在生成并保存…" : `生成 ${count} 张商品图`}
      </Button>
    </section>
  );
}

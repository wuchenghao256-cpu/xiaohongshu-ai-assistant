"use client";

import { Loader2, WandSparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  modelGenderLabels,
  modelGenerationModeLabels,
  modelGenerationModes,
  modelImageAspectRatios,
  modelImageTemplates,
  modelProductCategories,
  modelProductCategoryLabels,
  modelProductFocusLabels,
  modelStyles,
  modelStyleLabels,
  type ModelGender,
  type ModelGenerationMode,
  type ModelImageAspectRatio,
  type ModelProductCategory,
  type ModelProductFocus,
  type ModelStyle,
} from "@/lib/ai/image-template-config";

export type GeneratedAssetRecord = {
  id: string;
  storage_path: string;
  original_name: string;
  size_bytes: number;
  signedUrl: string;
};

const generationCounts = [1, 2, 4] as const;

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
  const defaultTemplate = modelImageTemplates.find((template) => template.isDefault) ?? modelImageTemplates[0];
  const [templateId, setTemplateId] = useState(defaultTemplate.id);
  const [productCategory, setProductCategory] = useState<ModelProductCategory>(defaultTemplate.productCategory);
  const [gender, setGender] = useState<ModelGender>(defaultTemplate.gender);
  const [style, setStyle] = useState<ModelStyle>(defaultTemplate.style);
  const [aspectRatio, setAspectRatio] = useState<ModelImageAspectRatio>(defaultTemplate.aspectRatio);
  const [count, setCount] = useState<1 | 2 | 4>(defaultTemplate.shotsCountDefault);
  const [productFocus, setProductFocus] = useState<ModelProductFocus>("product");
  const [generationMode, setGenerationMode] = useState<ModelGenerationMode>("fidelity");
  const [generating, setGenerating] = useState(false);
  const selectedTemplate = modelImageTemplates.find((template) => template.id === templateId) ?? defaultTemplate;
  const exceedsAssetLimit = existingAssetCount + count > 9;

  function applyTemplate(nextTemplateId: string | null) {
    if (!nextTemplateId) return;
    const template = modelImageTemplates.find((item) => item.id === nextTemplateId);
    if (!template) return;
    setTemplateId(template.id);
    setProductCategory(template.productCategory);
    setGender(template.gender);
    setStyle(template.style);
    setAspectRatio(template.aspectRatio);
    setCount(template.shotsCountDefault);
    setProductFocus(template.framing === "product_focus" ? "product" : "balanced");
    setGenerationMode("fidelity");
  }

  async function generate() {
    if (!referenceAssetIds.length) {
      toast.error("请先上传并选择至少一张商品参考图");
      return;
    }
    if (exceedsAssetLimit) {
      toast.error(`当前还可保存 ${Math.max(0, 9 - existingAssetCount)} 张图片，请减少生成张数`);
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
      const data = await response.json() as { assets?: GeneratedAssetRecord[]; error?: string };
      if (!response.ok || !data.assets) throw new Error(data.error || "图片生成失败");
      onGenerated(data.assets);
      toast.success(`已生成并保存 ${data.assets.length} 张 AI 模特商品图`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败，请稍后重试");
    } finally {
      setGenerating(false);
    }
  }

  return <Card className="bg-muted/20 shadow-none">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">AI 模特商品图</CardTitle>
      <CardDescription>
        {configured
          ? referenceAssetIds.length
            ? `高端时尚商品图模板 · 已选择 ${referenceAssetIds.length} 张商品参考图`
            : "请先上传并选择商品参考图，再使用高端时尚商品图模板"
          : "请先在服务端配置图片生成模型"}
      </CardDescription>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-4">
      <Field>
        <FieldLabel htmlFor="model-image-template">模板选择</FieldLabel>
        <Select value={templateId} onValueChange={applyTemplate}>
          <SelectTrigger id="model-image-template" className="w-full min-w-0"><SelectValue>{selectedTemplate.name}</SelectValue></SelectTrigger>
          <SelectContent>{modelImageTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">选择模板后会自动回填模特、风格、比例和默认生成张数。</p>
      </Field>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="model-generation-mode">生成模式</FieldLabel>
          <Select value={generationMode} onValueChange={(value) => value && setGenerationMode(value as ModelGenerationMode)}>
            <SelectTrigger id="model-generation-mode" className="w-full"><SelectValue>{modelGenerationModeLabels[generationMode]}</SelectValue></SelectTrigger>
            <SelectContent>{modelGenerationModes.map((value) => <SelectItem key={value} value={value}>{modelGenerationModeLabels[value]}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">高保真优先保留版型与图案；高级风格增强时尚表现，但仍保持商品清晰。</p>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-product-category">商品类目</FieldLabel>
          <Select value={productCategory} onValueChange={(value) => { if (!value) return; const category = value as ModelProductCategory; setProductCategory(category); if (category === "clothing" || category === "pants") setGenerationMode("fidelity"); }}>
            <SelectTrigger id="model-product-category" className="w-full"><SelectValue>{modelProductCategoryLabels[productCategory]}</SelectValue></SelectTrigger>
            <SelectContent>{modelProductCategories.map((value) => <SelectItem key={value} value={value}>{modelProductCategoryLabels[value]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-gender">模特性别</FieldLabel>
          <Select value={gender} onValueChange={(value) => value && setGender(value as ModelGender)}>
            <SelectTrigger id="model-gender" className="w-full"><SelectValue>{modelGenderLabels[gender]}</SelectValue></SelectTrigger>
            <SelectContent>{(["female", "male"] as const).map((value) => <SelectItem key={value} value={value}>{modelGenderLabels[value]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-style">风格</FieldLabel>
          <Select value={style} onValueChange={(value) => value && setStyle(value as ModelStyle)}>
            <SelectTrigger id="model-style" className="w-full"><SelectValue>{modelStyleLabels[style]}</SelectValue></SelectTrigger>
            <SelectContent>{modelStyles.map((value) => <SelectItem key={value} value={value}>{modelStyleLabels[value]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-aspect-ratio">输出比例</FieldLabel>
          <Select value={aspectRatio} onValueChange={(value) => value && setAspectRatio(value as ModelImageAspectRatio)}>
            <SelectTrigger id="model-aspect-ratio" className="w-full"><SelectValue>{aspectRatio}</SelectValue></SelectTrigger>
            <SelectContent>{modelImageAspectRatios.map((ratio) => <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-image-count">生成张数</FieldLabel>
          <Select value={String(count)} onValueChange={(value) => value && setCount(Number(value) as 1 | 2 | 4)}>
            <SelectTrigger id="model-image-count" className="w-full"><SelectValue>{count} 张</SelectValue></SelectTrigger>
            <SelectContent>{generationCounts.map((value) => <SelectItem key={value} value={String(value)} disabled={existingAssetCount + value > 9}>{value} 张</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-product-focus">商品展示重点</FieldLabel>
          <Select value={productFocus} onValueChange={(value) => value && setProductFocus(value as ModelProductFocus)}>
            <SelectTrigger id="model-product-focus" className="w-full"><SelectValue>{modelProductFocusLabels[productFocus]}</SelectValue></SelectTrigger>
            <SelectContent>{(["product", "balanced"] as const).map((value) => <SelectItem key={value} value={value}>{modelProductFocusLabels[value]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>

      {exceedsAssetLimit ? <p className="text-sm text-destructive">当前任务最多保存 9 张图片，请选择更少的生成张数。</p> : null}
      <Button type="button" variant="outline" onClick={generate} disabled={!configured || disabled || generating || !referenceAssetIds.length || exceedsAssetLimit}>
        {generating ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <WandSparkles data-icon="inline-start" />}
        {generating ? "正在生成并保存…" : `生成 ${count} 张 AI 模特商品图`}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">生成结果不会添加水印，将自动保存到素材库并勾选为发布图片。</p>
    </CardContent>
  </Card>;
}

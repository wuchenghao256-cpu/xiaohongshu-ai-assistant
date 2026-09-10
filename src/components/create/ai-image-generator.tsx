"use client";

import { Loader2, WandSparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { imageAspectRatios, imageSceneOptions, type ImageAspectRatio, type ImageScene } from "@/lib/image-ai/types";

export type GeneratedAssetRecord = {
  id: string;
  storage_path: string;
  original_name: string;
  size_bytes: number;
  signedUrl: string;
};

export function AiImageGenerator({
  configured,
  disabled,
  referenceAssetIds,
  ensureTask,
  onGenerated,
}: {
  configured: boolean;
  disabled: boolean;
  referenceAssetIds: string[];
  ensureTask: () => Promise<string>;
  onGenerated: (assets: GeneratedAssetRecord[]) => void;
}) {
  const [scene, setScene] = useState<ImageScene>("xiaohongshu");
  const [sceneDescription, setSceneDescription] = useState("");
  const [imageStyle, setImageStyle] = useState("自然真实、柔和自然光、适合小红书");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("3:4");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    if (sceneDescription.trim().length < 5) {
      toast.error("请具体描述希望生成的场景");
      return;
    }
    setGenerating(true);
    try {
      const taskId = await ensureTask();
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          referenceAssetIds,
          scene,
          sceneDescription,
          imageStyle,
          aspectRatio,
          count,
        }),
      });
      const data = await response.json() as { assets?: GeneratedAssetRecord[]; error?: string };
      if (!response.ok || !data.assets) throw new Error(data.error || "图片生成失败");
      onGenerated(data.assets);
      toast.success(`已生成并保存 ${data.assets.length} 张商品图`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败，请稍后重试");
    } finally {
      setGenerating(false);
    }
  }

  return <Card className="mt-3 bg-muted/20 shadow-none">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">AI 生成商品图</CardTitle>
      <CardDescription>
        {configured
          ? referenceAssetIds.length
            ? `将优先参考已选择的 ${referenceAssetIds.length} 张原商品图`
            : "未选择参考图，将使用文本生成图片"
          : "请先在服务端配置图片生成模型"}
      </CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="image-scene">场景</FieldLabel>
          <Select value={scene} onValueChange={(value) => value && setScene(value as ImageScene)}>
            <SelectTrigger id="image-scene" className="w-full"><SelectValue>{imageSceneOptions.find((option) => option.value === scene)?.label}</SelectValue></SelectTrigger>
            <SelectContent>{imageSceneOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="image-style">图片风格</FieldLabel>
          <Input id="image-style" value={imageStyle} onChange={(event) => setImageStyle(event.target.value)} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="image-scene-description">场景描述</FieldLabel>
        <Textarea
          id="image-scene-description"
          value={sceneDescription}
          onChange={(event) => setSceneDescription(event.target.value)}
          placeholder="例如：生成一张自然光咖啡店桌面场景的小红书风商品照片"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="image-aspect-ratio">图片比例</FieldLabel>
          <Select value={aspectRatio} onValueChange={(value) => value && setAspectRatio(value as ImageAspectRatio)}>
            <SelectTrigger id="image-aspect-ratio" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{imageAspectRatios.map((ratio) => <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="image-count">生成数量</FieldLabel>
          <Select value={String(count)} onValueChange={(value) => value && setCount(Number(value))}>
            <SelectTrigger id="image-count" className="w-full"><SelectValue>{count} 张</SelectValue></SelectTrigger>
            <SelectContent>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{value} 张</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Button type="button" variant="outline" onClick={generate} disabled={!configured || disabled || generating}>
        {generating ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <WandSparkles data-icon="inline-start" />}
        {generating ? "正在生成并保存…" : "AI 生成商品图"}
      </Button>
    </CardContent>
  </Card>;
}

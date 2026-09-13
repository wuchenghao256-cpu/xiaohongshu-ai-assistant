"use client";

import { Clapperboard, ImagePlay, Loader2, RefreshCw, Save, Sparkles, Upload, UserRound } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { MAX_REFERENCE_IMAGES, productCategories, productCategoryLabels, type ProductCategory } from "@/lib/video/types";

type Mode = "image_to_video" | "product_ad" | "product_ugc";
type Provider = "volcengine" | "runway";
type UploadItem = { path: string; name: string; preview: string };
type VideoJob = {
  id: string;
  kind: Mode;
  status: "queued" | "generating" | "completed" | "failed";
  progress: number;
  output_url?: string | null;
  error_message?: string | null;
  created_at: string;
  saved?: boolean;
};

const modeCards = [
  { id: "image_to_video" as const, title: "图片动起来", description: "单图生成 4–15 秒动态视频", icon: ImagePlay },
  { id: "product_ad" as const, title: "商品广告片", description: "多参考图、多镜头与商品细节特写", icon: Clapperboard, primary: true },
  { id: "product_ugc" as const, title: "AI UGC", description: "9:16 真人商品介绍视频", icon: UserRound },
];

const statusLabels = { queued: "排队中", generating: "生成中", completed: "已完成", failed: "失败" };
const durations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const ratioLabels = { portrait: "竖屏 9:16", landscape: "横屏 16:9" };
/** Seedance 2.0 fast 最高 720p；标准版支持 1080p。 */
const resolutionsFor = (model: string) => (model.includes("fast") ? ["480p", "720p"] : ["720p", "1080p"]);

export function VideoStudio({
  configured,
  provider,
  model,
  runwayModel,
  arkKeyReusable = false,
}: {
  configured: boolean;
  provider: Provider | null;
  model: string;
  runwayModel: string;
  arkKeyReusable?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("product_ad");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [duration, setDuration] = useState(10);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("portrait");
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [productCategory, setProductCategory] = useState<ProductCategory>("general");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [productInfo, setProductInfo] = useState("");
  const [concept, setConcept] = useState("");
  // 同一轮提交复用同一个幂等令牌；提交结束后立即作废，允许用户再次尝试。
  const idempotencyKey = useRef<string | null>(null);
  const isArk = provider !== "runway";

  const refreshJobs = useCallback(async () => {
    const response = await fetch("/api/video-jobs", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { jobs: VideoJob[] };
    setJobs(data.jobs);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshJobs]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "generating")) return;
    // 服务端按 5/10/15/20-30 秒的节奏决定是否真正查询方舟，这里的定时只负责刷新页面状态。
    const timer = window.setInterval(() => void refreshJobs(), 8000);
    return () => window.clearInterval(timer);
  }, [jobs, refreshJobs]);

  async function uploadFiles(files: FileList | null, slot?: number) {
    if (!files?.length) return;
    const selected = Array.from(files);
    const limit = mode === "product_ad" ? MAX_REFERENCE_IMAGES : mode === "product_ugc" ? 2 : 1;
    if (slot === undefined && uploads.length + selected.length > limit) {
      toast.error(`最多上传 ${limit} 张参考图`);
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const auth = await supabase.auth.getUser();
      if (!auth.data.user) throw new Error("登录状态已失效");
      for (const file of selected) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
          throw new Error(`${file.name} 格式不支持或超过 8MB`);
        }
        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${auth.data.user.id}/video-inputs/${crypto.randomUUID()}.${extension}`;
        const result = await supabase.storage.from("product-assets").upload(path, file, { contentType: file.type, upsert: false });
        if (result.error) throw result.error;
        const item = { path, name: file.name, preview: URL.createObjectURL(file) };
        setUploads((current) => (slot === undefined ? [...current, item] : current.map((value, index) => (index === slot ? item : value))));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  function selectMode(next: Mode) {
    setMode(next);
    setUploads([]);
    setDuration(next === "image_to_video" ? 5 : next === "product_ugc" ? 12 : 10);
    setOrientation("portrait");
    setGenerateAudio(next === "product_ugc");
  }

  async function generate() {
    if (creating || uploading) return;
    const required = mode === "product_ugc" ? 2 : 1;
    if (uploads.length < required) {
      toast.error(mode === "product_ugc" ? "请上传人物参考图和商品图" : "请先上传参考图");
      return;
    }
    if (mode === "image_to_video" && prompt.trim().length < 3) {
      toast.error("请填写视频动作提示词");
      return;
    }
    if (mode === "product_ugc" && concept.trim().length < 3) {
      toast.error("请填写文案或脚本");
      return;
    }
    setCreating(true);
    // 点击后按钮立即禁用，并且整轮提交复用同一个令牌，重复提交不会产生第二个付费任务。
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const inputPaths = uploads.map((item) => item.path);
      const body =
        mode === "image_to_video"
          ? { kind: mode, inputPaths, prompt, duration, orientation, generateAudio, idempotencyKey: idempotencyKey.current }
          : mode === "product_ad"
            ? { kind: mode, inputPaths, productInfo, concept, duration, orientation, resolution, productCategory, generateAudio, idempotencyKey: idempotencyKey.current }
            : { kind: mode, inputPaths, productInfo, script: concept, duration, orientation: "portrait", productCategory, generateAudio, idempotencyKey: idempotencyKey.current };
      const response = await fetch("/api/video-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json()) as { job?: VideoJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? "任务创建失败");
      idempotencyKey.current = null;
      setJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      if (data.job.status === "failed") toast.error(data.job.error_message ?? "任务创建失败");
      else toast.success("视频任务已创建，需要一定时间，可离开页面后再回来查看");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "任务创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function action(job: VideoJob, name: "regenerate" | "save") {
    const response = await fetch(`/api/video-jobs/${job.id}/${name}`, { method: "POST" });
    const data = (await response.json()) as { job?: VideoJob; error?: string };
    if (!response.ok) {
      toast.error(data.error ?? "操作失败");
      return;
    }
    toast.success(name === "save" ? "已保存到作品库" : "已创建重新生成任务");
    await refreshJobs();
  }

  const uploadLabel =
    mode === "product_ugc"
      ? "人物参考图 + 商品图（共 2 张）"
      : mode === "product_ad"
        ? `商品参考图（1–${MAX_REFERENCE_IMAGES} 张：正面、背面、Logo、材质、侧面、模特展示）`
        : "起始图片";
  const selectedModel = isArk ? model : runwayModel;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      {!configured ? (
        <Alert>
          <AlertTitle>{arkKeyReusable ? "请启用豆包 Seedance 2.0" : "请先配置视频 Provider"}</AlertTitle>
          <AlertDescription>
            {arkKeyReusable
              ? "已检测到 Seedream 的火山方舟 API Key。请在系统设置 → 视频模型 → 豆包 Seedance 2.0 中保存并启用，无需重复填写密钥。"
              : "在系统设置 → 视频模型中保存并启用 API Key；密钥只在服务端使用。"}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {modeCards.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectMode(item.id)}
            className={cn(
              "rounded-lg border bg-card p-5 text-left transition-colors hover:border-foreground/30",
              mode === item.id && "border-primary ring-1 ring-primary/20",
              item.primary && "md:-translate-y-1",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <item.icon className="size-5" />
            </span>
            <span className="mt-4 flex items-center gap-2 font-semibold">
              {item.title}
              {item.primary ? <Badge>主功能</Badge> : null}
            </span>
            <span className="mt-1 block text-sm leading-5 text-muted-foreground">{item.description}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{modeCards.find((item) => item.id === mode)?.title}</CardTitle>
            <CardDescription>
              {!isArk
                ? "参考图将通过私有 Storage 签名地址提交给 Runway。"
                : mode === "product_ad"
                  ? `按 [图1] 商品主体、[图2..n] 细节的顺序上传，Seedance 2.0 会按此顺序保持商品一致。当前模型：${selectedModel}`
                  : `上传原图作为 Seedance 2.0 多模态参考，不做纯文本转换。当前模型：${selectedModel}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Field>
              <FieldLabel>{uploadLabel}</FieldLabel>
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple={mode !== "image_to_video"}
                disabled={uploading}
                onChange={(event) => void uploadFiles(event.target.files)}
              />
              {uploads.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {uploads.map((item, index) => (
                    <div key={item.path} className="overflow-hidden rounded-md border bg-muted">
                      <div className="relative aspect-square">
                        <Image
                          src={item.preview}
                          alt={mode === "product_ugc" ? (index === 0 ? "人物参考图" : "商品参考图") : item.name}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      </div>
                      <p className="truncate px-2 py-1 text-xs">
                        {mode === "product_ugc"
                          ? index === 0
                            ? "人物 [图1]"
                            : "商品 [图2]"
                          : `[图${index + 1}] ${item.name}`}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {isArk && mode === "product_ad" && uploads.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  请确认第 1 张是商品主体正面：Seedance 2.0 会把它作为商品身份的基准。
                </p>
              ) : null}
            </Field>

            {mode === "image_to_video" ? (
              <Field>
                <FieldLabel>视频动作提示词</FieldLabel>
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="例如：商品保持原有外观、颜色、材质、Logo 和文字；镜头缓慢推进，商品自然产生轻微运动"
                />
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel>商品信息</FieldLabel>
                  <Textarea
                    value={productInfo}
                    onChange={(event) => setProductInfo(event.target.value)}
                    placeholder="商品材质、结构、颜色、Logo 与必须保留的细节"
                  />
                </Field>
                <Field>
                  <FieldLabel>{mode === "product_ugc" ? "文案 / 脚本" : "创意描述"}</FieldLabel>
                  <Textarea
                    value={concept}
                    onChange={(event) => setConcept(event.target.value)}
                    placeholder={mode === "product_ugc" ? "填写真人口播脚本和语气" : "场景、模特动作、镜头语言和广告风格"}
                  />
                </Field>
              </>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel>时长</FieldLabel>
                <Select value={String(duration)} onValueChange={(value) => value && setDuration(Number(value))}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{`${duration} 秒`}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {durations.map((value) => (
                      <SelectItem key={value} value={String(value)}>{`${value} 秒`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {mode !== "product_ugc" ? (
                <Field>
                  <FieldLabel>画面</FieldLabel>
                  <Select value={orientation} onValueChange={(value) => value && setOrientation(value as typeof orientation)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{ratioLabels[orientation]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">{ratioLabels.portrait}</SelectItem>
                      <SelectItem value="landscape">{ratioLabels.landscape}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              {mode === "product_ad" ? (
                <Field>
                  <FieldLabel>清晰度</FieldLabel>
                  <Select value={resolution} onValueChange={(value) => value && setResolution(value as typeof resolution)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{resolution}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(isArk ? resolutionsFor(model) : ["720p", "1080p"]).map((value) => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              {isArk ? (
                <Field>
                  <FieldLabel>商品类型</FieldLabel>
                  <Select value={productCategory} onValueChange={(value) => value && setProductCategory(value as ProductCategory)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{productCategoryLabels[productCategory]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {productCategories.map((value) => (
                        <SelectItem key={value} value={value}>{productCategoryLabels[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              {isArk ? (
                <Field>
                  <FieldLabel>生成声音</FieldLabel>
                  <Select value={generateAudio ? "on" : "off"} onValueChange={(value) => setGenerateAudio(value === "on")}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{generateAudio ? "生成同步声音" : "静音"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">静音</SelectItem>
                      <SelectItem value="on">生成同步声音</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>

            {isArk ? (
              <p className="text-xs text-muted-foreground">
                视频生成需要一定时间（通常数分钟）。点击后按钮会立即禁用，相同请求不会重复提交。
              </p>
            ) : null}

            <Button type="button" size="lg" disabled={!configured || uploading || creating} onClick={() => void generate()}>
              {creating || uploading ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {uploading ? "正在上传…" : creating ? "正在创建任务…" : "开始生成视频"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">视频任务</h2>
              <p className="text-sm text-muted-foreground">刷新页面后仍可恢复</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshJobs()}>
              <RefreshCw />
              刷新
            </Button>
          </div>
          {jobs.length ? (
            jobs.map((job) => (
              <Card key={job.id}>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex gap-2">
                      <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>
                        {job.status === "generating" ? <Loader2 className="animate-spin" /> : null}
                        {statusLabels[job.status]}
                      </Badge>
                      {job.saved ? <Badge variant="outline">已存作品库</Badge> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  {job.status === "queued" || job.status === "generating" ? (
                    <div className="mt-4">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(3, job.progress)}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{`进度 ${job.progress}% · 页面会自动轮询`}</p>
                    </div>
                  ) : null}
                  {job.status === "failed" ? (
                    <p className="mt-3 text-sm text-destructive">{job.error_message ?? "视频生成失败，请重试"}</p>
                  ) : null}
                  {job.status === "completed" && job.output_url ? (
                    <video className="mt-4 aspect-video w-full rounded-md bg-black" src={job.output_url} controls playsInline />
                  ) : null}
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void action(job, "regenerate")}>
                      <RefreshCw />
                      重新生成
                    </Button>
                    {job.status === "completed" && !job.saved ? (
                      <Button size="sm" onClick={() => void action(job, "save")}>
                        <Save />
                        保存到作品库
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex min-h-44 flex-col items-center justify-center text-center">
                <Upload className="size-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">暂无视频任务</p>
                <p className="mt-1 text-xs text-muted-foreground">创建后会立即显示 task id 对应状态</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

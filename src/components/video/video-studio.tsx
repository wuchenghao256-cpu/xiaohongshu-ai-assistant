"use client";

import { AlertTriangle, Clapperboard, Download, ImagePlay, Loader2, RefreshCw, RotateCcw, Save, Sparkles, Upload, UserRound, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { jobStatusLabel, markRecoverable, videoSource, visibleJobs, type VideoJob } from "@/components/video/job-state";
import { useVideoJobs } from "@/components/video/use-video-jobs";
import { fileNameFromDisposition, triggerDownload } from "@/lib/sharing/download-file";
import { shareVideoFileName } from "@/lib/sharing/xiaohongshu-publish";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { MAX_REFERENCE_IMAGES, productCategories, productCategoryLabels, type ProductCategory } from "@/lib/video/types";

type Mode = "image_to_video" | "product_ad" | "product_ugc";
type Provider = "volcengine" | "runway" | "alibaba";
type UploadItem = { path: string; name: string; preview: string };

const modeCards = [
  { id: "image_to_video" as const, title: "图片动起来", description: "单图生成 4–15 秒动态视频", icon: ImagePlay },
  { id: "product_ad" as const, title: "商品广告片", description: "多参考图、多镜头与商品细节特写", icon: Clapperboard, primary: true },
  { id: "product_ugc" as const, title: "AI UGC", description: "9:16 真人商品介绍视频", icon: UserRound },
];

const durations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const ratioLabels = { portrait: "竖屏 9:16", landscape: "横屏 16:9" };
/** Seedance 2.0 fast 最高 720p；标准版支持 1080p。 */
const resolutionsFor = (model: string) => (model.includes("fast") ? ["480p", "720p"] : ["720p", "1080p"]);
/** Wan2.7 本轮固定 5 秒 720P：与 Provider 侧提交的参数一致，界面不提供可选值。 */
const WAN_RESOLUTION = "720p";

/**
 * 创建阶段的失败分类。超时 / 网关错误 / 断网时本地拿不到 upstream task id，
 * 也就是无法确定方舟是否已经受理并计费 —— 这种失败必须走「恢复任务」，
 * 提示用户用「重试」会直接再扣一次费。
 */
function isUndeterminedCreateFailure(message: string) {
  return /可能已在生成服务中创建|响应超时|创建未完成|无法连接|暂时不可用/.test(message);
}

export function VideoStudio({
  configured,
  provider,
  model,
  runwayModel,
  arkKeyReusable = false,
  wanKeyMissing = false,
}: {
  configured: boolean;
  provider: Provider | null;
  model: string;
  runwayModel: string;
  arkKeyReusable?: boolean;
  wanKeyMissing?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("product_ad");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [duration, setDuration] = useState(10);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("portrait");
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [productCategory, setProductCategory] = useState<ProductCategory>("general");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [productInfo, setProductInfo] = useState("");
  const [concept, setConcept] = useState("");
  const [recovering, setRecovering] = useState<string | null>(null);
  const [recoverTaskId, setRecoverTaskId] = useState("");
  const [showAll, setShowAll] = useState(false);
  /** 正在下载的任务 id。按 id 记录，避免点一条任务的下载按钮时所有卡片一起转圈。 */
  const [downloading, setDownloading] = useState<string | null>(null);
  // 同一轮提交复用同一个幂等令牌，提交结束后立即作废，允许用户再次尝试。
  const idempotencyKey = useRef<string | null>(null);
  const isArk = provider !== "runway";
  const isWan = provider === "alibaba";
  const { jobs, setJobs, refreshing, fetchError, acting, refreshJobs, act } = useVideoJobs();
  const { visible, hidden } = useMemo(() => visibleJobs(jobs), [jobs]);

  // 任务入库超过 4 分钟仍没有上游 task id：提示用户可以恢复，但不能自动判定失败。
  useEffect(() => {
    const timer = window.setInterval(() => setJobs((current) => markRecoverable(current)), 30000);
    return () => window.clearInterval(timer);
  }, [setJobs]);

  async function refreshManually() {
    if (refreshing) return;
    await refreshJobs();
    if (!fetchError) toast.success("视频任务已刷新");
  }

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
      // Wan2.7 本轮不支持改画幅：i2v 的输出比例由首帧图决定，因此固定提交竖屏。
      const submittedOrientation = isWan ? "portrait" : orientation;
      const body =
        mode === "image_to_video"
          ? { kind: mode, inputPaths, prompt, duration, orientation: submittedOrientation, generateAudio, idempotencyKey: idempotencyKey.current }
          : mode === "product_ad"
            ? { kind: mode, inputPaths, productInfo, concept, duration, orientation: submittedOrientation, resolution, productCategory, generateAudio, idempotencyKey: idempotencyKey.current }
            : { kind: mode, inputPaths, productInfo, script: concept, duration, orientation: "portrait", productCategory, generateAudio, idempotencyKey: idempotencyKey.current };
      const response = await fetch("/api/video-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { job?: VideoJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? "任务创建失败");
      // 服务端已经明确接受了这次提交，无论结果成功还是失败，令牌都不该再复用。
      idempotencyKey.current = null;
      setJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      if (data.job.status === "failed") {
        if (isUndeterminedCreateFailure(data.job.error_message ?? "")) setRecovering(data.job.id);
        else toast.error(data.job.error_message ?? "任务创建失败");
      } else {
        toast.success("视频任务已创建，需要一定时间，可离开页面后再回来查看");
      }
    } catch (error) {
      // 请求没到服务端或响应丢失：保留令牌，用户点「重试」会命中同一条记录，
      // 不会因为一次网络抖动就产生第二个付费任务。
      toast.error(error instanceof Error ? error.message : "任务创建失败，请检查网络后重试");
    } finally {
      setCreating(false);
    }
  }

  async function regenerate(job: VideoJob) {
    if (acting) return;
    if (!window.confirm("重新生成会创建一个新的付费视频任务并再次消耗额度，确认继续？")) return;
    // 每次点击一个新令牌，用于并发双击时回落到同一条记录。
    await act(job, "regenerate", { idempotencyKey: crypto.randomUUID() });
  }

  async function recover(job: VideoJob) {
    // 允许留空：留空时服务端会用本地任务 ID 做一次自动反查。
    const ok = await act(job, "recover", { externalTaskId: recoverTaskId.trim() });
    if (ok) { setRecovering(null); setRecoverTaskId(""); }
  }

  async function discard(job: VideoJob) {
    if (!window.confirm("确认这条任务在生成服务里不存在？确认后会关闭该记录。")) return;
    await act(job, "discard");
  }

  function cancelRecover(job: VideoJob) {
    void act(job, "discard", { confirm: false });
    setRecovering(null);
  }

  function copyTaskId(jobId: string) {
    void navigator.clipboard?.writeText(jobId).then(
      () => toast.success("任务 ID 已复制，可在生成服务控制台按此 ID 查询"),
      () => toast.error("复制失败，请手动选择文本"),
    );
  }

  /**
   * 下载已生成的视频。
   *
   * 走同源服务端代理（/api/video-jobs/[id]/download），而不是把 <video> 上的播放地址
   * 直接交给 `<a download>`：那是跨域且一小时过期的签名地址，跨域下 download 属性会被
   * 浏览器忽略，过期后连点开都是 403 —— 这正是「只能在线播放、下载不了」的原因。
   * 服务端会把视频转存成私有的永久文件再转发字节，因此这个按钮拿到的永远是完整文件。
   */
  async function downloadVideo(job: VideoJob) {
    if (downloading) return;
    setDownloading(job.id);
    try {
      const response = await fetch(`/api/video-jobs/${job.id}/download`, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "视频下载失败，请稍后重试。");
      }
      const blob = await response.blob();
      triggerDownload(blob, fileNameFromDisposition(response.headers.get("content-disposition"), shareVideoFileName(job.id)));
      toast.success("视频已开始下载");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频下载失败，请稍后重试。");
    } finally {
      setDownloading(null);
    }
  }

  const uploadLabel =
    mode === "product_ugc"
      ? "人物参考图 + 商品图（共 2 张）"
      : mode === "product_ad"
        ? `商品参考图（1–${MAX_REFERENCE_IMAGES} 张：正面、背面、Logo、材质、侧面、模特展示）`
        : isWan
          ? "首帧图片（1 张）"
          : "起始图片";
  const selectedModel = isArk ? model : runwayModel;
  /** 百炼首帧图直接决定输出比例，因此不能像 Seedance 那样由参数指定画幅。 */
  const orientationLocked = isWan && mode !== "product_ugc";
  const resolutionOptions = isWan ? [WAN_RESOLUTION] : isArk ? resolutionsFor(model) : ["720p", "1080p"];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      {!configured ? (
        <Alert>
          <AlertTitle>
            {isWan
              ? "阿里云 Wan2.7 尚未就绪"
              : arkKeyReusable
                ? "请启用豆包 Seedance 2.0"
                : "请先配置视频 Provider"}
          </AlertTitle>
          <AlertDescription>
            {isWan
              ? wanKeyMissing
                ? "已在设置中启用阿里云 Wan，但服务端还没有 DASHSCOPE_API_KEY。请在部署环境配置该变量（连同 DASHSCOPE_WORKSPACE_ID、DASHSCOPE_REGION）后重新部署；密钥只存在于服务端。"
                : "当前启用的是阿里云 Wan，但服务端凭据不可用。请检查系统设置 → 视频模型 → 阿里云 Wan 中的业务空间 ID 与部署环境的 DASHSCOPE_API_KEY。"
              : arkKeyReusable
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
                : isWan
                  ? `首帧图会通过 Storage 签名地址提交给阿里云百炼（Wan2.7 图生视频）。当前模型：${selectedModel}；固定 5 秒、720P、不加水印。`
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
                <Select
                  value={String(duration)}
                  onValueChange={(value) => value && setDuration(Number(value))}
                  disabled={orientationLocked}
                >
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
                  <Select value={orientation} onValueChange={(value) => value && setOrientation(value as typeof orientation)} disabled={orientationLocked}>
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
                      {resolutionOptions.map((value) => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isWan ? <p className="text-xs text-muted-foreground">Wan2.7 本轮只提交 720P。</p> : null}
                </Field>
              ) : null}

              {isWan ? (
                <p className="text-xs text-muted-foreground">
                  商品类型与声音仅用于 Seedance 2.0：Wan2.7 图生视频不使用这两项参数。
                </p>
              ) : null}

              {isArk && !isWan ? (
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

              {isArk && !isWan ? (
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

            {isWan && mode !== "product_ugc" ? (
              <p className="text-xs text-muted-foreground">
                阿里云 Wan2.7 本轮固定 5 秒、720P：时长与画面随首帧图确定，因此不可调整。
              </p>
            ) : null}

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
            <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refreshManually()}>
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {refreshing ? "刷新中…" : "刷新"}
            </Button>
          </div>

          {fetchError ? (
            <Alert>
              <AlertTitle>任务列表刷新失败</AlertTitle>
              <AlertDescription>{`${fetchError} 任务仍在服务端继续生成，恢复网络后点「刷新」即可。`}</AlertDescription>
            </Alert>
          ) : null}

          {jobs.length ? (
            <>
              {visible.map((job) => (
                <Card key={job.id}>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex gap-2">
                        <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>
                          {job.status === "generating" ? <Loader2 className="animate-spin" /> : null}
                          {jobStatusLabel(job.status)}
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
                    {job.status === "never_accepted" ? (
                      <p className="mt-3 text-sm text-muted-foreground">{job.error_message ?? "该记录已关闭。"}</p>
                    ) : null}
                    {job.status === "completed" && videoSource(job) ? (
                      <video className="mt-4 aspect-video w-full rounded-md bg-black" src={videoSource(job)!} controls playsInline />
                    ) : null}

                    {job.recover && !recovering ? (
                      <Alert variant="destructive" className="mt-3">
                        <AlertTriangle />
                        <AlertTitle>这条任务还没有关联到生成服务</AlertTitle>
                        <AlertDescription>
                          <p>提交过程被中断，无法判断生成服务里是否已经存在该任务。请先在生成服务控制台按下面的任务 ID 查询，再决定如何继续。</p>
                          <button type="button" className="my-2 font-mono text-xs underline" onClick={() => copyTaskId(job.id)}>
                            {job.id}（点击复制）
                          </button>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" disabled={acting !== null} onClick={() => { setRecovering(job.id); setRecoverTaskId(""); }}>
                              在生成服务里找到了任务
                            </Button>
                            <Button size="sm" variant="ghost" disabled={acting !== null} onClick={() => void discard(job)}>没有这个任务，关闭记录</Button>
                          </div>
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {recovering === job.id ? (
                      <div className="mt-3 space-y-2 rounded-md border p-3">
                        <p className="text-sm font-medium">恢复任务</p>
                        <p className="text-xs text-muted-foreground">
                          可留空——留空时会先用下面这个任务 ID 自动反查；查不到再填生成服务控制台里的任务 ID（形如 cgt-...）。恢复只会补记并继续查询，不会再次创建任务或再次扣费。
                        </p>
                        <Input
                          value={recoverTaskId}
                          onChange={(event) => setRecoverTaskId(event.target.value)}
                          placeholder="留空则自动反查，或填写 cgt-..."
                          autoComplete="off"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={acting !== null} onClick={() => void recover(job)}>
                            {acting === `${job.id}:recover` ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                            {acting === `${job.id}:recover` ? "恢复中…" : "确认恢复"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => cancelRecover(job)}>
                            <X />
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={acting !== null} onClick={() => void regenerate(job)}>
                        {acting === `${job.id}:regenerate` ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {acting === `${job.id}:regenerate` ? "处理中…" : "重新生成"}
                      </Button>
                      {job.status === "completed" ? (
                        <Button size="sm" variant="outline" disabled={downloading !== null} onClick={() => void downloadVideo(job)}>
                          {downloading === job.id ? <Loader2 className="animate-spin" /> : <Download />}
                          {downloading === job.id ? "下载中…" : "下载视频"}
                        </Button>
                      ) : null}
                      {job.status === "completed" && !job.saved ? (
                        <Button size="sm" disabled={acting !== null} onClick={() => void act(job, "save")}>
                          {acting === `${job.id}:save` ? <Loader2 className="animate-spin" /> : <Save />}
                          {acting === `${job.id}:save` ? "保存中…" : "保存到作品库"}
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {hidden > 0 && !showAll ? (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll(true)}>
                  {`展开更早的 ${hidden} 条任务`}
                </Button>
              ) : null}
              {showAll && hidden > 0 ? (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll(false)}>
                  收起更早的任务
                </Button>
              ) : null}
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex min-h-44 flex-col items-center justify-center text-center">
                <Upload className="size-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">暂无视频任务</p>
                <p className="mt-1 text-xs text-muted-foreground">创建后会立即显示任务状态</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

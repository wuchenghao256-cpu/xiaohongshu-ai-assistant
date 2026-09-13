"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, ImagePlus, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  GeneratedImagesPanel,
  ReferenceImagesPanel,
  type WorkspaceImageAsset,
} from "@/components/create/model-image-assets";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { generationFieldsSchema, writingStyles } from "@/lib/ai/types";
import {
  imageExtensionByMime,
  isSupportedImageMimeType,
  readBrowserImageDimensions,
  sanitizeImageFilename,
} from "@/lib/images/image-files";
import { createClient } from "@/lib/supabase/client";
import {
  VariantCard,
  type VariantRecord,
} from "@/components/create/variant-card";
import {
  AiImageGenerator,
  type GeneratedAssetRecord,
} from "@/components/create/ai-image-generator";
import type { ContentTemplate } from "@/lib/templates/types";

const formSchema = generationFieldsSchema.superRefine((data, context) => {
  if (data.style === "自定义" && !data.customStyle)
    context.addIssue({
      code: "custom",
      path: ["customStyle"],
      message: "请描述自定义风格",
    });
});
type FormInput = z.infer<typeof formSchema>;

export function CreateWorkspace({
  configured,
  imageAiConfigured,
  initialTemplates,
}: {
  configured: boolean;
  imageAiConfigured: boolean;
  initialTemplates: ContentTemplate[];
}) {
  const defaultTemplate = initialTemplates.find(
    (template) => template.is_default,
  );
  const defaultKnownStyle = writingStyles.find(
    (style) => style === defaultTemplate?.tone,
  );
  const [taskId, setTaskId] = useState<string>();
  const [assets, setAssets] = useState<WorkspaceImageAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [variants, setVariants] = useState<VariantRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [postId, setPostId] = useState<string>();
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    defaultTemplate?.id ?? null,
  );
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      productName: "",
      category: defaultTemplate?.product_category ?? "",
      description: "",
      sellingPoints: defaultTemplate?.core_selling_points ?? "",
      targetAudience: defaultTemplate?.target_audience ?? "",
      price: "",
      brandName: defaultTemplate?.brand ?? "",
      style:
        defaultKnownStyle ?? (defaultTemplate?.tone ? "自定义" : "真实分享"),
      customStyle: defaultKnownStyle ? "" : (defaultTemplate?.tone ?? ""),
      additionalInfo: defaultTemplate?.additional_info ?? "",
      customInstructions: defaultTemplate?.custom_instructions ?? "",
    },
  });
  const selectedStyle = useWatch({ control: form.control, name: "style" });
  const referenceAssets = assets.filter((asset) => asset.kind === "uploaded");
  const generatedAssets = assets.filter((asset) => asset.kind === "generated");
  function applyTemplate(template: ContentTemplate) {
    form.setValue("category", template.product_category ?? "");
    form.setValue("targetAudience", template.target_audience ?? "");
    form.setValue("brandName", template.brand ?? "");
    form.setValue("sellingPoints", template.core_selling_points ?? "");
    form.setValue("additionalInfo", template.additional_info ?? "");
    form.setValue("customInstructions", template.custom_instructions ?? "");
    const knownStyle = writingStyles.find((style) => style === template.tone);
    form.setValue(
      "style",
      knownStyle ?? (template.tone ? "自定义" : "真实分享"),
    );
    form.setValue("customStyle", knownStyle ? "" : (template.tone ?? ""));
  }
  function selectTemplate(value: string | null) {
    setSelectedTemplateId(value);
    const template = templates.find((item) => item.id === value);
    if (template) applyTemplate(template);
  }
  async function saveCurrentAsTemplate() {
    if (!templateName.trim() || savingTemplate) return;
    setSavingTemplate(true);
    try {
      const current = form.getValues();
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName,
          productCategory: current.category,
          targetAudience: current.targetAudience,
          brand: current.brandName ?? "",
          tone:
            current.style === "自定义"
              ? (current.customStyle ?? "")
              : current.style,
          coreSellingPoints: current.sellingPoints,
          additionalInfo: current.additionalInfo ?? "",
          customInstructions: current.customInstructions ?? "",
          isDefault: false,
        }),
      });
      const data = (await response.json()) as {
        template?: ContentTemplate;
        error?: string;
      };
      if (!response.ok || !data.template)
        throw new Error(data.error || "模板保存失败。");
      setTemplates((currentTemplates) => [data.template!, ...currentTemplates]);
      setSelectedTemplateId(data.template.id);
      setSaveTemplateOpen(false);
      setTemplateName("");
      toast.success("当前配置已保存为模板");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板保存失败。");
    } finally {
      setSavingTemplate(false);
    }
  }
  async function ensureTask() {
    if (taskId) return taskId;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: form.getValues("productName") }),
    });
    const data = (await response.json()) as { taskId?: string; error?: string };
    if (!response.ok || !data.taskId) throw new Error(data.error);
    setTaskId(data.taskId);
    return data.taskId;
  }
  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    if (referenceAssets.length + files.length > 4) {
      toast.error("参考图最多上传 4 张");
      return;
    }
    if (assets.length + files.length > 9) {
      toast.error("当前任务最多保存 9 张图片");
      return;
    }
    setUploading(true);
    try {
      const currentTaskId = await ensureTask();
      const supabase = createClient();
      const userResult = await supabase.auth.getUser();
      if (!userResult.data.user)
        throw new Error("登录状态已失效，请重新登录。");
      for (const file of Array.from(files)) {
        if (!isSupportedImageMimeType(file.type))
          throw new Error(`${file.name} 格式不支持`);
        if (file.size > 8 * 1024 * 1024)
          throw new Error(`${file.name} 超过 8MB`);
        const dimensions = await readBrowserImageDimensions(file);
        const safeName = sanitizeImageFilename(file.name, file.type);
        const path = `${userResult.data.user.id}/${crypto.randomUUID()}.${imageExtensionByMime[file.type]}`;
        const uploaded = await supabase.storage
          .from("product-assets")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploaded.error) throw uploaded.error;
        const saved = await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: currentTaskId,
            storagePath: path,
            originalName: safeName,
            mimeType: file.type,
            sizeBytes: file.size,
            selectedForPublishing: false,
            ...dimensions,
          }),
        });
        const data = (await saved.json()) as {
          asset?: { id: string };
          error?: string;
        };
        if (!saved.ok || !data.asset) {
          await supabase.storage.from("product-assets").remove([path]);
          throw new Error(data.error);
        }
        setAssets((value) => [
          ...value,
          {
            id: data.asset!.id,
            storagePath: path,
            name: safeName,
            preview: URL.createObjectURL(file),
            size: file.size,
            kind: "uploaded",
          },
        ]);
      }
      toast.success("参考图上传完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }
  async function removeAsset(asset: WorkspaceImageAsset) {
    try {
      const response = await fetch(`/api/assets?id=${asset.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error);
      if (asset.preview.startsWith("blob:")) URL.revokeObjectURL(asset.preview);
      setAssets((value) => value.filter((item) => item.id !== asset.id));
      setSelectedAssetIds((value) => value.filter((id) => id !== asset.id));
      toast.success("图片已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  }
  async function generate(input: FormInput) {
    try {
      const currentTaskId = await ensureTask();
      setPostId(undefined);
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          taskId: currentTaskId,
          assetIds: [
            ...referenceAssets.map((asset) => asset.id),
            ...selectedAssetIds,
          ],
        }),
      });
      const data = (await response.json()) as {
        variants?: VariantRecord[];
        error?: string;
      };
      if (!response.ok || !data.variants) throw new Error(data.error);
      setVariants(data.variants);
      toast.success("已生成 3 个内容版本");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败，请重试");
    }
  }
  function addGeneratedAssets(generated: GeneratedAssetRecord[]) {
    const added = generated.map((asset) => ({
      id: asset.id,
      storagePath: asset.storage_path,
      name: asset.original_name,
      preview: asset.signedUrl,
      size: asset.size_bytes,
      kind: "generated" as const,
    }));
    setAssets((value) => [...value, ...added]);
    setSelectedAssetIds((value) => [
      ...value,
      ...added.map((asset) => asset.id),
    ]);
  }
  async function toggleAsset(assetId: string) {
    const selected = !selectedAssetIds.includes(assetId);
    try {
      const response = await fetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assetId, selected }),
      });
      const data = (await response.json()) as {
        asset?: { id: string; selected_for_publishing: boolean };
        error?: string;
      };
      if (!response.ok || !data.asset) throw new Error(data.error);
      setSelectedAssetIds((value) =>
        selected ? [...value, assetId] : value.filter((id) => id !== assetId),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片选择保存失败");
    }
  }
  function updateVariant(updated: VariantRecord) {
    setVariants((value) =>
      value.map((item) => (item.id === updated.id ? updated : item)),
    );
  }
  function selectFinal(updated: VariantRecord, savedPostId: string) {
    setVariants((value) =>
      value.map((item) => ({ ...item, is_final: item.id === updated.id })),
    );
    setPostId(savedPostId);
  }
  return (
    <div className="grid min-h-[calc(100vh-112px)] xl:grid-cols-[minmax(520px,1fr)_minmax(480px,1fr)]">
      <section className="border-b bg-background p-4 sm:p-6 xl:border-r xl:border-b-0">
        <form onSubmit={form.handleSubmit(generate)}>
          <FieldGroup>
            {!configured ? (
              <Alert>
                <AlertTitle>配置后即可使用真实流程</AlertTitle>
                <AlertDescription>
                  当前没有 Supabase
                  凭证，不会创建模拟数据。表单与响应式界面可正常预览。
                </AlertDescription>
              </Alert>
            ) : null}
            <section className="workspace-section">
              <div className="workspace-section-heading">
                <div>
                  <h2>产品信息</h2>
                  <p>填写商品图片生成真正需要的信息。</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  data-invalid={Boolean(form.formState.errors.productName)}
                >
                  <FieldLabel htmlFor="productName">产品名称</FieldLabel>
                  <Input
                    id="productName"
                    placeholder="例如：轻量通勤外套"
                    aria-invalid={Boolean(form.formState.errors.productName)}
                    {...form.register("productName")}
                  />
                  <FieldError errors={[form.formState.errors.productName]} />
                </Field>
              </div>
              <Field data-invalid={Boolean(form.formState.errors.description)}>
                <FieldLabel htmlFor="description">产品描述</FieldLabel>
                <Textarea
                  id="description"
                  placeholder="说明商品外观、材质和需要保留的细节"
                  aria-invalid={Boolean(form.formState.errors.description)}
                  {...form.register("description")}
                />
                <FieldError errors={[form.formState.errors.description]} />
              </Field>
              <Field
                data-invalid={Boolean(form.formState.errors.sellingPoints)}
              >
                <FieldLabel htmlFor="sellingPoints">
                  核心卖点（可选）
                </FieldLabel>
                <Textarea
                  id="sellingPoints"
                  placeholder="每行一个卖点，可暂时留空"
                  aria-invalid={Boolean(form.formState.errors.sellingPoints)}
                  {...form.register("sellingPoints")}
                />
                <FieldError errors={[form.formState.errors.sellingPoints]} />
              </Field>
            </section>

            <ReferenceImagesPanel
              assets={referenceAssets}
              uploading={uploading}
              disabled={!configured || assets.length >= 9}
              onUpload={uploadFiles}
              onDelete={removeAsset}
            />
            <AiImageGenerator
              configured={imageAiConfigured}
              disabled={uploading || assets.length >= 9}
              referenceAssetIds={referenceAssets.map((asset) => asset.id)}
              existingAssetCount={assets.length}
              ensureTask={ensureTask}
              onGenerated={addGeneratedAssets}
            />

            <details className="workspace-section group/advanced">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium">
                高级内容设置
                <span className="text-xs text-muted-foreground group-open/advanced:hidden">
                  展开
                </span>
                <span className="hidden text-xs text-muted-foreground group-open/advanced:inline">
                  收起
                </span>
              </summary>
              <div className="mt-5 grid gap-5 border-t pt-5">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor="content-template">
                        常用模板
                      </FieldLabel>
                      <Select
                        value={selectedTemplateId}
                        onValueChange={selectTemplate}
                      >
                        <SelectTrigger id="content-template" className="w-full">
                          <SelectValue>
                            {templates.find(
                              (template) => template.id === selectedTemplateId,
                            )?.name ?? "请选择模板"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name}
                              {template.is_default ? "（默认）" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!configured}
                      onClick={() => setSaveTemplateOpen(true)}
                    >
                      <Save data-icon="inline-start" />
                      保存为模板
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    模板只预填当前表单，不会改动图片、生成结果或历史内容。
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={Boolean(form.formState.errors.category)}>
                    <FieldLabel htmlFor="category">产品类别</FieldLabel>
                    <Input
                      id="category"
                      placeholder="例如：杯具水壶"
                      aria-invalid={Boolean(form.formState.errors.category)}
                      {...form.register("category")}
                    />
                    <FieldError errors={[form.formState.errors.category]} />
                  </Field>
                </div>
                <Field
                  data-invalid={Boolean(form.formState.errors.targetAudience)}
                >
                  <FieldLabel htmlFor="targetAudience">目标人群</FieldLabel>
                  <Input
                    id="targetAudience"
                    placeholder="希望触达的人群"
                    aria-invalid={Boolean(form.formState.errors.targetAudience)}
                    {...form.register("targetAudience")}
                  />
                  <FieldError errors={[form.formState.errors.targetAudience]} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="price">价格（可选）</FieldLabel>
                    <Input
                      id="price"
                      placeholder="例如：129 元"
                      {...form.register("price")}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="brandName">品牌名（可选）</FieldLabel>
                    <Input id="brandName" {...form.register("brandName")} />
                  </Field>
                </div>
                <FieldSet>
                  <FieldLabel>表达风格</FieldLabel>
                  <Controller
                    control={form.control}
                    name="style"
                    render={({ field }) => (
                      <ToggleGroup
                        value={[field.value]}
                        onValueChange={(value) =>
                          value[0] && field.onChange(value[0])
                        }
                        variant="outline"
                        className="flex w-full flex-wrap justify-start"
                      >
                        {writingStyles.map((style) => (
                          <ToggleGroupItem key={style} value={style}>
                            {style}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    )}
                  />
                  {selectedStyle === "自定义" ? (
                    <Field
                      data-invalid={Boolean(form.formState.errors.customStyle)}
                    >
                      <Input
                        placeholder="描述你希望的语气和结构"
                        aria-invalid={Boolean(
                          form.formState.errors.customStyle,
                        )}
                        {...form.register("customStyle")}
                      />
                      <FieldError
                        errors={[form.formState.errors.customStyle]}
                      />
                    </Field>
                  ) : null}
                </FieldSet>
                <Field>
                  <FieldLabel htmlFor="additionalInfo">补充信息</FieldLabel>
                  <Textarea
                    id="additionalInfo"
                    placeholder="使用场景、特别说明、必须避免的表达等"
                    {...form.register("additionalInfo")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="customInstructions">
                    固定内容要求
                  </FieldLabel>
                  <Textarea
                    id="customInstructions"
                    placeholder="例如：正文尽量控制在 300 字以内，不要使用夸张营销语言。"
                    {...form.register("customInstructions")}
                  />
                  <p className="text-xs text-muted-foreground">
                    作为额外生成要求使用，不能覆盖系统安全与平台合规规则。
                  </p>
                </Field>
                <Button
                  type="submit"
                  size="lg"
                  disabled={
                    !configured || form.formState.isSubmitting || uploading
                  }
                >
                  {form.formState.isSubmitting ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <FileText data-icon="inline-start" />
                  )}
                  {form.formState.isSubmitting
                    ? "正在生成，请稍候…"
                    : "生成 3 个文案版本"}
                </Button>
              </div>
            </details>
          </FieldGroup>
        </form>
      </section>
      <section className="min-w-0 bg-muted/20 p-4 sm:p-6">
        <GeneratedImagesPanel
          assets={generatedAssets}
          selectedAssetIds={selectedAssetIds}
          onToggle={toggleAsset}
          onDelete={removeAsset}
        />
        <div className="my-6 border-t" />
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">文案结果</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              可编辑、复制、保存或选择最终版本
            </p>
          </div>
        </div>
        {variants.length ? (
          <div className="flex flex-col gap-4">
            {variants.map((variant) => (
              <VariantCard
                key={variant.id}
                variant={variant}
                onUpdate={updateVariant}
                onFinal={selectFinal}
              />
            ))}
            {postId ? (
              <Alert>
                <AlertTitle>草稿已保存</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>当前版本需要人工确认发布。</span>
                  <Button
                    nativeButton={false}
                    size="sm"
                    render={<Link href={`/posts/${postId}`} />}
                  >
                    进入发布准备
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : (
          <Card className="border-dashed bg-background/60">
            <CardHeader className="items-center pb-2 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <ImagePlus className="size-5" />
              </div>
              <CardTitle className="mt-2 text-base">等待生成内容</CardTitle>
              <CardDescription className="max-w-sm">
                填写左侧信息并点击生成，这里会显示 3
                个结构与角度不同的候选版本。
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-8" />
          </Card>
        )}
      </section>
      <Dialog
        open={saveTemplateOpen}
        onOpenChange={(open) => {
          if (!savingTemplate) setSaveTemplateOpen(open);
        }}
      >
        <DialogContent showCloseButton={!savingTemplate}>
          <DialogHeader>
            <DialogTitle>保存当前配置为模板</DialogTitle>
            <DialogDescription>
              将保存品类、人群、品牌、风格、卖点、补充信息和固定内容要求。
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="new-template-name">模板名称</FieldLabel>
            <Input
              id="new-template-name"
              autoFocus
              maxLength={120}
              placeholder="例如：轻奢通勤女包"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveCurrentAsTemplate();
                }
              }}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={savingTemplate}
              onClick={() => setSaveTemplateOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={savingTemplate || !templateName.trim()}
              onClick={saveCurrentAsTemplate}
            >
              {savingTemplate ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {savingTemplate ? "正在保存…" : "保存模板"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

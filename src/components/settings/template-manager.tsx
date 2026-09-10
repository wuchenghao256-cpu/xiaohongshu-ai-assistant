"use client";

import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ContentTemplate, TemplatePayload } from "@/lib/templates/types";

const emptyDraft: TemplatePayload = {
  name: "",
  productCategory: "",
  targetAudience: "",
  brand: "",
  tone: "真实分享",
  coreSellingPoints: "",
  additionalInfo: "",
  customInstructions: "",
  isDefault: false,
};

function toDraft(template: ContentTemplate): TemplatePayload {
  return {
    name: template.name,
    productCategory: template.product_category ?? "",
    targetAudience: template.target_audience ?? "",
    brand: template.brand ?? "",
    tone: template.tone ?? "真实分享",
    coreSellingPoints: template.core_selling_points ?? "",
    additionalInfo: template.additional_info ?? "",
    customInstructions: template.custom_instructions ?? "",
    isDefault: template.is_default,
  };
}

export function TemplateManager({ initialTemplates }: { initialTemplates: ContentTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [editing, setEditing] = useState<ContentTemplate | null | undefined>(undefined);
  const [draft, setDraft] = useState<TemplatePayload>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [defaultingId, setDefaultingId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<ContentTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setDraft({ ...emptyDraft });
    setEditing(null);
  }

  function openEdit(template: ContentTemplate) {
    setDraft(toDraft(template));
    setEditing(template);
  }

  function closeEditor() {
    if (!saving) setEditing(undefined);
  }

  function update<K extends keyof TemplatePayload>(key: K, value: TemplatePayload[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/templates/${editing.id}` : "/api/templates", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json() as { template?: ContentTemplate; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error || "模板保存失败。");
      setTemplates((current) => editing
        ? current.map((item) => item.id === data.template!.id ? data.template! : data.template!.is_default ? { ...item, is_default: false } : item)
        : [data.template!, ...current.map((item) => data.template!.is_default ? { ...item, is_default: false } : item)]);
      setEditing(undefined);
      toast.success(editing ? "模板已更新" : "模板已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(template: ContentTemplate) {
    if (template.is_default || defaultingId) return;
    setDefaultingId(template.id);
    try {
      const response = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      const data = await response.json() as { template?: ContentTemplate; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error || "默认模板设置失败。");
      setTemplates((current) => current.map((item) => ({ ...item, is_default: item.id === template.id })));
      toast.success(`已将“${template.name}”设为默认模板`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "默认模板设置失败。");
    } finally {
      setDefaultingId(undefined);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/templates/${deleteTarget.id}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "模板删除失败。");
      setTemplates((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("模板已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板删除失败。");
    } finally {
      setDeleting(false);
    }
  }

  return <Card>
    <CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>常用内容模板</CardTitle><CardDescription>保存长期复用的品类、人群、风格和固定内容要求。</CardDescription></div><Button type="button" size="sm" onClick={openCreate}><Plus data-icon="inline-start" />新建模板</Button></CardHeader>
    <CardContent>
      {templates.length ? <div className="divide-y rounded-xl border">{templates.map((template) => <div key={template.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{template.name}</p>{template.is_default ? <Badge variant="secondary"><Check />默认</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{[template.product_category, template.target_audience, template.tone].filter(Boolean).join(" · ") || "尚未填写模板详情"}</p></div>
        <div className="flex flex-wrap items-center gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => openEdit(template)}><Pencil data-icon="inline-start" />编辑</Button>{!template.is_default ? <Button type="button" variant="ghost" size="sm" disabled={Boolean(defaultingId)} onClick={() => setDefault(template)}>{defaultingId === template.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}设为默认</Button> : null}<Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(template)}><Trash2 data-icon="inline-start" />删除</Button></div>
      </div>)}</div> : <div className="rounded-xl border border-dashed p-8 text-center"><p className="font-medium">还没有常用模板</p><p className="mt-1 text-sm text-muted-foreground">创建后可在 Create 页面一键预填。</p></div>}
    </CardContent>

    <Dialog open={editing !== undefined} onOpenChange={(open) => { if (!open) closeEditor(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" showCloseButton={!saving}>
      <form onSubmit={save} className="grid gap-4"><DialogHeader><DialogTitle>{editing ? "编辑模板" : "新建模板"}</DialogTitle><DialogDescription>模板只保存可长期复用的配置，不保存产品名称、价格、图片或生成结果。</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="template-name">模板名称</Label><Input id="template-name" required maxLength={120} value={draft.name} onChange={(event) => update("name", event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="template-category">产品类别</Label><Input id="template-category" maxLength={80} value={draft.productCategory} onChange={(event) => update("productCategory", event.target.value)} /></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="template-brand">品牌</Label><Input id="template-brand" maxLength={100} value={draft.brand} onChange={(event) => update("brand", event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="template-tone">表达风格</Label><Input id="template-tone" maxLength={300} value={draft.tone} onChange={(event) => update("tone", event.target.value)} /></div></div>
        <div className="grid gap-2"><Label htmlFor="template-audience">目标人群</Label><Textarea id="template-audience" maxLength={500} value={draft.targetAudience} onChange={(event) => update("targetAudience", event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="template-selling-points">核心卖点</Label><Textarea id="template-selling-points" maxLength={1000} value={draft.coreSellingPoints} onChange={(event) => update("coreSellingPoints", event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="template-additional-info">补充信息</Label><Textarea id="template-additional-info" maxLength={1500} value={draft.additionalInfo} onChange={(event) => update("additionalInfo", event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="template-instructions">固定内容要求</Label><Textarea id="template-instructions" maxLength={1500} placeholder="例如：不要过度夸张，突出日常使用场景。" value={draft.customInstructions} onChange={(event) => update("customInstructions", event.target.value)} /><p className="text-xs text-muted-foreground">不能覆盖系统安全与平台合规规则。</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isDefault} onChange={(event) => update("isDefault", event.target.checked)} className="size-4 rounded border-input" />设为默认模板</label>
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={closeEditor}>取消</Button><Button type="submit" disabled={saving || !draft.name.trim()}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{saving ? "正在保存…" : "保存模板"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>

    <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}><DialogContent showCloseButton={!deleting}><DialogHeader><DialogTitle>确定删除这个模板吗？</DialogTitle><DialogDescription>删除模板不会影响已经生成或保存的历史内容。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button><Button type="button" variant="destructive" disabled={deleting} onClick={confirmDelete}>{deleting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}{deleting ? "正在删除…" : "确认删除"}</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}

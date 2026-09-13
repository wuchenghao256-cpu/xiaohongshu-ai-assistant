"use client";
import { Check, Copy, Loader2, Pencil, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type VariantRecord = { id: string; task_id: string; version_number: number; title: string; body: string; hashtags: string[]; angle: string; reasoning_summary: string; is_final: boolean };
export function VariantCard({ variant, onUpdate, onFinal }: { variant: VariantRecord; onUpdate: (variant: VariantRecord) => void; onFinal: (variant: VariantRecord, postId: string) => void }) {
  const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [finalizing, setFinalizing] = useState(false); const [copying, setCopying] = useState(false); const [draft, setDraft] = useState(variant);
  async function copyAll() {
    // 剪贴板写入在某些浏览器/权限下会直接抛错，之前没有 catch，失败时用户完全没反馈。
    if (copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(`${draft.title}\n\n${draft.body}\n\n${draft.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}`);
      toast.success("标题、正文和标签已复制");
    } catch { toast.error("复制失败，请手动选择文本复制"); }
    finally { setCopying(false); }
  }
  async function save() { if (saving) return; setSaving(true); try { const response = await fetch(`/api/variants/${variant.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: draft.title, body: draft.body, hashtags: draft.hashtags, angle: draft.angle, reasoning_summary: draft.reasoning_summary }) }); const data = await response.json() as { variant?: VariantRecord; error?: string }; if (!response.ok || !data.variant) throw new Error(data.error); onUpdate(data.variant); setEditing(false); toast.success("候选版本已保存"); return true; } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); return false; } finally { setSaving(false); } }
  async function setFinal() { setFinalizing(true); try { if (editing && !(await save())) return; const response = await fetch(`/api/tasks/${variant.task_id}/final`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: variant.id }) }); const data = await response.json() as { post?: { id: string }; error?: string }; if (!response.ok || !data.post) throw new Error(data.error); onFinal({ ...draft, is_final: true }, data.post.id); toast.success("已设为最终版本并保存草稿"); } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); } finally { setFinalizing(false); } }
  return <Card className={cn("relative overflow-hidden transition-colors", variant.is_final && "border-primary")}><div className={cn("absolute inset-y-0 left-0 w-1 bg-transparent", variant.is_final && "bg-primary")} /><CardHeader className="pl-6"><div className="flex items-start justify-between gap-3"><div><CardDescription>版本 {variant.version_number} · {draft.angle}</CardDescription>{editing ? <Input className="mt-2 h-10 text-base font-semibold" value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} /> : <CardTitle className="mt-2 text-base leading-6">{draft.title}</CardTitle>}</div>{variant.is_final ? <Badge>最终版本</Badge> : null}</div></CardHeader><CardContent className="pl-6">{editing ? <div className="flex flex-col gap-3"><Textarea className="min-h-44 leading-6" value={draft.body} onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))} /><Input value={draft.hashtags.join(" ")} onChange={(event) => setDraft((value) => ({ ...value, hashtags: event.target.value.split(/[\s,，]+/).filter(Boolean).map((tag) => tag.replace(/^#/, "")) }))} placeholder="标签以空格分隔" /></div> : <><p className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">{draft.body}</p><div className="mt-4 flex flex-wrap gap-2">{draft.hashtags.map((tag) => <span key={tag} className="text-sm text-primary">#{tag.replace(/^#/, "")}</span>)}</div></>}<div className="mt-5 rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">内容角度：</span>{draft.reasoning_summary}</div></CardContent><CardFooter className="flex flex-wrap justify-end gap-2 pl-6"><Button variant="ghost" size="sm" onClick={() => setEditing((value) => !value)}><Pencil data-icon="inline-start" />{editing ? "取消" : "编辑"}</Button><Button variant="outline" size="sm" onClick={copyAll} disabled={copying}>{copying ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Copy data-icon="inline-start" />}{copying ? "复制中…" : "复制"}</Button><Button variant="outline" size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}{saving ? "保存中…" : "保存"}</Button><Button size="sm" onClick={setFinal} disabled={finalizing || variant.is_final}>{finalizing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}{variant.is_final ? "已设为最终版本" : finalizing ? "处理中…" : "设为最终版本"}</Button></CardFooter></Card>;
}

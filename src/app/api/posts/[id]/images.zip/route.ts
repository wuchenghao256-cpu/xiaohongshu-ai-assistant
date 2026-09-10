import { zipSync } from "fflate";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";

function safeFileName(value: string, fallback: string) {
  const base = value.split(/[\\/]/).pop()?.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return base || fallback;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "内容 ID 无效。" }, { status: 400 });
    const { user, supabase } = await requireUser();
    const post = await supabase.from("posts").select("id,task_id").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (post.error) throw post.error;
    if (!post.data) return Response.json({ error: "内容不存在或无权访问。" }, { status: 404 });

    const assets = await supabase
      .from("assets")
      .select("id,storage_bucket,storage_path,original_name")
      .eq("task_id", post.data.task_id)
      .eq("user_id", user.id)
      .eq("selected_for_publishing", true)
      .order("created_at");
    if (assets.error) throw assets.error;
    if (!assets.data.length) return Response.json({ error: "没有选中的发布图片。" }, { status: 404 });

    const usedNames = new Set<string>();
    const entries: Record<string, Uint8Array> = {};
    for (const [index, asset] of assets.data.entries()) {
      if (!asset.storage_path.startsWith(`${user.id}/`)) return Response.json({ error: "检测到无法安全确认归属的图片。" }, { status: 409 });
      const downloaded = await supabase.storage.from(asset.storage_bucket).download(asset.storage_path);
      if (downloaded.error) throw downloaded.error;
      const original = safeFileName(asset.original_name, `image-${index + 1}.jpg`);
      const dot = original.lastIndexOf(".");
      const stem = dot > 0 ? original.slice(0, dot) : original;
      const extension = dot > 0 ? original.slice(dot) : "";
      let name = original;
      let duplicate = 2;
      while (usedNames.has(name.toLocaleLowerCase())) name = `${stem}-${duplicate++}${extension}`;
      usedNames.add(name.toLocaleLowerCase());
      entries[name] = new Uint8Array(await downloaded.data.arrayBuffer());
    }

    const zip = zipSync(entries, { level: 0 });
    const body = new Uint8Array(zip.byteLength);
    body.set(zip);
    return new Response(body.buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=post-images.zip; filename*=UTF-8''post-images.zip",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

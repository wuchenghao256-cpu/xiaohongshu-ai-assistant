import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, supabase } = await requireUser();
    const existing = await supabase.from("video_assets").select("id,storage_path,original_name,size_bytes").eq("video_job_id", id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return Response.json({ asset: existing.data });
    const job = await supabase.from("video_jobs").select("output_url,status").eq("id", id).single();
    if (job.error || job.data.status !== "completed" || !job.data.output_url) throw new Error("视频尚未生成完成");
    const outputUrl = new URL(job.data.output_url);
    if (outputUrl.protocol !== "https:") throw new Error("Runway 视频地址无效");
    const response = await fetch(outputUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Runway 视频下载失败");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_VIDEO_BYTES) throw new Error("视频超过作品库 100MB 上限");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new Error("视频文件无效或超过 100MB");
    const path = `${user.id}/${crypto.randomUUID()}.mp4`;
    const upload = await supabase.storage.from("video-assets").upload(path, bytes, { contentType: "video/mp4", upsert: false });
    if (upload.error) throw upload.error;
    const asset = await supabase.from("video_assets").insert({ user_id: user.id, video_job_id: id, storage_path: path, original_name: `AI视频-${id.slice(0, 8)}.mp4`, size_bytes: bytes.length }).select("id,storage_path,original_name,size_bytes").single();
    if (asset.error) { await supabase.storage.from("video-assets").remove([path]); throw asset.error; }
    return Response.json({ asset: asset.data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

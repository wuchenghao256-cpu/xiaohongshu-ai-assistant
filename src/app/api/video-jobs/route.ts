import { z } from "zod";
import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { requireUser } from "@/lib/supabase/auth";
import { createRunwayTask, getRunwayTask } from "@/lib/video/runway";
import { videoJobInputSchema, type VideoJobInput } from "@/lib/video/types";

async function signedInputs(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, paths: string[]) {
  if (paths.some((path) => !path.startsWith(`${userId}/video-inputs/`))) throw new Error("无效的视频参考图路径");
  return Promise.all(paths.map(async (path) => {
    const signed = await supabase.storage.from("product-assets").createSignedUrl(path, 86400);
    if (signed.error) throw signed.error;
    return signed.data.signedUrl;
  }));
}

async function startJob(userId: string, supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], input: VideoJobInput) {
  const config = await getEnabledProviderConfig(userId, "video");
  if (!config || config.provider !== "runway") throw new Error("请先在设置中启用 Runway 视频 API");
  const created = await supabase.from("video_jobs").insert({ user_id: userId, kind: input.kind, input_snapshot: input }).select("id,kind,status,progress,created_at").single();
  if (created.error) throw created.error;
  try {
    const externalId = await createRunwayTask(config, input, await signedInputs(supabase, userId, input.inputPaths));
    const updated = await supabase.from("video_jobs").update({ status: "generating", progress: 1, external_task_id: externalId }).eq("id", created.data.id).select("id,kind,status,progress,created_at,updated_at").single();
    if (updated.error) throw updated.error;
    return updated.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runway 任务创建失败";
    const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: message }).eq("id", created.data.id).select("id,kind,status,progress,error_message,created_at,updated_at").single();
    if (failed.error) throw failed.error;
    return failed.data;
  }
}

export async function POST(request: Request) {
  try {
    const input = videoJobInputSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    return Response.json({ job: await startJob(user.id, supabase, input) }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

export async function GET(request: Request) {
  try {
    const id = z.string().uuid().optional().parse(new URL(request.url).searchParams.get("id") ?? undefined);
    const { user, supabase } = await requireUser();
    let query = supabase.from("video_jobs").select("id,kind,status,progress,external_task_id,input_snapshot,output_url,error_message,created_at,updated_at,completed_at").order("created_at", { ascending: false }).limit(id ? 1 : 12);
    if (id) query = query.eq("id", id);
    const result = await query;
    if (result.error) throw result.error;
    const config = await getEnabledProviderConfig(user.id, "video");
    const jobs = await Promise.all((result.data ?? []).map(async (job) => {
      if (!config || !job.external_task_id || !["queued", "generating"].includes(job.status)) return job;
      try {
        const remote = await getRunwayTask(config, job.external_task_id);
        const remoteStatus = String(remote.status ?? "").toUpperCase();
        const progressValue = typeof remote.progress === "number" ? Math.round(remote.progress <= 1 ? remote.progress * 100 : remote.progress) : undefined;
        const output = Array.isArray(remote.output) && typeof remote.output[0] === "string" ? remote.output[0] : undefined;
        const status = remoteStatus === "SUCCEEDED" ? "completed" : ["FAILED", "CANCELED", "CANCELLED"].includes(remoteStatus) ? "failed" : "generating";
        const changes = { status, progress: status === "completed" ? 100 : Math.max(job.progress, progressValue ?? (remoteStatus === "RUNNING" ? 20 : 5)), output_url: output ?? job.output_url,
          error_message: status === "failed" ? String(remote.failure ?? remote.failureCode ?? "Runway 生成失败") : null, completed_at: status === "completed" ? new Date().toISOString() : null };
        await supabase.from("video_jobs").update(changes).eq("id", job.id);
        return { ...job, ...changes };
      } catch { return job; }
    }));
    const jobIds = jobs.map((job) => job.id);
    const saved = jobIds.length ? await supabase.from("video_assets").select("video_job_id").in("video_job_id", jobIds) : { data: [], error: null };
    if (saved.error) throw saved.error;
    const savedIds = new Set((saved.data ?? []).map((item) => item.video_job_id));
    return Response.json({ jobs: jobs.map((job) => ({ ...job, saved: savedIds.has(job.id) })) });
  } catch (error) { return jsonError(error); }
}

import { z } from "zod";
import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { requireUser } from "@/lib/supabase/auth";
import { isDueForPoll, isStrandedQueuedJob, pollVideoJob, type PollableJob } from "@/lib/video/poll";
import { createProviderTask } from "@/lib/video/provider";
import { videoJobInputSchema, withoutIdempotencyKey, type VideoJobInput } from "@/lib/video/types";

export const maxDuration = 120;

const JOB_COLUMNS = "id,kind,status,progress,provider,external_task_id,input_snapshot,output_url,error_message,created_at,updated_at,completed_at";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

function providerLabel(provider: string) {
  return provider === "volcengine" ? "豆包 Seedance 2.0" : provider === "runway" ? "Runway" : "视频生成";
}

function notConfiguredMessage(provider: string) {
  return provider === "volcengine" || !provider
    ? "请先在系统设置 → 视频模型中启用豆包 Seedance 2.0。"
    : "请先在系统设置 → 视频模型中启用 Runway 视频 API。";
}

async function signedInputs(supabase: Supabase, userId: string, paths: string[]) {
  if (paths.some((path) => !path.startsWith(`${userId}/video-inputs/`))) throw new Error("无效的视频参考图路径");
  return Promise.all(paths.map(async (path) => {
    const signed = await supabase.storage.from("product-assets").createSignedUrl(path, 86400);
    if (signed.error) throw signed.error;
    return signed.data.signedUrl;
  }));
}

/** 相同幂等令牌只允许存在一个任务，避免连点造成重复计费。 */
async function findByKey(supabase: Supabase, userId: string, key: string) {
  const existing = await supabase.from("video_jobs").select(JOB_COLUMNS).eq("user_id", userId).eq("idempotency_key", key).limit(1).maybeSingle();
  if (existing.error) return null;
  return existing.data;
}

/**
 * 先落库再调用 Provider。任何失败都只更新这一条记录，不会遗留孤儿任务，
 * 也不会出现“重复点击 → 两个已计费视频任务”。
 */
async function startJob(userId: string, supabase: Supabase, input: VideoJobInput) {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const reused = await findByKey(supabase, userId, idempotencyKey);
  if (reused) return reused;

  const config = await getEnabledProviderConfig(userId, "video");
  const provider = config?.provider ?? "volcengine";
  if (!config) return { error: notConfiguredMessage(provider) };

  const created = await supabase.from("video_jobs").insert({
    user_id: userId, kind: input.kind, status: "queued", progress: 0, provider,
    input_snapshot: withoutIdempotencyKey(input), idempotency_key: idempotencyKey,
  }).select(JOB_COLUMNS).single();

  if (created.error) {
    // 唯一索引冲突说明另一个并发请求正在创建同一任务，直接返回那一条。
    if (created.error.code === "23505") return (await findByKey(supabase, userId, idempotencyKey)) ?? { error: "任务正在创建中，请稍后刷新查看。" };
    throw created.error;
  }

  try {
    const externalTaskId = await createProviderTask(config, input, await signedInputs(supabase, userId, input.inputPaths));
    const updated = await supabase.from("video_jobs").update({
      status: "generating", progress: 5, external_task_id: externalTaskId,
      submitted_at: new Date().toISOString(),
    }).eq("id", created.data.id).select(JOB_COLUMNS).single();
    if (updated.error) throw updated.error;
    return updated.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : `${providerLabel(provider)} 任务创建失败`;
    const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: message }).eq("id", created.data.id).select(JOB_COLUMNS).single();
    if (failed.error) throw failed.error;
    return failed.data;
  }
}

export async function POST(request: Request) {
  try {
    const input = videoJobInputSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const job = await startJob(user.id, supabase, input);
    if ("error" in job) return Response.json({ error: job.error }, { status: 400 });
    return Response.json({ job }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

export async function GET(request: Request) {
  try {
    const id = z.string().uuid().optional().parse(new URL(request.url).searchParams.get("id") ?? undefined);
    const { user, supabase } = await requireUser();
    let query = supabase.from("video_jobs").select(`${JOB_COLUMNS},submitted_at,last_polled_at,poll_attempts`).order("created_at", { ascending: false }).limit(id ? 1 : 12);
    if (id) query = query.eq("id", id);
    const result = await query;
    if (result.error) throw result.error;

    const rows = (result.data ?? []) as Array<PollableJob & { kind: string; input_snapshot: unknown; updated_at: string; created_at: string }>;
    const config = await getEnabledProviderConfig(user.id, "video");
    const active = rows.filter((job) => ["queued", "generating"].includes(job.status) && job.external_task_id);
    const due = config ? active.filter((job) => isDueForPoll(job.last_polled_at, job.poll_attempts)) : [];

    // 同一批只查询一次 Provider：只在到期时才发请求，其余任务直接返回当前状态。
    const polled = new Map<string, Record<string, unknown>>();
    for (const job of due) {
      if (!config) break;
      const changes = await pollVideoJob(config, job);
      if (!changes) continue;
      const updated = await supabase.from("video_jobs").update(changes).eq("id", job.id).select(JOB_COLUMNS).single();
      if (!updated.error) polled.set(job.id, updated.data);
    }

    // 提交过程被中断、从未拿到 Provider 任务 ID 的记录不应一直显示“排队中”。
    for (const job of rows) {
      if (!isStrandedQueuedJob(job)) continue;
      const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: "任务创建未完成，请重新生成。" }).eq("id", job.id).select(JOB_COLUMNS).single();
      if (!failed.error) polled.set(job.id, failed.data);
    }

    const jobs = rows.map((job) => (polled.get(job.id) ?? job) as Record<string, unknown>);
    const jobIds = jobs.map((job) => String(job.id));
    const saved = jobIds.length ? await supabase.from("video_assets").select("video_job_id").in("video_job_id", jobIds) : { data: [], error: null };
    if (saved.error) throw saved.error;
    const savedIds = new Set((saved.data ?? []).map((item) => item.video_job_id));
    return Response.json({ jobs: jobs.map((job) => ({ ...job, saved: savedIds.has(String(job.id)) })) });
  } catch (error) { return jsonError(error); }
}

import { z } from "zod";
import { jsonError } from "@/lib/http";
import { getVideoProviderConfig, isMissingDashscopeKey } from "@/lib/providers/repository";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import { requireUser } from "@/lib/supabase/auth";
import { categorizeCreateError, CREATE_TIMEOUT_USER_MESSAGE, CREATE_UNKNOWN_USER_MESSAGE, mayHaveCreatedUpstream, withRecoveryHint } from "@/lib/video/error-category";
import { verifyPublicImageUrl } from "@/lib/video/fetch";
import { logVideoEvent } from "@/lib/video/log";
import { isDueForPoll, pollVideoJob, type PollableJob } from "@/lib/video/poll";
import { needsPersistence, resolvePlaybackUrl } from "@/lib/video/playback";
import { autoPersistAndSign, signVideoAsset, type PersistedVideoAsset } from "@/lib/video/persist";
import { createProviderTask, isWanProvider, toUserMessage } from "@/lib/video/provider";
import { isJobActive, videoJobInputSchema, withoutIdempotencyKey, type VideoJobInput } from "@/lib/video/types";

export const maxDuration = 120;

const JOB_COLUMNS = "id,kind,status,progress,provider,external_task_id,input_snapshot,output_url,error_message,provider_status,provider_meta,submitted_at,last_polled_at,poll_attempts,created_at,updated_at,completed_at";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

const PROVIDER_LABELS: Record<string, string> = {
  volcengine: "豆包 Seedance 2.0",
  runway: "Runway",
  alibaba: "阿里云 Wan2.7",
};

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? "视频生成";
}

function notConfiguredMessage(provider: string) {
  if (provider === "alibaba") return "请先在系统设置 → 视频模型中启用阿里云 Wan2.7。";
  return provider === "volcengine" || !provider
    ? "请先在系统设置 → 视频模型中启用豆包 Seedance 2.0。"
    : "请先在系统设置 → 视频模型中启用 Runway 视频 API。";
}

async function signedInputs(supabase: Supabase, userId: string, paths: string[]) {
  if (paths.some((path) => !path.startsWith(`${userId}/video-inputs/`))) throw new Error("无效的视频参考图路径");
  return Promise.all(paths.map(async (path) => {
    // 百炼首帧图的读取窗口是「提交那一刻」，因此给足有效期：
    // 12 小时足够覆盖最长 45 分钟的生成与轮询，也不会长期暴露原图。
    const ttl = 43200;
    const signed = await supabase.storage.from("product-assets").createSignedUrl(path, ttl);
    if (signed.error) throw signed.error;
    return signed.data.signedUrl;
  }));
}

/**
 * 阿里服务在实际生成时才会去下载 first_frame。提交前先确认这个地址真的可读，
 * 否则用户要等几十秒才能收到一句「图片取不到」。
 *
 * 这一步只读不写、不产生任何计费，因此**故意放在建行之前**：这类失败可以确定没有
 * 提交给 Provider，不该被归到「上游可能已计费、请走恢复流程」那一类。
 * 同理，Storage 签名失败也在这里暴露，而不是伪装成一次 Provider 创建失败。
 */
async function resolveInputUrls(supabase: Supabase, userId: string, config: ProviderRuntimeConfig, input: VideoJobInput) {
  const urls = await signedInputs(supabase, userId, input.inputPaths);
  if (!isWanProvider(config)) return urls;
  const first = urls[0];
  if (first && !(await verifyPublicImageUrl(first))) {
    throw new Error("首帧图地址不可公开访问，请重新上传参考图后再试。");
  }
  return urls;
}

/** 相同幂等令牌只允许存在一个任务，避免连点造成重复计费。 */
async function findByKey(supabase: Supabase, userId: string, key: string) {
  const existing = await supabase.from("video_jobs").select(JOB_COLUMNS).eq("user_id", userId).eq("idempotency_key", key).limit(1).maybeSingle();
  if (existing.error) return null;
  return existing.data;
}

/**
 * 先落库再调用 Provider。任何失败都只更新这一条记录，不会遗留孤儿任务，
 * 也不会出现「重复点击 → 两个已计费视频任务」。
 *
 * 已知限制（本轮审计确认，尚未修复）：创建请求超时 / 5xx / 网络中断时，
 * 上游可能已经受理并计费，但响应丢失让我们拿不到 task_id，本地无法对账。
 * 这种情况下任务会停在 failed，必须由用户显式「恢复任务」或「重新生成」，
 * 系统绝不会自动重发创建请求。
 */
async function startJob(userId: string, supabase: Supabase, input: VideoJobInput) {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const reused = await findByKey(supabase, userId, idempotencyKey);
  if (reused) return reused;

  const config = await getVideoProviderConfig(userId);
  const provider = config?.provider ?? "volcengine";
  if (!config) return { error: notConfiguredMessage(provider) };
  // 百炼的密钥来自环境变量而不是表单。缺失时提前拦下，否则会把一个没有
  // Authorization 的请求发出去，再拿 401 误导用户去检查密钥（而问题根本不在这里）。
  if (isMissingDashscopeKey(config)) return { error: "服务端未配置 DASHSCOPE_API_KEY，无法创建阿里云 Wan 任务。" };

  // 先解析参考图地址再建行：这一步不产生 Provider 调用，失败时不必留下任务记录，
  // 也就能让用户直接重试，而不是被引导去走「恢复任务」。
  let urls: string[];
  try {
    urls = await resolveInputUrls(supabase, userId, config, input);
  } catch (error) {
    return { error: toUserMessage(error, "参考图地址无效，请重新上传后再试。") };
  }

  const created = await supabase.from("video_jobs").insert({
    user_id: userId, kind: input.kind, status: "queued", progress: 0, provider,
    input_snapshot: withoutIdempotencyKey(input), idempotency_key: idempotencyKey,
  }).select(JOB_COLUMNS).single();

  if (created.error) {
    // 唯一索引冲突说明另一个并发请求正在创建同一任务，直接返回那一条。
    if (created.error.code === "23505") return (await findByKey(supabase, userId, idempotencyKey)) ?? { error: "任务正在创建中，请稍后刷新查看。" };
    throw created.error;
  }

  const startedAt = Date.now();
  logVideoEvent("create.start", { jobId: created.data.id, provider, kind: input.kind, idempotencyKey, referenceImageCount: input.inputPaths.length });
  try {
    const externalTaskId = await createProviderTask(config, input, urls);
    const updated = await supabase.from("video_jobs").update({
      status: "generating", progress: 5, external_task_id: externalTaskId,
      submitted_at: new Date().toISOString(),
    }).eq("id", created.data.id).select(JOB_COLUMNS).single();
    logVideoEvent("create.ok", { jobId: created.data.id, provider, upstreamTaskId: externalTaskId, durationMs: Date.now() - startedAt, persisted: !updated.error });
    if (updated.error) {
      // Provider 任务已经创建并计费，只是本地写入失败。对外仍返回 task id，但这条响应
      // 救不了刷新：数据库里这条记录仍然没有 external_task_id。不确定状态交给
      // 「恢复任务」按 local job id 反查，而不是让用户以为已经安全落库。
      logVideoEvent("create.persist_failed", { jobId: created.data.id, provider, upstreamTaskId: externalTaskId, code: updated.error.code });
      return {
        ...created.data,
        status: "failed",
        progress: 5,
        external_task_id: null,
        error_message: "视频任务已在生成服务中创建，但本地保存失败。请点「恢复任务」按下方任务 ID 找回，不要重新提交以免重复计费。",
      };
    }
    return updated.data;
  } catch (error) {
    const category = categorizeCreateError(error);
    // 断网 / 网关超时这类根本拿不到响应体的情况，由前端拼同一句指向「恢复任务」的说明，
    // 因此这里给出的文案必须和前端 isUndeterminedCreateFailure 的匹配规则保持一致。
    const message = category === "timeout" || category === "unknown"
      ? (category === "timeout" ? CREATE_TIMEOUT_USER_MESSAGE : CREATE_UNKNOWN_USER_MESSAGE)
      : withRecoveryHint(toUserMessage(error, `${providerLabel(provider)} 任务创建失败。`), category);
    const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: message }).eq("id", created.data.id).select(JOB_COLUMNS).single();
    logVideoEvent("create.failed", { jobId: created.data.id, provider, category, mayHaveCharged: mayHaveCreatedUpstream(category), durationMs: Date.now() - startedAt });
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
    let query = supabase.from("video_jobs").select(JOB_COLUMNS).order("created_at", { ascending: false }).limit(id ? 1 : 12);
    if (id) query = query.eq("id", id);
    const result = await query;
    if (result.error) throw result.error;

    const rows = (result.data ?? []) as Array<PollableJob & { kind: string; input_snapshot: unknown; updated_at: string; created_at: string }>;
    const config = await getVideoProviderConfig(user.id);
    const active = rows.filter((job) => isJobActive(job.status) && job.external_task_id);
    const due = config ? active.filter((job) => isDueForPoll(job.last_polled_at, job.poll_attempts)) : [];

    // 同一批只查询一次 Provider：只在到期时才发请求，其余任务直接返回当前状态。
    // completed / failed / never_accepted 不会进入 active，因此终态后一定停止轮询。
    const polled = new Map<string, Record<string, unknown>>();
    for (const job of due) {
      if (!config) break;
      const changes = await pollVideoJob(config, job);
      if (!changes) continue;
      const updated = await supabase.from("video_jobs").update(changes).eq("id", job.id).select(JOB_COLUMNS).single();
      if (updated.error) logVideoEvent("poll.persist_failed", { jobId: job.id, provider: job.provider, code: updated.error.code });
      else polled.set(job.id, updated.data);
    }

    const jobs = rows.map((job) => (polled.get(job.id) ?? job) as Record<string, unknown>);
    const jobIds = jobs.map((job) => String(job.id));
    const saved = jobIds.length ? await supabase.from("video_assets").select("id,video_job_id,storage_path,original_name,size_bytes").in("video_job_id", jobIds) : { data: [], error: null };
    if (saved.error) throw saved.error;
    // 「是否已入库」的单一真源：这条 Map。转存成功后往里面补，但绝不从别处推导，
    // 否则 saved 标记与播放地址会来自两个不同步的状态而互相矛盾。
    const assetsByJob = new Map((saved.data ?? []).map((item) => [item.video_job_id as string, item as PersistedVideoAsset]));
    const pendingByJob = new Map<string, string | null>();

    // completed 且尚未保存的任务，在这一轮刷新里转存一次，让「生成完成」之后
    // 即使没人点「保存到作品库」，视频也已经进了私有 bucket 并可以长期播放。
    // 已经入库的会被 needsPersistence 挡掉，因此重复刷新不会重复下载/上传。
    //
    // 每次刷新最多转存一条：转存是慢操作（下载 + 上传，最多 100MB），如果用户
    // 同时跑多个视频，逐条串行会把这次刷新的响应时间拖到几十秒。剩余任务会在
    // 后续轮询里依次处理，不会有任务被永久跳过。
    const completed = jobs.filter((job) => String(job.status) === "completed" && job.output_url);
    for (const job of completed.filter((item) => needsPersistence({ status: "completed", output_url: item.output_url as string }, assetsByJob.get(String(item.id)))).slice(0, 1)) {
      const id = String(job.id);
      const result = await autoPersistAndSign(supabase, user.id, id, null);
      if (result.saved && result.asset) assetsByJob.set(id, result.asset);
      pendingByJob.set(id, result.signedUrl);
    }

    // 已入库的任务统一在这里签名。地址不落库、每次刷新重新签，
    // 因此历史视频关闭浏览器再打开仍然可播。
    for (const [id, asset] of assetsByJob) {
      if (pendingByJob.has(id)) continue;
      const signedUrl = asset.storage_path ? await signVideoAsset(supabase, asset) : null;
      pendingByJob.set(id, signedUrl);
    }

    return Response.json({
      jobs: jobs.map((job) => {
        const id = String(job.id);
        const isSaved = assetsByJob.has(id);
        return {
          ...job,
          saved: isSaved,
          /**
           * 播放地址。
           *
           * 已入库时**只用** Storage 签名地址，签名失败就不给地址 —— 宁可让 UI
           * 不渲染 <video>，也不要退回一个 24 小时后必然失效的临时地址。
           *
           * 尚未入库时才回落到 Provider 的临时地址，那是转存补上之前的过渡态。
           * 转存失败（例如临时地址已过期）时 pendingByJob 里没有可用地址，
           * 此时同样不给地址，避免前端渲染一个永远播不了的黑洞。
           */
          playback_url: isSaved
            ? (pendingByJob.get(id) ?? null)
            : resolvePlaybackUrl(null, job.output_url as string | null),
        };
      }),
    });
  } catch (error) { return jsonError(error); }
}

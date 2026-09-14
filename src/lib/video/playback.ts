/**
 * 视频 Provider 的选择规则与已保存视频的播放地址收敛。
 *
 * 这个模块**刻意不引入任何运行期依赖**（不 import server-only、不 import Supabase、
 * 不 import provider 适配器），因此可以直接用 `node --test` 验证 —— 与 wan-mapping.ts
 * 同一套路。IO 留在 persist.ts / repository.ts 里。
 *
 * 背景：videos 表上 (user_id, category, provider) 唯一，但**同一个 category 可以有多条
 * enabled = true 的行**（图片文案各有一条；视频曾经同时启用 Seedance 与 Wan）。
 * 旧实现用 `.maybeSingle()` 查 category=enabled 的单行，多条命中时 PostgREST 返回
 * PGRST116、supabase-js 把它变成 error，readRow 直接 throw —— 于是「同时启用两个
 * 视频 Provider」会让创建、刷新、恢复、重新生成全部失败。
 *
 * 现在的规则：按明确的优先级取第一个可用的，永不因为「有多条」而报错。
 */

/**
 * 视频 Provider 优先级。测试阶段阿里云 Wan 优先，然后是豆包 Seedance 2.0，
 * 最后是保留但非默认的 Runway。
 *
 * 这里用的是 `providerName` / `config.provider` 的写法（`volcengine`），
 * 而不是 `video_jobs.provider` 那种展示用的「协议名」写法（`seedance`）——
 * 两者在 provider.ts 的 API 里是不同的概念，不要混用。
 */
export const VIDEO_PROVIDER_PRIORITY = ["alibaba", "volcengine", "runway"] as const;

export type VideoProviderName = (typeof VIDEO_PROVIDER_PRIORITY)[number];

export function isVideoProviderName(value: string): value is VideoProviderName {
  return (VIDEO_PROVIDER_PRIORITY as readonly string[]).includes(value);
}

/** 用于稳定排序的最小结构：只依赖 category / provider / enabled。 */
export type SelectableProviderConfig = { category: string; provider: string; enabled: boolean };

/**
 * 同一个 category 下可能有多条 enabled 行，按优先级挑出一条。
 *
 * 同一优先级不会重复（表上有 (user_id, category, provider) 唯一约束），
 * 因此同分时结果唯一；末尾的回退也只是为了「所有已知 Provider 都没启用，
 * 却启用了某个未来新增的 Provider」时仍然能工作，而不是返回 null。
 *
 * 返回 `null` 仅表示该 category 下没有任何启用的配置。
 */
export function pickProviderByPriority<T extends SelectableProviderConfig>(
  configs: T[],
  category: string,
): T | null {
  const candidates = configs.filter((config) => config.category === category && config.enabled);
  if (!candidates.length) return null;
  const rank = (config: T) => {
    const index = VIDEO_PROVIDER_PRIORITY.indexOf(config.provider as VideoProviderName);
    // 未知 Provider 排在所有已知项之后，回退到稳定排序（按 provider 名）保证确定性。
    return index === -1 ? VIDEO_PROVIDER_PRIORITY.length : index;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b) || a.provider.localeCompare(b.provider))[0];
}

/**
 * 已保存视频的播放地址优先级：Storage 的签名地址 > Provider 的临时地址。
 *
 * Wan 返回的 `output.video_url` 只有 24 小时有效期，刷新页面后仍要能播，
 * 就必须优先用 video_assets 里那条记录的签名地址。
 */
export function resolvePlaybackUrl(
  saved: { signedUrl?: string | null } | null | undefined,
  outputUrl: string | null | undefined,
): string | null {
  const signed = saved?.signedUrl?.trim();
  if (signed) return signed;
  const temporary = outputUrl?.trim();
  return temporary ? temporary : null;
}

/**
 * 任务是否算「已保存」。以 video_assets 里真的存在一条记录为准，
 * 而不是只看前端传来的 saved 标记 —— 刷新后 saved 标记来自数据库的重新计算。
 */
export function isPersistedAsset(asset: unknown) {
  return Boolean(asset && typeof asset === "object" && "storage_path" in asset);
}

/**
 * Postgres 唯一约束冲突。video_assets 上有 unique(video_job_id)，
 * 因此两个并发的保存（轮询自动保存与用户手动点击同时发生）必然有一个撞上它。
 * 撞上的那个必须被翻译成「已经保存过」，而不是报错 —— 这正是幂等的落点。
 */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(code: string | null | undefined) {
  return code === UNIQUE_VIOLATION;
}

/**
 * 这次刷新是否需要为某个任务执行转存。
 *
 * 只有「已完成、有临时地址、且还没有入库记录」才需要。已经入库的一律跳过，
 * 这是「重复 poll 不会重复上传」的核心判据 —— 它不依赖任何内存状态或时间窗口，
 * 只依赖数据库里那条 video_assets 记录，因此进程重启、多实例并发都成立。
 */
export function needsPersistence(
  job: { status: string; output_url?: string | null },
  savedAsset: unknown,
): boolean {
  return job.status === "completed" && Boolean(job.output_url) && !isPersistedAsset(savedAsset);
}

/**
 * 下载临时视频失败时，这个 HTTP 状态是否值得重试。
 *
 * 408 / 429 / 5xx 是瞬时故障；而 403 / 404 表示百炼的临时地址已经过期
 * （有效期 24 小时），重试只会白等 —— 那种情况必须重新生成，不能靠重试补救。
 */
export function isRetriableDownloadStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

/** 视频体积上限，与 video_assets.size_bytes 的 check 约束保持一致（100MB）。 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** 声明的 content-length 已经超限时，不必把响应读进内存。 */
export function isOversizedDeclaredLength(declaredBytes: number) {
  return declaredBytes > MAX_VIDEO_BYTES;
}

/** 实际读到的字节数是否可用。空响应或超限都直接放弃，不浪费一次上传。 */
export function isUsableVideoSize(byteLength: number) {
  return byteLength > 0 && byteLength <= MAX_VIDEO_BYTES;
}

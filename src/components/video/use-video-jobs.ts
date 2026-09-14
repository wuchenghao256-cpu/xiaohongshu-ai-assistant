"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  dedupeJobs,
  patchJob,
  shouldKeepPolling,
  type RecoverableJob,
  type UnknownJob,
  type VideoJob,
} from "@/components/video/job-state";

export type JobAction = "regenerate" | "recover" | "save" | "discard";

type ActionResponse = { job?: VideoJob; asset?: unknown; error?: string };

async function readJson(response: Response): Promise<ActionResponse> {
  return await response.json().catch(() => ({})) as ActionResponse;
}

/**
 * 视频任务的状态与轮询。所有网络失败都在这里收敛成 fetchError，绝不静默失败：
 * 之前的实现刷新失败时既不提示也不改状态，用户看到的是「卡住不动」。
 */
export function useVideoJobs() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  // 同一时刻只允许一个刷新在飞：多个定时器 + 手动刷新叠加会造成重复轮询。
  const inFlight = useRef(false);

  const refreshJobs = useCallback(async (options: { silent?: boolean } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!options.silent) setRefreshing(true);
    try {
      const response = await fetch("/api/video-jobs", { cache: "no-store" });
      if (!response.ok) throw new Error("视频任务刷新失败，请稍后重试");
      const data = await response.json() as { jobs?: VideoJob[] };
      setJobs((current) => dedupeJobs(data.jobs ?? [], current));
      setFetchError(null);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "视频任务刷新失败，请稍后重试");
    } finally {
      inFlight.current = false;
      if (!options.silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshJobs({ silent: true }), 0);
    return () => window.clearTimeout(timer);
  }, [refreshJobs]);

  useEffect(() => {
    if (!jobs.some(shouldKeepPolling)) return;
    // 服务端按 5/10/15/20-30 秒的节奏决定是否真正查询方舟，这里的定时只负责刷新页面状态。
    // 终态（completed / failed / never_accepted / 未知状态）不在 some() 里，因此轮询一定停止。
    const timer = window.setInterval(() => void refreshJobs({ silent: true }), 8000);
    return () => window.clearInterval(timer);
  }, [jobs, refreshJobs]);

  /** 提交一条指令。返回 false 表示这次调用没有成功，调用方应保留原状态。 */
  const act = useCallback(async (job: VideoJob, name: JobAction, body?: Record<string, unknown>) => {
    // 取消关闭：只清掉本地提示，不写数据库，也不能碰服务端状态。
    if (name === "discard" && body?.confirm === false) {
      setJobs((current) => current.map((item) => (item.id === job.id ? { ...item, recover: false } : item)));
      return true;
    }
    setActing(`${job.id}:${name}`);
    try {
      const response = await fetch(`/api/video-jobs/${job.id}/${name}`, {
        method: "POST",
        ...(body && name !== "discard" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const data = await readJson(response);
      if (!response.ok) {
        toast.error(data.error ?? "操作失败");
        return false;
      }
      // 服务端返回的就是权威状态，用它覆盖本地：已结束的任务必须立刻停止轮询。
      if ((name === "regenerate" || name === "recover") && data.job) {
        setJobs((current) => patchJob(current, data.job!, { recover: false }));
      }
      if (name === "discard") {
        // 服务端已确认这条记录不会再被轮询，直接移除；也避免再刷新一次列表。
        setJobs((current) => current.filter((item) => item.id !== job.id));
      }
      toast.success(
        name === "save" ? "已保存到作品库"
          : name === "regenerate" ? "已创建重新生成任务"
          : name === "recover" ? "任务已恢复，继续跟踪进度"
          : "已关闭该任务记录",
      );
      return true;
    } catch (error) {
      // 网络中断 / 响应不是 JSON 都不能改变本地状态：可能服务端已经处理成功。
      toast.error(error instanceof Error ? error.message : "操作失败，请稍后重试");
      return false;
    } finally {
      setActing(null);
    }
  }, [setJobs]);

  return { jobs, setJobs, refreshing, fetchError, acting, refreshJobs, act };
}

export type { RecoverableJob, UnknownJob, VideoJob };
export { dedupeJobs, patchJob, shouldKeepPolling };

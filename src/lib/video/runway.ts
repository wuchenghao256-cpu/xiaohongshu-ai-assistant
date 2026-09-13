import "server-only";
import { withExponentialRetry } from "@/lib/jobs/orchestrator";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import type { VideoJobInput } from "@/lib/video/types";

const API_VERSION = "2024-11-06";
class RunwayHttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function runwayFetch(config: ProviderRuntimeConfig, path: string, init?: RequestInit) {
  return withExponentialRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}${path}`, {
        ...init, signal: controller.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${config.apiKey}`, "X-Runway-Version": API_VERSION, "Content-Type": "application/json", ...init?.headers },
      });
      if (!response.ok) throw new RunwayHttpError(`Runway API 请求失败（HTTP ${response.status}）`, response.status);
      return await response.json() as Record<string, unknown>;
    } finally { clearTimeout(timer); }
  }, (error) => !(error instanceof RunwayHttpError) || error.status === 429 || error.status >= 500, { maxAttempts: 3, baseDelayMs: 600 });
}

function ratio(input: VideoJobInput) {
  if (input.kind === "product_ugc") return "720:1280";
  // Runway 只接受 720p/1080p 两种画幅，沿用原有的 1080p 判定。
  if (input.kind === "product_ad" && input.resolution !== "720p") return input.orientation === "portrait" ? "1080:1920" : "1920:1080";
  return input.orientation === "portrait" ? "720:1280" : "1280:720";
}

export async function createRunwayTask(config: ProviderRuntimeConfig, input: VideoJobInput, urls: string[]) {
  let path: string;
  let body: Record<string, unknown>;
  if (input.kind === "image_to_video") {
    path = "/image_to_video";
    body = { model: config.model, promptImage: urls[0], promptText: input.prompt, ratio: ratio(input), duration: input.duration };
  } else if (input.kind === "product_ad") {
    path = "/recipes/product_ad";
    body = { version: "2026-07", productImages: urls.map((uri) => ({ uri })), productInfo: input.productInfo || undefined,
      userConcept: `${input.concept || "Premium multi-shot product advertisement."}\nKeep the product Logo, colors, material, structure, hardware, packaging and key details consistent. Include a model overview, natural action, camera push-in, fabric or product detail shots, and a Logo or label close-up.`, duration: input.duration, ratio: ratio(input), audio: false };
  } else {
    path = "/recipes/product_ugc";
    body = { version: "2026-06", characterImage: { uri: urls[0] }, productImage: { uri: urls[1] }, productInfo: input.productInfo || undefined,
      userConcept: input.script, duration: input.duration, ratio: "720:1280", audio: true };
  }
  const payload = await runwayFetch(config, path, { method: "POST", body: JSON.stringify(body) });
  const id = typeof payload.id === "string" ? payload.id : undefined;
  if (!id) throw new Error("Runway 未返回 task id");
  return id;
}

export async function getRunwayTask(config: ProviderRuntimeConfig, id: string) {
  return runwayFetch(config, `/tasks/${encodeURIComponent(id)}`);
}

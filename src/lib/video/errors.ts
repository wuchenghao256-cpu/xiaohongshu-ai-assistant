// 相对路径 + 显式扩展名：项目测试脚本直接用 Node 运行，没有 @/ 别名解析。
import { SeedanceError } from "./seedance-mapping.ts";
import { WanError } from "./wan-mapping.ts";

/**
 * 错误文案收敛：只有 Provider 自己的错误已经是面向用户的中文说明。
 * 其余错误（Supabase Storage 签名失败、数据库写入失败、JSON 序列化异常等）
 * 一律替换为通用中文提示，绝不把原始错误暴露到 UI。
 * 原始错误只记录到服务端日志，且不包含 API Key 或请求内容。
 */
export function toUserMessage(error: unknown, fallback = "视频生成失败，请重试。") {
  if (error instanceof Error) {
    // 记录错误分类就够定位问题，不打印 message：message 可能带请求内容。
    const code = error instanceof SeedanceError || error instanceof WanError ? error.code : "unknown";
    console.error("Video task error", { name: error.name, code });
    if (error instanceof SeedanceError || error instanceof WanError) return error.message;
  }
  return fallback;
}

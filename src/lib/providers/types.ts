import { z } from "zod";

export const providerNames = ["seedream", "openai", "google", "custom", "runway", "volcengine", "alibaba"] as const;
export const providerCategories = ["text", "image", "video"] as const;
export type ProviderName = (typeof providerNames)[number];
export type ProviderCategory = (typeof providerCategories)[number];

/**
 * 阿里云百炼的华北2（北京）Endpoint 是按业务空间划分的专属域名，
 * 需要随视频配置一起保存，因此带上 workspaceId / region 两个可选字段。
 * 其它 Provider 不填这两项，行为完全不变。
 */
export const dashscopeRegions = ["cn-beijing"] as const;

export const providerConfigInputSchema = z.object({
  category: z.enum(providerCategories),
  provider: z.enum(providerNames),
  // 阿里云百炼不填 Base URL：它的地址由业务空间 ID 推导，服务端负责落库成具体域名。
  baseUrl: z.string().trim().url().max(500).refine((value) => value.startsWith("https://"), "API Base URL 必须使用 HTTPS").optional(),
  apiKey: z.string().trim().min(1).max(2000).optional(),
  model: z.string().trim().min(1).max(200),
  qualityModel: z.string().trim().min(1).max(200).optional(),
  // 只允许字符与连字符：这个值会拼进请求主机名，不能接受任意字符串。
  workspaceId: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i, "业务空间 ID 只能包含字母、数字与连字符").optional(),
  region: z.enum(dashscopeRegions).optional(),
  enabled: z.boolean().default(true),
}).refine((value) => value.provider === "alibaba" || Boolean(value.baseUrl), { message: "API Base URL 必须填写", path: ["baseUrl"] });

export type ProviderRuntimeConfig = {
  provider: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  qualityModel?: string;
  /** 仅阿里云百炼使用：业务空间 ID 与地域，用于拼出专属 Endpoint。 */
  workspaceId?: string;
  region?: string;
};

/**
 * 百炼密钥缺失时的哨兵值。
 *
 * 为什么不是一个空串：`ProviderRuntimeConfig.apiKey` 的类型是 string，用空串表达「未配置」
 * 时，任何 `Boolean(apiKey)` 式的就绪判断都会把它当成「已配置」，缺失会被静默吞掉。
 * 这个值本身不是密钥，因此**绝不能**被当成 Bearer 发出去或写进日志。
 * 它是「配置缺失」这件事在运行期的表示，不是凭据本身。
 */
export const MISSING_DASHSCOPE_API_KEY = "MISSING_DASHSCOPE_API_KEY";

export type SafeProviderConfig = Omit<ProviderRuntimeConfig, "apiKey"> & {
  id: string;
  category: ProviderCategory;
  enabled: boolean;
  hasApiKey: boolean;
};

import type { GeneratedVariants, PostVariant } from "@/lib/ai/types";

const emojiPattern = /\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3/gu;
const expectedAngles = ["真实体验 / 日常分享", "痛点 / 需求切入", "生活场景 / 穿搭种草"] as const;
const forbiddenConsumerPatterns = [
  /test\s*brand/i,
  /测试品牌/,
  /示例品牌/,
  /demo\s*brand/i,
  /\bunknown\b/i,
  /\bn\s*\/\s*a\b/i,
  /根据你提供的信息/,
  /等(?:我)?真正(?:拿到|摸到)/,
  /没有实际(?:使用|摸过)/,
  /没有摸过/,
  /从资料来看/,
  /从描述上看/,
  /我不能确定/,
  /如果实际使用/,
  /作为\s*AI/i,
] as const;

export type VariantQualityMetrics = {
  titleEmojiCount: number;
  bodyEmojiCount: number;
  paragraphCount: number;
  hashtagCount: number;
};

export type GenerationQualityReport = {
  passes: boolean;
  issues: string[];
  variants: VariantQualityMetrics[];
};

export function countEmoji(value: string) {
  return value.match(emojiPattern)?.length ?? 0;
}

export function countParagraphs(value: string) {
  return value
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .length;
}

function inspectVariant(variant: PostVariant, index: number) {
  const metrics: VariantQualityMetrics = {
    titleEmojiCount: countEmoji(variant.title),
    bodyEmojiCount: countEmoji(variant.body),
    paragraphCount: countParagraphs(variant.body),
    hashtagCount: variant.hashtags.length,
  };
  const issues: string[] = [];
  const label = `Variant ${index + 1}`;

  if (!variant.title.trim()) issues.push(`${label} 标题为空`);
  if (!variant.body.trim()) issues.push(`${label} 正文为空`);
  if (metrics.paragraphCount < 4 || metrics.paragraphCount > 7) {
    issues.push(`${label} 正文需要 4-7 个短段落，当前为 ${metrics.paragraphCount} 段`);
  }
  if (metrics.hashtagCount < 5 || metrics.hashtagCount > 10) {
    issues.push(`${label} hashtags 需要 5-10 个，当前为 ${metrics.hashtagCount} 个`);
  }
  if (variant.angle.trim() !== expectedAngles[index]) {
    issues.push(`${label} angle 应为“${expectedAngles[index]}”，当前为“${variant.angle.trim()}”`);
  }
  const consumerCopy = `${variant.title}\n${variant.body}\n${variant.hashtags.join(" ")}`;
  for (const pattern of forbiddenConsumerPatterns) {
    const match = consumerCopy.match(pattern)?.[0];
    if (match) issues.push(`${label} 消费者文案包含禁止表达“${match}”`);
  }

  return { metrics, issues };
}

export function inspectGenerationQuality(result: GeneratedVariants): GenerationQualityReport {
  const issues: string[] = [];
  if (result.variants.length !== 3) {
    issues.push(`需要正好 3 个 variants，当前为 ${result.variants.length} 个`);
  }
  const inspected = result.variants.map(inspectVariant);
  for (const variant of inspected) issues.push(...variant.issues);
  return { passes: issues.length === 0, issues, variants: inspected.map((variant) => variant.metrics) };
}

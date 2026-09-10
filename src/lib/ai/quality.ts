import type { GeneratedVariants, PostVariant } from "@/lib/ai/types";

const emojiPattern = /\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3/gu;

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
  if (metrics.titleEmojiCount < 1 || metrics.titleEmojiCount > 2) {
    issues.push(`${label} 标题需要 1-2 个 Emoji，当前为 ${metrics.titleEmojiCount} 个`);
  }
  if (metrics.bodyEmojiCount < 4 || metrics.bodyEmojiCount > 8) {
    issues.push(`${label} 正文需要 4-8 个 Emoji，当前为 ${metrics.bodyEmojiCount} 个`);
  }
  if (metrics.paragraphCount < 4 || metrics.paragraphCount > 7) {
    issues.push(`${label} 正文需要 4-7 个短段落，当前为 ${metrics.paragraphCount} 段`);
  }
  if (metrics.hashtagCount < 5 || metrics.hashtagCount > 10) {
    issues.push(`${label} hashtags 需要 5-10 个，当前为 ${metrics.hashtagCount} 个`);
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

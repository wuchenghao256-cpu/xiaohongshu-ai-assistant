import type { ImageScene } from "@/lib/image-ai/types";

const scenePrompts: Record<ImageScene, string> = {
  xiaohongshu: "自然、有生活感的小红书种草商品摄影，画面真实克制，留有适度呼吸感",
  "clean-product": "干净专业的产品摄影，背景简洁，主体清晰，光影自然",
  "daily-life": "可信的日常生活场景，商品自然融入环境，不做夸张陈列",
  "desktop-still-life": "桌面静物摄影，构图有层次，背景元素克制且不遮挡商品",
  custom: "严格遵循用户提供的场景描述",
};

export function buildProductImagePrompt(input: {
  productName: string;
  scene: ImageScene;
  sceneDescription: string;
  imageStyle: string;
  hasReference: boolean;
}) {
  const referenceRules = input.hasReference
    ? `参考图中是需要保留的真实商品主体。尽量保持原商品的颜色、材质、形状、比例、已有 Logo 与包装细节；不要擅自改变商品结构，不要增加不存在的产品功能、配件、文字或标识。只允许改变背景、场景、光线、构图与摄影风格。`
    : `只根据用户明确提供的信息呈现商品，不虚构品牌文字、Logo、功能、配件、认证或包装信息。`;

  return `为商品“${input.productName || "未命名商品"}”生成一张可用于小红书笔记的商品照片。

场景方向：${scenePrompts[input.scene]}
用户描述：${input.sceneDescription}
图片风格：${input.imageStyle}

${referenceRules}
画面中不要出现水印、价格、促销文字或无法确认的说明文字。商品主体必须清晰完整，视觉自然，适合手机端浏览。`;
}

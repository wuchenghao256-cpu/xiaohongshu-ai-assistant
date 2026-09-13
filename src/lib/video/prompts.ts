// 相对路径 + 显式扩展名：项目测试脚本直接用 Node 运行，没有 @/ 别名解析。
import { productCategoryLabels, type ProductCategory, type VideoJobInput } from "./types.ts";

/**
 * Seedance 2.0 的多模态参考模式支持在 prompt 中按 [图1][图2] 指代参考图。
 * 商品广告片与 AI UGC 依赖这一约定保持商品一致性，因此图片的排列顺序固定为：
 *   [图1] 商品正面/主体  [图2..n] 背面、Logo、材质、侧面、模特展示
 */
const IDENTITY_RULES = `商品身份必须保持一致：
- Logo
- 品牌文字
- 商品颜色
- 产品结构
- 材质
- 版型
- 包装
- 关键设计元素

可以变化：
- 模特动作
- 摄影场景
- 镜头运动
- 景别
- 灯光
- 商品展示角度`;

const REFERENCE_ROLES = `参考图说明：
[图1] 商品主体正面，作为商品身份的基准。
其余参考图依次提供背面、Logo、材质与侧面细节，仅用于校正商品细节，不得替换主体外观。`;

/** 各品类的多镜头节奏。结构一致，只有镜头内容不同，方便后续继续扩充品类。 */
const CATEGORY_SHOTS: Record<ProductCategory, string[]> = {
  fashion: [
    "模特整体展示商品，建立视觉主体，全身入镜。",
    "模特自然行走或转身，镜头从全身缓慢推进至商品主体。",
    "商品面料、做工、Logo 与局部细节特写。",
    "回到完整上身造型，形成广告收尾。",
  ],
  beauty: [
    "商品静置于干净台面，建立主体与包装形态。",
    "镜头缓慢环绕，展示瓶身比例、瓶盖与质感反光。",
    "商品质地、标签文字与 Logo 微距特写。",
    "回到完整包装陈列，形成广告收尾。",
  ],
  jewelry: [
    "商品静置展示，建立整体造型与轮廓。",
    "镜头缓慢环绕，展示金属光泽与宝石切面反光。",
    "镶嵌工艺、刻字与 Logo 微距特写。",
    "回到完整佩戴或陈列画面，形成广告收尾。",
  ],
  electronics: [
    "商品整体展示，建立机身形态与配色。",
    "镜头缓慢推进，展示屏幕点亮与机身线条。",
    "接口、按键、Logo 与材质细节特写。",
    "回到完整产品画面，形成广告收尾。",
  ],
  food: [
    "商品整体陈列，建立包装与主体形态。",
    "镜头缓慢推进，展示食物纹理与新鲜质感。",
    "包装标签、Logo 与内容物细节特写。",
    "回到完整商品画面，形成广告收尾。",
  ],
  home: [
    "商品置于真实家居场景，建立整体形态。",
    "镜头缓慢移动，展示使用状态与空间关系。",
    "材质纹理、工艺接缝与 Logo 细节特写。",
    "回到完整商品画面，形成广告收尾。",
  ],
  general: [
    "商品整体展示，建立视觉主体。",
    "镜头缓慢推进，展示商品结构与关键特征。",
    "材质、做工与 Logo 细节特写。",
    "回到完整商品画面，形成广告收尾。",
  ],
};

function timeline(category: ProductCategory, duration: number) {
  const shots = CATEGORY_SHOTS[category];
  const weights = [0.22, 0.33, 0.28, 0.17];
  let start = 0;
  return shots.map((shot, index) => {
    const length = index === shots.length - 1 ? Math.max(duration - start, 1) : Math.max(1, Math.round(duration * weights[index]));
    const end = Math.min(start + length, duration);
    const line = `${start}-${end}秒：\n${shot}`;
    start = end;
    return line;
  }).join("\n\n");
}

function productAdPrompt(input: Extract<VideoJobInput, { kind: "product_ad" }>) {
  const label = productCategoryLabels[input.productCategory];
  return [
    `生成一条完整的商业商品广告片（${label}品类），时长约 ${input.duration} 秒。`,
    IDENTITY_RULES,
    REFERENCE_ROLES,
    "镜头节奏：",
    timeline(input.productCategory, input.duration),
    input.productInfo ? `商品信息：${input.productInfo}` : "",
    input.concept ? `创意要求：${input.concept}` : "",
    "商业广告摄影，真实光影，画面稳定，不出现文字水印与变形。",
  ].filter(Boolean).join("\n\n");
}

function imageToVideoPrompt(input: Extract<VideoJobInput, { kind: "image_to_video" }>) {
  return [
    "参考 [图1] 中的商品，保持原有外观、颜色、材质、Logo 与文字完全不变。",
    input.prompt,
    "商业广告摄影，真实光影，镜头运动平稳，商品不得变形。",
  ].join("\n");
}

function ugcPrompt(input: Extract<VideoJobInput, { kind: "product_ugc" }>) {
  const label = productCategoryLabels[input.productCategory];
  return [
    `生成一段竖屏真人商品介绍视频（${label}品类），时长约 ${input.duration} 秒。`,
    "人物形象严格参考 [图1]，商品严格参考 [图2]，不得替换人物外观或商品外观。",
    IDENTITY_RULES,
    "人物自然面对镜头口播，语速自然，口型与台词一致，画面为真实生活场景。",
    input.script ? `台词：${input.script}` : "",
    input.productInfo ? `商品信息：${input.productInfo}` : "",
  ].filter(Boolean).join("\n\n");
}

/** 三个入口共用 Seedance 2.0，差异只来自输入素材与这里的 Prompt 编排。 */
export function buildVideoPrompt(input: VideoJobInput) {
  if (input.kind === "product_ad") return productAdPrompt(input);
  if (input.kind === "product_ugc") return ugcPrompt(input);
  return imageToVideoPrompt(input);
}

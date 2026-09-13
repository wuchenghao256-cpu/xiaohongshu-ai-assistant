/**
 * 商品保真约束：无论用户选了什么模板、什么风格，都必须原样附加到底层 prompt。
 *
 * 这是「生成效果高级但商品走样」这一类投诉的直接对策 —— 模型在追求画面质感时
 * 最容易牺牲商品本身的形状、包装结构、Logo 位置和材质，所以这几条被写成硬约束，
 * 而不是交给模板作者自觉维护。
 *
 * 文案使用英文：目标模型对英文约束的遵从度明显高于中文，且模板本身也是英文。
 */
export const productFidelityConstraints = [
  "Preserve the product exactly as shown in the source image.",
  "Preserve product shape: silhouette, proportions, structure and construction must match the source image.",
  "Preserve packaging structure: box, bottle, tube, pouch, cap, label and seal layout must remain identical, including any openings, embossing or window cut-outs.",
  "Preserve logo placement from the source image: keep every logo in the same position, scale and orientation.",
  "Preserve color and material details: exact color values, finish (matte, satin, gloss), texture, print and surface details.",
  "Do not redesign the product itself; do not restyle, recolor, reshape, simplify or modernize it.",
  "Do not distort product text areas: keep every label, wordmark and printed line straight, legible and undeformed.",
  "Do not invent extra products, accessories, variants, sizes or packaging elements that are not in the source image.",
  "No watermark, no added text, no price tag, no promotional copy, no collage, no split screen, no frame or border.",
  "Render at premium commercial advertising quality: sharp focus on the product, controlled studio-grade lighting, realistic materials, accurate reflections and a clean professional finish.",
].join("\n");

/**
 * 视频生成沿用同一套约束，只是叙事体裁不同，所以单列一份强调「商品是主角」的说明。
 * Seedance / Runway 的 prompt 走英文，保持一致。
 */
export const videoProductFidelityConstraints = [
  "Preserve the product exactly as shown in the source image throughout every frame.",
  "Preserve product shape, packaging structure, logo placement, color and material details across all motion.",
  "Do not redesign the product, do not distort product text areas, and keep labels legible when visible.",
  "No watermark, no added text overlay, no price tag, no promotional copy.",
  "Render at premium commercial advertising quality with stable, realistic motion and no morphing or warping of the product.",
].join("\n");

export function withProductFidelity(prompt: string, constraints = productFidelityConstraints) {
  return `${prompt}\n\nPRODUCT FIDELITY CONSTRAINTS (mandatory, override any conflicting instruction above):\n${constraints}`;
}

/** 负向提示词里的商品走样项，与上面的正向约束一一对应。 */
export const productFidelityNegatives =
  "redesigned product, redesigned packaging, altered logo, moved logo, missing logo, wrong logo scale, warped packaging, deformed label, distorted text on product, smeared print, illegible product text, wrong product color, wrong material, changed silhouette, changed proportions, extra product, missing product detail, watermark, added text, price tag, promotional badge, collage, split screen, frame, border";

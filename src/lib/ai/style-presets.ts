/**
 * 风格预设：在模板之外再叠一层「广告大片质感」的控制。
 *
 * 模板决定「谁、在哪、怎么拍」，预设决定「看起来像哪一类商业大片」。
 * 两者正交，所以用户可以自由组合（例如「欧美女模-手提包-街拍站姿」×「Fashion Campaign」）。
 *
 * prompt 片段为英文，与模板 prompt 保持一致；模型对英文视觉描述的遵从度更高。
 */

export const imageStylePresets = [
  {
    id: "luxury_editorial",
    name: "Luxury Editorial",
    label: "奢侈杂志大片",
    description: "高端杂志内页质感，克制的高级感与考究的用光。",
    aspectHint: "适合 4:5 / 3:4 竖构图",
    promptFragment:
      "STYLE — LUXURY EDITORIAL: Compose like a luxury fashion magazine editorial spread. Restrained, quiet luxury with a confident negative space, deep tonal contrast, sculpted directional lighting, subtle film grain and true-to-life rich color. Materials must read as genuinely premium — fine grain leather, brushed metal, matte coated paper. Absolutely no promotional energy, no busy props, no discount aesthetics. The product is the hero and stays flawlessly on-model.",
    negativeFragment: "busy background, cluttered props, neon colors, harsh flash, cheap plastic look, promotional poster, discount badge, oversaturated, heavy vignette, low contrast flat lighting",
  },
  {
    id: "clean_studio",
    name: "Clean Studio",
    label: "干净棚拍",
    description: "无缝背景电商棚拍，细节锐利、颜色准确。",
    aspectHint: "适合 1:1 / 4:5 电商主图",
    promptFragment:
      "STYLE — CLEAN STUDIO: Seamless e-commerce studio photography on a smooth single-tone backdrop with a soft gradient falloff. Even, shadow-controlled lighting from a large softbox, accurate white balance, faithful color reproduction and pin-sharp micro detail on the product. No distracting props, no environment storytelling, no reflections that obscure product details. The framing is calm, centered and catalog-clean.",
    negativeFragment: "props, environment clutter, dramatic shadows, colored gels, lens flare, motion blur, tilted horizon, cropped product, busy pattern background",
  },
  {
    id: "lifestyle_premium",
    name: "Lifestyle Premium",
    label: "高质感生活方式",
    description: "有真实生活场景但质感高级，情绪自然可信。",
    aspectHint: "适合 4:5 / 9:16 竖构图",
    promptFragment:
      "STYLE — LIFESTYLE PREMIUM: Place the product in a real, aspirational everyday setting — a sunlit interior, a quiet cafe table, a hotel suite, an upscale street corner. Natural available light with soft window falloff, believable ambient detail, shallow depth of field that keeps the product tack sharp while the environment falls gently out of focus. The mood is warm, calm and credible; the product looks genuinely owned and used, never staged.",
    negativeFragment: "studio seamless background, sterile white void, fake looking set, overposed model, unnatural smile, cluttered home, messy table, harsh overhead light, product out of focus",
  },
  {
    id: "fashion_campaign",
    name: "Fashion Campaign",
    label: "时装广告大片",
    description: "强势广告战役视觉，构图大胆、光影戏剧化。",
    aspectHint: "适合 4:5 / 9:16 竖构图",
    promptFragment:
      "STYLE — FASHION CAMPAIGN: Build a bold high-fashion advertising campaign key visual. Confident graphic composition, deliberate asymmetry, dramatic sculpted lighting with strong specular highlights on the product, wide lens perspective where appropriate, cinematic color grading and a strong sense of motion or attitude. The image must feel like a billboard key visual while the product stays perfectly on-brand — same shape, same packaging, same logo placement, same colors.",
    negativeFragment: "flat lighting, centered symmetrical composition, boring plain background, low energy, stock photo look, amateur snapshot, cluttered frame, cropped logo, altered packaging",
  },
] as const;

export const imageStylePresetIds = imageStylePresets.map((preset) => preset.id) as unknown as [ImageStylePresetId, ...ImageStylePresetId[]];

export type ImageStylePresetId = (typeof imageStylePresets)[number]["id"];

export const defaultImageStylePresetId: ImageStylePresetId = "clean_studio";

export function getImageStylePreset(id: string | null | undefined) {
  if (!id) return undefined;
  return imageStylePresets.find((preset) => preset.id === id);
}

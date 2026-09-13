import "server-only";
import type {
  ModelGender,
  ModelGenerationMode,
  CreativeVariationLevel,
  ModelImageTemplate,
  ModelProductCategory,
  ModelProductFocus,
  ModelStyle,
} from "@/lib/ai/image-template-config";

const categoryInstructions: Record<ModelProductCategory, string> = {
  bag: "Treat the uploaded bag as the primary product reference. Show exactly one matching bag, naturally carried by the model.",
  shoes: "Treat the uploaded shoes as the primary product reference. Show one matching pair worn naturally by the model.",
  clothing: "Treat the uploaded clothing as the primary product reference. The model must wear exactly one matching garment. Keep its complete silhouette, fit, cut, color, fabric appearance, and distinctive details visible and unobstructed, with realistic body and garment proportions.",
  pants: "Treat the uploaded pants as the primary product reference. The model must wear exactly one matching pair. Keep the pants visible from waistband to hem, preserve their fit, cut, length, color, fabric appearance, and details, and maintain realistic waist, hip, leg, and body proportions.",
};

const genderInstructions: Record<ModelGender, string> = {
  female: "Use a natural, contemporary Western female fashion model.",
  male: "Use a natural, contemporary Western male fashion model.",
};

const styleInstructions: Record<ModelStyle, string> = {
  luxury: "Use a refined high-end luxury fashion treatment.",
  street: "Use a clean contemporary street-fashion treatment.",
  minimalist: "Use a restrained minimalist fashion treatment.",
  lifestyle: "Use a polished premium lifestyle treatment.",
};

const focusInstructions: Record<ModelProductFocus, string> = {
  product: "Prioritize product visibility: the product must be unobstructed, sharply focused, and visually dominant.",
  balanced: "Balance the model and product while keeping the product clear, unobstructed, and easy to identify.",
};

const generationModeInstructions: Record<ModelGenerationMode, string> = {
  precise_edit: "PRECISE EDIT MODE: Product accuracy is the first priority. Use minimal creative freedom, a clean background, straightforward styling, and a simple stable pose. Keep the source composition and presentation close unless the template explicitly requires a change. Do not redesign, restyle, crop away, conceal, or reinterpret the product.",
  creative_ad: "CREATIVE AD MODE: Lock only the product identity: exact structure, silhouette and fit, colors, material appearance, Logo, readable product text, hardware, packaging, construction and distinctive details. Deliberately create a visibly different advertisement. The person, action, pose, background, lighting, camera angle, camera distance, composition, scene and advertising style may change substantially. Do not copy the reference framing, pose, background or camera viewpoint. Product identity must remain accurate and clearly recognizable.",
};

const variationInstructions: Record<CreativeVariationLevel, string> = {
  low: "CREATIVE VARIATION LOW: Change at least the background, lighting and camera angle while keeping a restrained commercial treatment.",
  medium: "CREATIVE VARIATION MEDIUM: Use a clearly different person pose or action, scene, camera angle, shooting distance, lighting and composition; create a new campaign image rather than a near-copy.",
  high: "CREATIVE VARIATION HIGH: Make a bold campaign reinterpretation with a substantially different setting, dynamic action, dramatic lighting, lens perspective, distance and composition while preserving every locked product identity detail.",
};

const clothingFramingInstructions: Record<ModelProductCategory, string> = {
  bag: "Keep the bag fully visible and naturally supported by the model.",
  shoes: "Keep the complete matching pair visible and naturally worn by the model.",
  clothing: "For tops and garments, use half-body or full-body framing according to the template. Preserve the overall silhouette, neckline shape, sleeve length, hem length, fit and looseness, print or graphic placement, main front design position, dominant colors, and product identity as closely as possible.",
  pants: "Prefer full-body or lower-body-emphasis framing. Show the pants continuously from waistband to hem and preserve the silhouette, rise, fit and looseness, length, leg shape, print placement, dominant colors, and product identity as closely as possible.",
};

export type ModelImagePromptInput = {
  template: ModelImageTemplate;
  productName: string;
  productCategory: ModelProductCategory;
  gender: ModelGender;
  style: ModelStyle;
  productFocus: ModelProductFocus;
  generationMode: ModelGenerationMode;
  creativeVariation: CreativeVariationLevel;
  referenceCount: number;
};

export type ModelImagePrompt = {
  positivePrompt: string;
  negativePrompt: string;
};

export function buildModelImagePrompt(input: ModelImagePromptInput): ModelImagePrompt {
  const referenceInstruction = input.referenceCount > 0
    ? `Use all ${input.referenceCount} uploaded reference images together. The first image is the Primary Reference (Front); subsequent images provide Back, Detail, and Logo or Print Detail context in that order when present. Reconcile them into one consistent product. Preserve visible shape, color, proportions, material appearance, construction, logos, prints, and existing product details as closely as possible. Do not invent extra products, accessories, branding, or unobserved features.`
    : "Do not invent branding, logos, product text, accessories, certifications, or unobserved product features.";

  return {
    positivePrompt: [
      input.template.promptTemplate,
      `Product: ${input.productName || "unnamed product"}.`,
      categoryInstructions[input.productCategory],
      genderInstructions[input.gender],
      styleInstructions[input.style],
      focusInstructions[input.productFocus],
      generationModeInstructions[input.generationMode],
      input.generationMode === "creative_ad" ? variationInstructions[input.creativeVariation] : "",
      clothingFramingInstructions[input.productCategory],
      referenceInstruction,
      `Composition settings: ${input.template.framing.replaceAll("_", " ")} framing, ${input.template.pose.replaceAll("_", " ")} pose, ${input.template.scene.replaceAll("_", " ")} scene.`,
      "Use realistic lighting, polished styling, a premium fashion editorial aesthetic, and a luxury fashion-forward composition suitable for social media and e-commerce. Keep the product stable, visually important, and clearly identifiable. No watermark, text overlay, collage, split screen, frame, border, deformed hands, malformed limbs, duplicated garment, distorted print, floating product, low resolution, or messy background.",
    ].join("\n"),
    negativePrompt: input.template.negativePromptTemplate,
  };
}

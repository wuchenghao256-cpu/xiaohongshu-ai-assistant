import "server-only";
import type {
  ModelGender,
  ModelImageTemplate,
  ModelProductCategory,
  ModelProductFocus,
  ModelStyle,
} from "@/lib/ai/image-template-config";

const categoryInstructions: Record<ModelProductCategory, string> = {
  bag: "Treat the uploaded bag as the primary product reference. Show exactly one matching bag, naturally carried by the model.",
  shoes: "Treat the uploaded shoes as the primary product reference. Show one matching pair worn naturally by the model.",
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

export type ModelImagePromptInput = {
  template: ModelImageTemplate;
  productName: string;
  productCategory: ModelProductCategory;
  gender: ModelGender;
  style: ModelStyle;
  productFocus: ModelProductFocus;
  hasReference: boolean;
};

export type ModelImagePrompt = {
  positivePrompt: string;
  negativePrompt: string;
};

export function buildModelImagePrompt(input: ModelImagePromptInput): ModelImagePrompt {
  const referenceInstruction = input.hasReference
    ? "The first uploaded image is the primary product reference. Preserve its visible shape, color, proportions, material appearance, and existing product details as closely as the model allows. Do not invent extra products, accessories, branding, or unobserved features."
    : "Do not invent branding, logos, product text, accessories, certifications, or unobserved product features.";

  return {
    positivePrompt: [
      input.template.promptTemplate,
      `Product: ${input.productName || "unnamed product"}.`,
      categoryInstructions[input.productCategory],
      genderInstructions[input.gender],
      styleInstructions[input.style],
      focusInstructions[input.productFocus],
      referenceInstruction,
      `Composition settings: ${input.template.framing.replaceAll("_", " ")} framing, ${input.template.pose.replaceAll("_", " ")} pose, ${input.template.scene.replaceAll("_", " ")} scene.`,
      "Create one realistic, high-resolution, premium e-commerce image suitable for social media. Do not add a watermark, text overlay, border, collage, or split screen.",
    ].join("\n"),
    negativePrompt: input.template.negativePromptTemplate,
  };
}

export const modelProductCategories = ["bag", "shoes"] as const;
export const modelGenders = ["female", "male"] as const;
export const modelStyles = ["luxury", "street", "minimalist", "lifestyle"] as const;
export const modelFramings = ["full_body", "half_body", "close_up", "product_focus"] as const;
export const modelPoses = ["hand_carry", "shoulder_carry", "walking", "sitting", "wearing"] as const;
export const modelScenes = ["studio", "street", "cafe", "indoor_minimal"] as const;
export const modelImageAspectRatios = ["4:5", "3:4", "1:1", "9:16"] as const;
export const modelProductFocusOptions = ["product", "balanced"] as const;

export type ModelProductCategory = (typeof modelProductCategories)[number];
export type ModelGender = (typeof modelGenders)[number];
export type ModelStyle = (typeof modelStyles)[number];
export type ModelFraming = (typeof modelFramings)[number];
export type ModelPose = (typeof modelPoses)[number];
export type ModelScene = (typeof modelScenes)[number];
export type ModelImageAspectRatio = (typeof modelImageAspectRatios)[number];
export type ModelProductFocus = (typeof modelProductFocusOptions)[number];

export type ModelImageTemplate = {
  id: string;
  name: string;
  productCategory: ModelProductCategory;
  gender: ModelGender;
  style: ModelStyle;
  framing: ModelFraming;
  pose: ModelPose;
  scene: ModelScene;
  aspectRatio: ModelImageAspectRatio;
  shotsCountDefault: 1 | 2 | 4;
  promptTemplate: string;
  negativePromptTemplate: string;
  isDefault: boolean;
};

export const defaultNegativePrompt = "watermark, text, logo overlay, collage, split screen, extra limbs, extra fingers, malformed hands, duplicated product, multiple bags, duplicated shoes, blurry product, low resolution, distorted proportions, messy background, cartoon, illustration, frame, border";

export const modelImageTemplates: readonly ModelImageTemplate[] = [
  {
    id: "female-bag-street",
    name: "欧美女模-手提包-街拍站姿",
    productCategory: "bag",
    gender: "female",
    style: "street",
    framing: "full_body",
    pose: "hand_carry",
    scene: "street",
    aspectRatio: "4:5",
    shotsCountDefault: 4,
    promptTemplate: "Create a high-end fashion product photo featuring a stylish Western female model in a modern street-style setting. She is naturally carrying or wearing the provided bag product. The bag must remain the visual focus and closely match the uploaded reference product in shape, color, and overall appearance. Show a clean, premium composition with realistic lighting, polished fashion editorial aesthetics, and social-media-ready quality. The model should look natural, elegant, and contemporary. No watermark, no overlaid text, no collage.",
    negativePromptTemplate: defaultNegativePrompt,
    isDefault: true,
  },
  {
    id: "female-bag-indoor-luxury",
    name: "欧美女模-单肩包-室内轻奢",
    productCategory: "bag",
    gender: "female",
    style: "luxury",
    framing: "half_body",
    pose: "shoulder_carry",
    scene: "indoor_minimal",
    aspectRatio: "4:5",
    shotsCountDefault: 4,
    promptTemplate: "Create a premium lifestyle image featuring a Western female model in an elegant indoor setting, naturally posing with the provided bag product. The product should be clearly visible and integrated realistically with the model. Emphasize a luxury, refined, clean aesthetic suitable for fashion e-commerce and social content. Keep the composition polished, realistic, and high quality. No watermark, no text, no collage.",
    negativePromptTemplate: defaultNegativePrompt,
    isDefault: false,
  },
  {
    id: "female-bag-product-focus",
    name: "欧美女模-抱包特写-商品突出",
    productCategory: "bag",
    gender: "female",
    style: "luxury",
    framing: "product_focus",
    pose: "hand_carry",
    scene: "studio",
    aspectRatio: "4:5",
    shotsCountDefault: 4,
    promptTemplate: "Create a premium close-up fashion product image featuring a Western female model naturally holding the provided bag. Keep the bag as the unmistakable visual focus, fully visible and realistically integrated with the pose. Use refined studio lighting, a clean composition, and polished fashion e-commerce quality. No watermark, no text, no collage.",
    negativePromptTemplate: defaultNegativePrompt,
    isDefault: false,
  },
  {
    id: "female-shoes-standing",
    name: "欧美女模-穿鞋站姿",
    productCategory: "shoes",
    gender: "female",
    style: "luxury",
    framing: "full_body",
    pose: "wearing",
    scene: "studio",
    aspectRatio: "4:5",
    shotsCountDefault: 4,
    promptTemplate: "Create a fashion-forward product image featuring a Western female model wearing the provided shoes. Ensure the shoes are clearly visible and remain a key visual focus. Use a clean, premium fashion aesthetic with realistic lighting and a polished social-media-ready result. The model should appear natural, stylish, and proportionally correct. No watermark, no text, no collage.",
    negativePromptTemplate: defaultNegativePrompt,
    isDefault: false,
  },
  {
    id: "male-shoes-street",
    name: "欧美男模-穿鞋行走",
    productCategory: "shoes",
    gender: "male",
    style: "street",
    framing: "full_body",
    pose: "walking",
    scene: "street",
    aspectRatio: "4:5",
    shotsCountDefault: 4,
    promptTemplate: "Create a stylish product image featuring a Western male model wearing the provided shoes in a clean street-fashion scene. Keep the shoes clearly visible and visually important. Use realistic lighting, a modern editorial look, and a premium e-commerce quality finish. No watermark, no text, no collage.",
    negativePromptTemplate: defaultNegativePrompt,
    isDefault: false,
  },
  {
    id: "male-bag-minimal",
    name: "欧美男模-提包/背包-极简风",
    productCategory: "bag",
    gender: "male",
    style: "minimalist",
    framing: "full_body",
    pose: "shoulder_carry",
    scene: "indoor_minimal",
    aspectRatio: "4:5",
    shotsCountDefault: 4,
    promptTemplate: "Create a high-end fashion image featuring a Western male model naturally carrying or wearing the provided bag. Use a minimal, refined background and emphasize a luxury contemporary aesthetic. The bag should closely reflect the uploaded product and remain visually clear. No watermark, no text, no collage.",
    negativePromptTemplate: defaultNegativePrompt,
    isDefault: false,
  },
] as const;

export function getModelImageTemplate(templateId: string) {
  return modelImageTemplates.find((template) => template.id === templateId);
}

export const modelProductCategoryLabels: Record<ModelProductCategory, string> = { bag: "包", shoes: "鞋" };
export const modelGenderLabels: Record<ModelGender, string> = { female: "女", male: "男" };
export const modelStyleLabels: Record<ModelStyle, string> = {
  luxury: "高端轻奢",
  street: "街拍",
  minimalist: "极简",
  lifestyle: "生活方式",
};
export const modelProductFocusLabels: Record<ModelProductFocus, string> = {
  product: "商品优先",
  balanced: "模特与商品平衡",
};

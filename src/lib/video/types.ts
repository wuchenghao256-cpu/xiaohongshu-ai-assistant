import { z } from "zod";

const base = z.object({
  inputPaths: z.array(z.string().min(1).max(500)).min(1).max(10),
  duration: z.number().int().min(4).max(15),
  orientation: z.enum(["landscape", "portrait"]),
});

export const videoJobInputSchema = z.discriminatedUnion("kind", [
  base.extend({
    kind: z.literal("image_to_video"), inputPaths: z.array(z.string()).length(1),
    prompt: z.string().trim().min(3).max(1000), duration: z.union([z.literal(5), z.literal(10)]),
    modelTier: z.enum(["fast", "quality"]),
  }),
  base.extend({
    kind: z.literal("product_ad"), productInfo: z.string().trim().max(2500),
    concept: z.string().trim().max(3500), resolution: z.enum(["720p", "1080p"]),
  }),
  z.object({
    kind: z.literal("product_ugc"), inputPaths: z.array(z.string()).length(2),
    productInfo: z.string().trim().max(2500), script: z.string().trim().min(3).max(3500),
    duration: z.number().int().min(4).max(15), orientation: z.literal("portrait"),
  }),
]);

export type VideoJobInput = z.infer<typeof videoJobInputSchema>;

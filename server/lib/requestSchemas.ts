import { z } from "zod";

export const videoTaskRequestSchema = z.object({
  mode: z.enum(["text", "asset"]).default("asset"),
  prompt: z.string().min(1),
  assetIds: z.array(z.string()).default([])
}).superRefine((value, context) => {
  if (value.mode === "asset" && value.assetIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["assetIds"],
      message: "素材参考生成至少需要选择一个 Active 素材"
    });
  }
});

export type VideoTaskRequest = z.infer<typeof videoTaskRequestSchema>;

export function parseVideoTaskRequest(input: unknown): VideoTaskRequest {
  return videoTaskRequestSchema.parse(input);
}

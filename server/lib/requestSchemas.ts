import { z } from "zod";
import { videoModelVersions, videoRatios, videoResolutions } from "./payloads.js";

export const videoTaskRequestSchema = z.object({
  projectId: z.string().optional(),
  mode: z.enum(["text", "multimodal", "frames"]).default("multimodal"),
  referenceTransport: z.enum(["asset", "url"]).default("url"),
  prompt: z.string().min(1),
  modelVersion: z.enum(videoModelVersions).default("doubao-seedance-2-0-fast-260128"),
  ratio: z.enum(videoRatios).default("16:9"),
  duration: z.number().int().min(4).max(15).default(5),
  resolution: z.enum(videoResolutions).default("720p"),
  references: z.array(z.object({
    role: z.enum(["reference", "first_frame", "last_frame"]),
    sourceUrl: z.string().url().optional(),
    previewUrl: z.string().url().optional(),
    localPath: z.string().optional(),
    localUrl: z.string().optional(),
    assetId: z.string().optional(),
    assetType: z.enum(["Image", "Video", "Audio"]).default("Image"),
    label: z.string().optional()
  })).default([])
}).superRefine((value, context) => {
  if (value.modelVersion === "doubao-seedance-2-0-fast-260128" && value.resolution === "1080p") {
    context.addIssue({
      code: "custom",
      path: ["resolution"],
      message: "Seedance 2.0 Fast 不支持 1080p"
    });
  }
  if (value.mode === "multimodal" && value.references.length > 9) {
    context.addIssue({
      code: "custom",
      path: ["references"],
      message: "全能参考最多支持 9 张图片"
    });
  }
  if (value.mode === "frames") {
    const hasFirst = value.references.some((reference) => reference.role === "first_frame");
    const hasLast = value.references.some((reference) => reference.role === "last_frame");
    if (!hasFirst || !hasLast) {
      context.addIssue({
        code: "custom",
        path: ["references"],
        message: "首尾帧模式需要上传首帧和尾帧"
      });
    }
  }
  for (const [index, reference] of value.references.entries()) {
    if (!reference.assetId && !reference.sourceUrl) {
      context.addIssue({
        code: "custom",
        path: ["references", index],
        message: "参考图片缺少 URL 或 Asset ID"
      });
    }
  }
});

export type VideoTaskRequest = z.infer<typeof videoTaskRequestSchema>;

export function parseVideoTaskRequest(input: unknown): VideoTaskRequest {
  return videoTaskRequestSchema.parse(input);
}

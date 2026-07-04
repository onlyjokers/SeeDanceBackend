import { z } from "zod";
import { imageModelVersions, imageQualities, imageRatios, imageResolutions, imageSizeOptionForSize, resolveImageSize, videoModelVersions, videoRatios, videoResolutions } from "./payloads.js";
import type { ImageSize } from "./payloads.js";

const previewUrlSchema = z.string().refine((value) => {
  if (value.startsWith("/api/uploads/local/")) return true;
  return z.string().url().safeParse(value).success;
}, "Invalid preview URL");

const referenceSchema = z.object({
  role: z.enum(["reference", "first_frame", "last_frame"]),
  sourceUrl: z.string().url().optional(),
  previewUrl: previewUrlSchema.optional(),
  localPath: z.string().optional(),
  localUrl: previewUrlSchema.optional(),
  assetId: z.string().optional(),
  assetType: z.enum(["Image", "Video", "Audio"]).default("Image"),
  label: z.string().optional()
});

const imageSizeSchema = z.custom<ImageSize>((value) => typeof value === "string" && /^\d+x\d+$/.test(value), "Invalid image size");

export const videoTaskRequestSchema = z.object({
  projectId: z.string().optional(),
  mediaType: z.literal("video").default("video"),
  mode: z.enum(["text", "multimodal", "frames"]).default("multimodal"),
  referenceTransport: z.enum(["asset", "url"]).default("url"),
  prompt: z.string().min(1),
  modelVersion: z.enum(videoModelVersions).default("doubao-seedance-2-0-fast-260128"),
  ratio: z.enum(videoRatios).default("16:9"),
  duration: z.number().int().min(4).max(15).default(5),
  resolution: z.enum(videoResolutions).default("720p"),
  references: z.array(referenceSchema).default([])
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

const imageTaskRequestBaseSchema = z.object({
  projectId: z.string().optional(),
  mediaType: z.literal("image").default("image"),
  referenceTransport: z.enum(["asset", "url"]).default("url"),
  prompt: z.string().min(1),
  imageModel: z.enum(imageModelVersions).default("gpt-image-2"),
  ratio: z.enum(imageRatios).optional(),
  imageResolution: z.enum(imageResolutions).optional(),
  imageQuality: z.enum(imageQualities).default("auto"),
  size: imageSizeSchema.optional(),
  references: z.array(referenceSchema.extend({ role: z.literal("reference").default("reference") })).default([])
});

export const imageTaskRequestSchema = imageTaskRequestBaseSchema.transform((value) => {
  const legacySizeOption = imageSizeOptionForSize(value.size);
  return {
    ...value,
    ratio: value.ratio ?? legacySizeOption?.ratio ?? "1:1",
    imageResolution: value.imageResolution ?? legacySizeOption?.resolution ?? "1k"
  };
}).superRefine((value, context) => {
  const resolvedSize = resolveImageSize(value.ratio, value.imageResolution);
  if (value.size && resolvedSize !== value.size) {
    context.addIssue({
      code: "custom",
      path: ["size"],
      message: "size 与图片比例/分辨率不匹配"
    });
  }
  if (value.references.length > 9) {
    context.addIssue({
      code: "custom",
      path: ["references"],
      message: "图片生成最多支持 9 张参考图"
    });
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

export type ImageTaskRequest = z.infer<typeof imageTaskRequestSchema>;

export function parseImageTaskRequest(input: unknown): ImageTaskRequest {
  return imageTaskRequestSchema.parse(input);
}

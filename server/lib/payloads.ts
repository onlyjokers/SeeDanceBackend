export type AssetType = "Image" | "Video" | "Audio";
export type MediaType = "video" | "image";
export type TaskKind = "video_generation" | "image_generation" | "video_upscale";
export type VideoMode = "text" | "multimodal" | "frames";
export type ReferenceTransport = "asset" | "url";
export type VideoModelVersion = "doubao-seedance-2-0-fast-260128" | "doubao-seedance-2-0-260128";
export type VideoRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type VideoResolution = "480p" | "720p" | "1080p";
export type ImageModelVersion = "gpt-image-2" | "gpt-image-2-pro";
export type ImageRatio = "2:1" | "16:9" | "3:2" | "1:1" | "2:3" | "9:16";
export type GenerationRatio = VideoRatio | ImageRatio;
export type ImageResolution = "1k" | "2k";
export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageSize = `${number}x${number}`;
export type VideoReferenceRole = "reference" | "first_frame" | "last_frame";

export const videoModelVersions: VideoModelVersion[] = [
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-260128"
];

export const videoRatios: VideoRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const videoDurations = Array.from({ length: 12 }, (_, index) => index + 4);
export const videoResolutions: VideoResolution[] = ["480p", "720p", "1080p"];
export const imageModelVersions: ImageModelVersion[] = ["gpt-image-2", "gpt-image-2-pro"];
export const imageRatios: ImageRatio[] = ["2:1", "16:9", "3:2", "1:1", "2:3", "9:16"];
export const imageResolutions: ImageResolution[] = ["1k", "2k"];
export const imageQualities: ImageQuality[] = ["auto", "low", "medium", "high"];
const imageRatioBaseSizes: Record<ImageRatio, readonly [number, number]> = {
  "2:1": [2048, 1024],
  "16:9": [1792, 1024],
  "3:2": [1536, 1024],
  "1:1": [1024, 1024],
  "2:3": [1024, 1536],
  "9:16": [1024, 1792]
};
const imageResolutionScale: Record<ImageResolution, number> = {
  "1k": 1,
  "2k": 2
};
export const imageSizeOptions: Array<{ size: ImageSize; ratio: ImageRatio; resolution: ImageResolution }> = imageRatios.flatMap((ratio) => {
  const [baseWidth, baseHeight] = imageRatioBaseSizes[ratio];
  return imageResolutions.map((resolution) => {
    const scale = imageResolutionScale[resolution];
    return {
      size: `${baseWidth * scale}x${baseHeight * scale}` as ImageSize,
      ratio,
      resolution
    };
  });
});
export const imageSizes: ImageSize[] = imageSizeOptions.map((item) => item.size);

export function resolveImageSize(ratio: ImageRatio, resolution: ImageResolution): ImageSize {
  const [baseWidth, baseHeight] = imageRatioBaseSizes[ratio];
  const scale = imageResolutionScale[resolution];
  return `${baseWidth * scale}x${baseHeight * scale}` as ImageSize;
}

export function imageSizeOptionForSize(size: string | undefined) {
  return imageSizeOptions.find((item) => item.size === size);
}

export function supportedImageResolutionsForRatio(ratio: ImageRatio) {
  return imageSizeOptions
    .filter((item) => item.ratio === ratio)
    .map((item) => item.resolution);
}

export function supportedImageRatiosForResolution(resolution: ImageResolution) {
  return imageSizeOptions
    .filter((item) => item.resolution === resolution)
    .map((item) => item.ratio);
}

export interface CreateAssetGroupInput {
  name: string;
  description?: string;
  projectName?: string;
}

export interface CreateAssetInput {
  groupId: string;
  url: string;
  name?: string;
  assetType: AssetType;
  projectName?: string;
}

export interface VideoAssetInput {
  id: string;
  assetType: AssetType;
  label?: string;
}

export interface VideoReferenceInput {
  assetId?: string;
  sourceUrl?: string;
  previewUrl?: string;
  localPath?: string;
  localUrl?: string;
  assetType: AssetType;
  role: VideoReferenceRole;
  label?: string;
}

export interface VideoTaskInput {
  modelVersion: VideoModelVersion;
  prompt: string;
  mode: VideoMode;
  ratio: VideoRatio;
  duration: number;
  resolution?: VideoResolution;
  references: VideoReferenceInput[];
}

interface VideoContentItem {
  type: string;
  text?: string;
  image_url?: { url: string | undefined };
  video_url?: { url: string | undefined };
  role?: string;
}

interface VideoTaskPayload {
  model: VideoModelVersion;
  duration: number;
  resolution: VideoResolution;
  ratio?: VideoRatio;
  content: VideoContentItem[];
}

export function buildCreateAssetGroupPayload(input: CreateAssetGroupInput) {
  const payload: Record<string, unknown> = {
    Name: input.name,
    Description: input.description ?? "",
    GroupType: "AIGC"
  };
  if (input.projectName) payload.ProjectName = input.projectName;
  return payload;
}

export function buildCreateAssetPayload(input: CreateAssetInput) {
  const payload: Record<string, unknown> = {
    GroupId: input.groupId,
    URL: input.url,
    Name: input.name ?? "",
    AssetType: input.assetType
  };
  if (input.projectName) payload.ProjectName = input.projectName;
  return payload;
}

export function buildVideoTaskPayload(input: VideoTaskInput): VideoTaskPayload {
  const payload: VideoTaskPayload = {
    model: input.modelVersion,
    duration: input.duration,
    resolution: input.resolution ?? "720p",
    content: [
      {
        type: "text",
        text: input.prompt
      },
      ...input.references.map((reference) => {
        const field = reference.assetType === "Video" ? "video_url" : "image_url";
        return {
          type: field,
          [field]: {
            url: reference.assetId ? `asset://${reference.assetId}` : reference.sourceUrl
          },
          role: payloadReferenceRole(reference)
        };
      })
    ]
  };
  if (input.mode !== "frames") payload.ratio = input.ratio;
  return payload;
}

function payloadReferenceRole(reference: VideoReferenceInput) {
  if (reference.role === "first_frame" || reference.role === "last_frame") return reference.role;
  return reference.assetType === "Video" ? "reference_video" : "reference_image";
}

export function validatePublicAssetUrl(raw: string): { ok: boolean; message?: string } {
  if (raw.startsWith("data:")) {
    return { ok: false, message: "文档要求传入公网 URL，不支持 base64。" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "请输入有效 URL。" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "素材 URL 必须是可公网访问的 https 地址。" };
  }

  const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (blockedHosts.has(parsed.hostname)) {
    return { ok: false, message: "素材 URL 不能指向本机地址。" };
  }

  return { ok: true };
}

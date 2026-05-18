export type AssetType = "Image" | "Video" | "Audio";

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

export interface VideoTaskInput {
  model: string;
  prompt: string;
  assets: VideoAssetInput[];
}

export function buildCreateAssetGroupPayload(input: CreateAssetGroupInput) {
  return {
    Name: input.name,
    Description: input.description ?? "",
    GroupType: "AIGC",
    ProjectName: input.projectName || "default"
  };
}

export function buildCreateAssetPayload(input: CreateAssetInput) {
  return {
    GroupId: input.groupId,
    URL: input.url,
    Name: input.name ?? "",
    AssetType: input.assetType,
    ProjectName: input.projectName || "default"
  };
}

export function buildVideoTaskPayload(input: VideoTaskInput) {
  return {
    model: input.model,
    content: [
      {
        type: "text",
        text: input.prompt
      },
      ...input.assets.map((asset) => ({
        type: asset.assetType === "Video" ? "video_url" : "image_url",
        [asset.assetType === "Video" ? "video_url" : "image_url"]: {
          url: `asset://${asset.id}`
        },
        role: asset.assetType === "Video" ? "reference_video" : "reference_image"
      }))
    ]
  };
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

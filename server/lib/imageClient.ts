import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { normalizeImage2APIURL, normalizeImage2EditAPIURL, normalizeImage2Model, type AppConfig } from "./config.js";
import { extractTokenUsage } from "./tokenUsage.js";
import type { RuntimeSettings, TokenUsage } from "../types.js";
import { resolveImageSize, type ImageModelVersion, type ImageQuality, type ImageRatio, type ImageResolution, type ImageSize, type VideoReferenceInput } from "./payloads.js";

type RuntimeSettingsProvider = () => RuntimeSettings | Promise<RuntimeSettings>;

export interface ImageGenerationInput {
  prompt: string;
  ratio?: ImageRatio;
  imageResolution?: ImageResolution;
  imageQuality?: ImageQuality;
  size?: ImageSize;
  imageModel?: ImageModelVersion | string;
  references: VideoReferenceInput[];
}

export interface ImageGenerationResult {
  imageUrls: string[];
  tokenUsage?: TokenUsage;
  raw: unknown;
}

export class ImageClient {
  constructor(
    private readonly config: AppConfig,
    private readonly runtimeSettings?: RuntimeSettingsProvider
  ) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const settings = await this.settings();
    if (!settings.image2APIKey) throw new Error("缺少 IMAGE2_API_KEY，无法创建图片任务。");
    const referenceImageUrls = imageReferenceUrls(input);
    const model = normalizeImage2Model(input.imageModel || settings.image2Model || "gpt-image-2");
    const raw = referenceImageUrls.length
      ? await this.callMultipart(
        settings,
        normalizeImage2EditAPIURL(settings.image2APIURL || "https://www.cctq.ai/v1/images/generations"),
        await buildImageEditFormData(input, model, referenceImageUrls)
      )
      : await this.callJSON(
        settings,
        normalizeImage2APIURL(settings.image2APIURL || "https://www.cctq.ai/v1/images/generations"),
        buildImagePayload(input, model)
      );
    const imageUrls = extractImageUrls(raw);
    if (!imageUrls.length) throw new Error("图片生成响应里没有图片 URL。");
    return {
      imageUrls,
      tokenUsage: extractTokenUsage(raw),
      raw
    };
  }

  async download(imageUrl: string, taskId: string, index: number) {
    const settings = await this.settings();
    const dir = settings.downloadDir || this.config.downloadDir;
    await mkdir(dir, { recursive: true });
    if (imageUrl.startsWith("data:image/")) {
      const parsed = parseDataImage(imageUrl);
      const path = join(dir, `image-task-${taskId}-${index + 1}${parsed.ext}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, parsed.buffer);
      return path;
    }

    const response = await fetch(imageUrl);
    if (!response.ok || !response.body) {
      throw new Error(`图片下载失败：${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const path = join(dir, `image-task-${taskId}-${index + 1}${extensionFromContentType(contentType, imageUrl)}`);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(path));
    return path;
  }

  private async settings(): Promise<RuntimeSettings> {
    return this.runtimeSettings ? await this.runtimeSettings() : {
      port: String(this.config.port),
      host: this.config.host,
      databasePath: this.config.databasePath,
      sqlitePath: this.config.sqlitePath,
      downloadDir: this.config.downloadDir,
      uploadDir: this.config.uploadDir,
      volcengineAK: this.config.volcengineAK,
      volcengineSK: this.config.volcengineSK,
      volcengineRegion: this.config.volcengineRegion,
      volcengineService: this.config.volcengineService,
      arkAPIKey: this.config.arkAPIKey,
      arkVideoModel: this.config.arkVideoModel,
      arkBaseURL: this.config.arkBaseURL,
      imageHostURL: this.config.imageHostURL,
      assetProjectName: this.config.assetProjectName,
      pollIntervalSeconds: String(this.config.pollIntervalMs / 1000),
      pollTimeoutSeconds: String(this.config.pollTimeoutMs / 1000),
      maxPollRetryCount: String(this.config.maxPollRetryCount),
      maxConcurrentVideoTasks: String(this.config.maxConcurrentVideoTasks),
      maxConcurrentImageTasks: String(this.config.maxConcurrentImageTasks ?? 8),
      tokenPricePerThousand: String(this.config.tokenPricePerThousand),
      imageTokenPricePerThousand: String(this.config.imageTokenPricePerThousand ?? this.config.tokenPricePerThousand),
      image2APIKey: this.config.image2APIKey ?? "",
      image2APIURL: normalizeImage2APIURL(this.config.image2APIURL ?? "https://www.cctq.ai/v1/images/generations"),
      image2Model: normalizeImage2Model(this.config.image2Model ?? "gpt-image-2")
    };
  }

  private async callJSON(settings: RuntimeSettings, endpoint: string, body: unknown) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.image2APIKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const decoded = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`图片 API 调用失败：${response.status} endpoint=${endpoint} ${text}`);
    }
    return decoded;
  }

  private async callMultipart(settings: RuntimeSettings, endpoint: string, body: FormData) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.image2APIKey}`
      },
      body
    });
    const text = await response.text();
    const decoded = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`图片 API 调用失败：${response.status} endpoint=${endpoint} ${text}`);
    }
    return decoded;
  }
}

export function buildImagePayload(input: ImageGenerationInput, model: string) {
  const size = input.size ?? resolveImageSize(input.ratio ?? "1:1", input.imageResolution ?? "1k");
  if (!size) {
    throw new Error(`图片比例与分辨率组合不支持：${input.ratio ?? "1:1"} / ${input.imageResolution ?? "1k"}`);
  }
  const payload: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    size,
    quality: input.imageQuality ?? "auto",
    n: 1
  };
  return payload;
}

export async function buildImageEditFormData(input: ImageGenerationInput, model: string, imageUrls = imageReferenceUrls(input)) {
  const payload = buildImagePayload(input, model);
  const formData = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    formData.set(key, String(value));
  }
  formData.set("response_format", "url");
  formData.set("model_name", model);
  formData.set("modelName", model);
  const imageFieldName = imageUrls.length === 1 ? "image" : "image[]";
  for (const [index, imageUrl] of imageUrls.entries()) {
    const file = await fetchReferenceImage(imageUrl, index);
    formData.append(imageFieldName, file.blob, file.filename);
  }
  return formData;
}

async function fetchReferenceImage(imageUrl: string, index: number) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`参考图片下载失败：${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error("参考图片下载失败：文件为空。");
  return {
    blob: new Blob([buffer], { type: contentType }),
    filename: `reference-${index + 1}${extensionFromContentType(contentType, imageUrl)}`
  };
}

function imageReferenceUrls(input: ImageGenerationInput) {
  return input.references.flatMap((reference) => reference.sourceUrl ? [reference.sourceUrl] : []);
}

export function extractImageUrls(source: unknown): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const url of imageUrlsFromString(value)) urls.add(url);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === "b64_json" && typeof child === "string") {
        urls.add(`data:image/png;base64,${child}`);
        continue;
      }
      if ((normalizedKey === "url" || normalizedKey === "image_url" || normalizedKey === "output_url") && typeof child === "string") {
        for (const url of imageUrlsFromString(child)) urls.add(url);
        continue;
      }
      visit(child);
    }
  };
  visit(source);
  return [...urls];
}

function imageUrlsFromString(value: string) {
  const urls: string[] = [];
  if (value.startsWith("data:image/")) urls.push(value);
  const markdownPattern = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of value.matchAll(markdownPattern)) urls.push(match[1]);
  const urlPattern = /https?:\/\/[^\s"'<>),]+/g;
  for (const match of value.matchAll(urlPattern)) {
    const url = match[0];
    if (isLikelyImageUrl(url)) urls.push(url);
  }
  return urls;
}

function isLikelyImageUrl(url: string) {
  const lower = url.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].some((ext) => lower.includes(ext)) || lower.includes("tos-") || lower.includes("image");
}

function parseDataImage(value: string) {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("无法解析 base64 图片。");
  return {
    ext: extensionFromContentType(match[1], ""),
    buffer: Buffer.from(match[2], "base64")
  };
}

function extensionFromContentType(contentType: string, url: string) {
  const lower = contentType.toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return ".jpg";
  if (lower.includes("webp")) return ".webp";
  if (lower.includes("gif")) return ".gif";
  if (lower.includes("avif")) return ".avif";
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.(png|jpg|jpeg|webp|gif|avif)$/);
    if (match) return match[0] === ".jpeg" ? ".jpg" : match[0];
  } catch {
    // Fall back to png below.
  }
  return ".png";
}

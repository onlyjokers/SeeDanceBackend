import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface LocalUpload {
  path: string;
  url: string;
}

const imageExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

const videoExtensions: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",
  "video/webm": ".webm"
};

export async function saveUploadedImageLocally(file: File, uploadDir: string): Promise<LocalUpload> {
  await mkdir(uploadDir, { recursive: true });
  const extension = extensionForFile(file);
  const name = `${Date.now()}-${randomUUID()}${extension}`;
  const path = resolve(uploadDir, name);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  return { path, url: `/api/uploads/local/${name}` };
}

export async function saveUploadedVideoLocally(file: File, uploadDir: string): Promise<LocalUpload> {
  await mkdir(uploadDir, { recursive: true });
  const extension = extensionForFileMap(file, videoExtensions, ".mp4");
  const name = `${Date.now()}-${randomUUID()}${extension}`;
  const path = resolve(uploadDir, name);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  return { path, url: `/api/uploads/local/${name}` };
}

export function resolveLocalUploadPath(uploadDir: string, filename: string) {
  const root = resolve(uploadDir);
  const path = resolve(root, basename(filename));
  if (!path.startsWith(root)) throw new Error("非法上传文件路径。");
  return path;
}

export async function fileFromLocalUpload(path: string, fallbackName = "reference.png"): Promise<File> {
  const bytes = await readFile(path);
  const info = await stat(path);
  const type = mimeTypeForPath(path);
  return new File([bytes], basename(path) || fallbackName, {
    type,
    lastModified: info.mtimeMs
  });
}

function extensionForFile(file: File) {
  return extensionForFileMap(file, imageExtensions, ".png");
}

function extensionForFileMap(file: File, byMimeType: Record<string, string>, fallback: string) {
  const byType = byMimeType[file.type.toLowerCase()];
  if (byType) return byType;
  const byName = extname(file.name).toLowerCase();
  return byName && /^[a-z0-9.]+$/.test(byName) ? byName : fallback;
}

function mimeTypeForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

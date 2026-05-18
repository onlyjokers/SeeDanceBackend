import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppConfig } from "./config.js";
import { buildVideoTaskPayload } from "./payloads.js";
import type { Asset } from "../types.js";

export class VideoClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return Boolean(this.config.arkAPIKey);
  }

  async createTask(prompt: string, assets: Asset[]) {
    if (!this.isConfigured()) throw new Error("缺少 ARK_API_KEY，无法创建视频任务。");
    const payload = buildVideoTaskPayload({
      model: this.config.arkVideoModel,
      prompt,
      assets: assets.map((asset, index) => ({
        id: asset.id,
        assetType: asset.assetType,
        label: `图片 ${index + 1}`
      }))
    });
    const raw = await this.call("/api/v3/contents/generations/tasks", "POST", payload);
    const remoteTaskId = findFirstString(raw, ["id", "task_id", "taskId"]);
    if (!remoteTaskId) throw new Error("视频任务响应里没有 task id。");
    return { remoteTaskId, raw };
  }

  async getTask(remoteTaskId: string) {
    if (!this.isConfigured()) throw new Error("缺少 ARK_API_KEY，无法查询视频任务。");
    const raw = await this.call(`/api/v3/contents/generations/tasks/${remoteTaskId}`, "GET");
    return {
      status: normalizeStatus(findFirstString(raw, ["status", "state"])),
      videoUrl: findVideoUrl(raw),
      errorMessage: findFirstString(raw, ["message", "error", "error_message"]),
      raw
    };
  }

  async download(videoUrl: string, taskId: string) {
    await mkdir(this.config.downloadDir, { recursive: true });
    const response = await fetch(videoUrl);
    if (!response.ok || !response.body) {
      throw new Error(`视频下载失败：${response.status} ${response.statusText}`);
    }
    const path = join(this.config.downloadDir, `video-task-${taskId}.mp4`);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(path));
    return path;
  }

  private async call(path: string, method: "GET" | "POST", body?: unknown) {
    const response = await fetch(`${this.config.arkBaseURL.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.arkAPIKey}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    const decoded = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`视频 API 调用失败：${response.status} ${text}`);
    }
    return decoded;
  }
}

function normalizeStatus(status: string) {
  const value = status.toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done"].includes(value)) return "succeeded" as const;
  if (["failed", "fail", "error", "canceled", "cancelled"].includes(value)) return "failed" as const;
  if (["queued", "pending"].includes(value)) return "queued" as const;
  return "running" as const;
}

function findFirstString(source: unknown, keys: string[]): string {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const visit = (value: unknown): string => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (wanted.has(key.toLowerCase()) && typeof child === "string") return child;
      }
      for (const child of Object.values(value)) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return "";
  };
  return visit(source);
}

function findVideoUrl(source: unknown): string {
  const direct = findFirstString(source, ["video_url", "videoUrl", "output_url", "download_url", "url"]);
  if (direct.startsWith("http")) return direct;
  const visit = (value: unknown): string => {
    if (typeof value === "string" && value.startsWith("http") && (value.includes(".mp4") || value.includes("tos-"))) return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
    }
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return "";
  };
  return visit(source);
}

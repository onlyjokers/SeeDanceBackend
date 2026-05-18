import type { AssetType } from "./lib/payloads.js";

export interface AssetGroup {
  id: string;
  name: string;
  description: string;
  groupType: "AIGC";
  projectName: string;
  createTime?: string;
  updateTime?: string;
  raw?: unknown;
}

export interface Asset {
  id: string;
  name: string;
  url: string;
  assetType: AssetType;
  groupId: string;
  status: "Processing" | "Active" | "Failed" | string;
  errorCode?: string;
  errorMessage?: string;
  projectName: string;
  createTime?: string;
  updateTime?: string;
  raw?: unknown;
}

export interface VideoTask {
  id: string;
  remoteTaskId?: string;
  prompt: string;
  assetIds: string[];
  status: "queued" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  videoUrl?: string;
  downloadPath?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface PollLog {
  id: string;
  taskId: string;
  message: string;
  raw?: unknown;
  createdAt: string;
}

export interface DatabaseShape {
  assetGroups: AssetGroup[];
  assets: Asset[];
  videoTasks: VideoTask[];
  pollLogs: PollLog[];
}

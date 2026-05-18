import type { AssetType, ReferenceTransport, VideoMode, VideoModelVersion, VideoRatio, VideoReferenceInput } from "./lib/payloads.js";

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
  projectId?: string;
  remoteTaskId?: string;
  prompt: string;
  assetIds: string[];
  mode?: VideoMode;
  referenceTransport?: ReferenceTransport;
  modelVersion?: VideoModelVersion;
  ratio?: VideoRatio;
  duration?: number;
  references?: VideoReferenceInput[];
  status: "queued" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  videoUrl?: string;
  downloadPath?: string;
  hiddenAt?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface VideoProject {
  id: string;
  name: string;
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

export interface RuntimeSettings {
  arkAPIKey: string;
  arkVideoModel: string;
  arkBaseURL: string;
  imageHostURL: string;
}

export interface DatabaseShape {
  assetGroups: AssetGroup[];
  assets: Asset[];
  videoProjects: VideoProject[];
  videoTasks: VideoTask[];
  pollLogs: PollLog[];
  runtimeSettings?: RuntimeSettings;
}

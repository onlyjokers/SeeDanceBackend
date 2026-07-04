import type { AssetType, GenerationRatio, ImageModelVersion, ImageQuality, ImageResolution, ImageSize, MediaType, ReferenceTransport, VideoMode, VideoModelVersion, VideoReferenceInput, VideoResolution } from "./lib/payloads.js";

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
  mediaType?: MediaType;
  provider?: string;
  projectId?: string;
  remoteTaskId?: string;
  prompt: string;
  assetIds: string[];
  mode?: VideoMode;
  referenceTransport?: ReferenceTransport;
  modelVersion?: VideoModelVersion;
  ratio?: GenerationRatio;
  duration?: number;
  resolution?: VideoResolution;
  references?: VideoReferenceInput[];
  status: "queued" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  tokenUsage?: TokenUsage;
  videoUrl?: string;
  downloadPath?: string;
  imageModel?: ImageModelVersion | string;
  imageSize?: ImageSize;
  imageResolution?: ImageResolution;
  imageQuality?: ImageQuality;
  imageUrls?: string[];
  imageDownloadPaths?: string[];
  hiddenAt?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface VideoProject {
  id: string;
  name: string;
  deletedAt?: string;
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
  port: string;
  host: string;
  databasePath: string;
  sqlitePath: string;
  downloadDir: string;
  uploadDir: string;
  volcengineAK: string;
  volcengineSK: string;
  volcengineRegion: string;
  volcengineService: string;
  arkAPIKey: string;
  arkVideoModel: string;
  arkBaseURL: string;
  imageHostURL: string;
  assetProjectName: string;
  pollIntervalSeconds: string;
  pollTimeoutSeconds: string;
  maxPollRetryCount: string;
  maxConcurrentVideoTasks: string;
  maxConcurrentImageTasks?: string;
  tokenPricePerThousand: string;
  imageTokenPricePerThousand?: string;
  image2APIKey?: string;
  image2APIURL?: string;
  image2Model?: string;
}

export interface StorageStats {
  database: {
    jsonPath: string;
    sqlitePath: string;
    jsonBytes: number;
    sqliteBytes: number;
  };
  files: {
    downloadDir: string;
    uploadDir: string;
    downloadBytes: number;
    uploadBytes: number;
    totalBytes: number;
  };
  tasks: {
    total: number;
    visible: number;
    hidden: number;
    succeeded: number;
    failed: number;
    running: number;
    queued: number;
    generatedVideos: number;
    downloadedVideos: number;
    generatedImages: number;
    downloadedImages: number;
  };
}

export interface DatabaseShape {
  assetGroups: AssetGroup[];
  assets: Asset[];
  videoProjects: VideoProject[];
  videoTasks: VideoTask[];
  pollLogs: PollLog[];
  runtimeSettings?: RuntimeSettings;
}

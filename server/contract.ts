import type { ImageTaskRequest, VideoTaskRequest } from "./lib/requestSchemas.js";
import type { LocalUsageSummary } from "./lib/usageStats.js";
import type { DatabaseShape, RuntimeSettings, StorageStats, VideoProject, VideoTask } from "./types.js";

export const apiV1Prefix = "/api/v1" as const;

export const apiV1Paths = {
  config: `${apiV1Prefix}/config`,
  shellState: `${apiV1Prefix}/shell-state`,
  projects: `${apiV1Prefix}/projects`,
  project: (id: string) => `${apiV1Prefix}/projects/${encodeURIComponent(id)}`,
  managerProjectRestore: (id: string) => `${apiV1Prefix}/manager/projects/${encodeURIComponent(id)}/restore`,
  generationTasks: `${apiV1Prefix}/generation-tasks`,
  generationTask: (id: string) => `${apiV1Prefix}/generation-tasks/${encodeURIComponent(id)}`,
  generationTaskCancel: (id: string) => `${apiV1Prefix}/generation-tasks/${encodeURIComponent(id)}/cancel`,
  generationTaskDebug: (id: string) => `${apiV1Prefix}/generation-tasks/${encodeURIComponent(id)}/debug`,
  generationTaskFile: (id: string, index: number) => `${apiV1Prefix}/generation-tasks/${encodeURIComponent(id)}/file/${index}`,
  uploadImages: `${apiV1Prefix}/uploads/images`,
  uploadLocal: (name: string) => `${apiV1Prefix}/uploads/local/${encodeURIComponent(name)}`,
  downloadsOpenFolder: `${apiV1Prefix}/downloads/open-folder`,
  managerLogin: `${apiV1Prefix}/manager/login`,
  managerSettings: `${apiV1Prefix}/manager/settings`,
  managerUsage: `${apiV1Prefix}/manager/usage`,
  managerStorage: `${apiV1Prefix}/manager/storage`,
  managerGenerationTasks: `${apiV1Prefix}/manager/generation-tasks`,
  managerGenerationTask: (id: string) => `${apiV1Prefix}/manager/generation-tasks/${encodeURIComponent(id)}`,
  managerLocalComputeResources: `${apiV1Prefix}/manager/local-compute/resources`,
  managerLocalComputePresets: `${apiV1Prefix}/manager/local-compute/presets`,
  managerLocalComputeFree: `${apiV1Prefix}/manager/local-compute/free`
} as const;

export interface APIErrorResponse {
  error: string;
}

export interface PageResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ManagerLoginRequest {
  username: string;
  password: string;
}

export interface ManagerLoginResponse {
  ok: true;
  token: string;
}

export interface UploadImageResponse {
  url: string;
  localPath: string;
  localUrl: string;
}

export type CreateGenerationTaskRequest = ImageTaskRequest | VideoTaskRequest;
export type GenerationTaskResponse = VideoTask;
export type GenerationTaskPageResponse = PageResponse<VideoTask>;
export type ProjectListResponse = VideoProject[];
export type ShellStateResponse = Omit<DatabaseShape, "videoTasks"> & { videoTasks: [] };
export type RuntimeSettingsResponse = RuntimeSettings;
export type StorageStatsResponse = StorageStats;
export type ManagerUsageResponse = LocalUsageSummary;

export interface APIClientOptions {
  baseURL?: string;
  managerToken?: string;
  fetcher?: typeof fetch;
}

export function createAPIClient(options: APIClientOptions = {}) {
  const baseURL = (options.baseURL ?? "").replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (options.managerToken) headers.set("x-sts-manager-token", options.managerToken);
    const response = await fetcher(url(path), { ...init, headers });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as APIErrorResponse).error)
        : `API request failed (${response.status})`;
      throw new Error(message);
    }
    return payload as T;
  }

  function url(path: string) {
    return `${baseURL}${path.startsWith("/") ? path : `/${path}`}`;
  }

  return {
    url,
    request,
    getConfig: () => request(apiV1Paths.config),
    listProjects: () => request<ProjectListResponse>(apiV1Paths.projects),
    listGenerationTasks: (query = "") => request<GenerationTaskPageResponse>(`${apiV1Paths.generationTasks}${query}`),
    createGenerationTask: (body: CreateGenerationTaskRequest) => request<GenerationTaskResponse>(apiV1Paths.generationTasks, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    cancelGenerationTask: (id: string) => request<GenerationTaskResponse>(apiV1Paths.generationTaskCancel(id), { method: "POST" }),
    loginManager: (body: ManagerLoginRequest) => request<ManagerLoginResponse>(apiV1Paths.managerLogin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    getManagerUsage: (query = "") => request<ManagerUsageResponse>(`${apiV1Paths.managerUsage}${query}`)
  };
}

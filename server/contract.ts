import type { ImageTaskRequest, VideoTaskRequest } from "./lib/requestSchemas.js";
import type { DatabaseShape, RuntimeSettings, StorageStats, VideoProject, VideoTask } from "./types.js";

export const apiV1Prefix = "/api/v1" as const;

export const apiV1Paths = {
  config: `${apiV1Prefix}/config`,
  shellState: `${apiV1Prefix}/shell-state`,
  projects: `${apiV1Prefix}/projects`,
  generationTasks: `${apiV1Prefix}/generation-tasks`,
  generationTask: (id: string) => `${apiV1Prefix}/generation-tasks/${encodeURIComponent(id)}`,
  generationTaskDebug: (id: string) => `${apiV1Prefix}/generation-tasks/${encodeURIComponent(id)}/debug`,
  generationTaskFile: (id: string, index: number) => `${apiV1Prefix}/generation-tasks/${encodeURIComponent(id)}/file/${index}`,
  uploadImages: `${apiV1Prefix}/uploads/images`,
  managerLogin: `${apiV1Prefix}/manager/login`,
  managerSettings: `${apiV1Prefix}/manager/settings`,
  managerUsage: `${apiV1Prefix}/manager/usage`,
  managerStorage: `${apiV1Prefix}/manager/storage`,
  managerGenerationTasks: `${apiV1Prefix}/manager/generation-tasks`,
  managerGenerationTask: (id: string) => `${apiV1Prefix}/manager/generation-tasks/${encodeURIComponent(id)}`
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
    loginManager: (body: ManagerLoginRequest) => request<ManagerLoginResponse>(apiV1Paths.managerLogin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  };
}

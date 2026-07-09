import type { VideoTask } from "../types.js";

export type OrchestratorJobStatus = "queued" | "admitted" | "running" | "succeeded" | "failed" | "cancelled" | "blocked_resource";
export type OrchestratorJobPriority = "low" | "normal" | "high";
export type OrchestratorErrorCode =
  | "oom_vram"
  | "oom_ram"
  | "host_buffer_error"
  | "adapter_down"
  | "tool_missing"
  | "model_missing"
  | "codec_unavailable"
  | "workflow_error"
  | "input_missing"
  | "timeout"
  | "cancelled"
  | "service_restarted"
  | "unknown";

export interface CreateOrchestratorJobRequest {
  source: string;
  externalId?: string;
  preset: string;
  priority?: OrchestratorJobPriority;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface CreateOrchestratorJobResponse {
  jobId: string;
  status: OrchestratorJobStatus;
}

export interface OrchestratorJobRecord {
  id: string;
  source: string;
  externalId?: string;
  preset: string;
  priority: OrchestratorJobPriority;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: OrchestratorJobStatus;
  progress: number;
  errorCode?: OrchestratorErrorCode;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  resourcePeak?: Record<string, unknown>;
}

export class LocalComputeUnavailableError extends Error {
  constructor(public readonly cause?: unknown) {
    super("Local compute manager unavailable");
    this.name = "LocalComputeUnavailableError";
  }
}

export class OrchestratorRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: OrchestratorErrorCode | "validation_error" | "not_found",
    message: string,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "OrchestratorRequestError";
  }
}

export class StrangeOrchestratorClient {
  private readonly baseURL: string | (() => string | Promise<string>);

  constructor(options: { baseURL?: string | (() => string | Promise<string>) } = {}) {
    this.baseURL = options.baseURL || process.env.STRANGE_ORCHESTRATOR_URL || "http://127.0.0.1:8790";
  }

  createJob(payload: CreateOrchestratorJobRequest): Promise<CreateOrchestratorJobResponse> {
    return this.request<CreateOrchestratorJobResponse>("/jobs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getJob(jobId: string): Promise<OrchestratorJobRecord> {
    return this.request<OrchestratorJobRecord>(`/jobs/${encodeURIComponent(jobId)}`);
  }

  cancelJob(jobId: string): Promise<OrchestratorJobRecord> {
    return this.request<OrchestratorJobRecord>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  }

  getResources(): Promise<unknown> {
    return this.request<unknown>("/resources");
  }

  getPresets(): Promise<unknown> {
    return this.request<unknown>("/presets");
  }

  freeResources(): Promise<unknown> {
    return this.request<unknown>("/admin/free", { method: "POST" });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${await this.currentBaseURL()}${path}`, {
        ...init,
        headers: {
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      throw new LocalComputeUnavailableError(error);
    }

    const text = await response.text();
    const body = parseJSON(text);
    if (!response.ok) {
      const record = isRecord(body) ? body : {};
      const code = typeof record.error === "string" ? record.error : "unknown";
      const message = typeof record.message === "string" ? record.message : text || response.statusText;
      throw new OrchestratorRequestError(response.status, code as OrchestratorRequestError["code"], message, body);
    }
    return body as T;
  }

  private async currentBaseURL() {
    const value = typeof this.baseURL === "function" ? await this.baseURL() : this.baseURL;
    return normalizeBaseURL(value);
  }
}

export function mapOrchestratorStatusToVideoTaskStatus(status: OrchestratorJobStatus): VideoTask["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

function normalizeBaseURL(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function parseJSON(text: string) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

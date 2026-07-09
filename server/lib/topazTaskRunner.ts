import { resolve } from "node:path";
import type { AppConfig } from "./config.js";
import type { AppDB } from "./db.js";
import { addPollLog, updateVideoTask } from "./db.js";
import type { RuntimeSettings, TopazTaskMetadata, VideoTask } from "../types.js";
import { errorMessage } from "./retry.js";
import {
  mapOrchestratorStatusToVideoTaskStatus,
  type CreateOrchestratorJobRequest,
  type CreateOrchestratorJobResponse,
  type OrchestratorJobRecord
} from "./strangeOrchestratorClient.js";

type Job = () => Promise<void>;
type RuntimeSettingsProvider = () => RuntimeSettings | Promise<RuntimeSettings>;

export interface TopazOrchestratorClientLike {
  createJob(payload: CreateOrchestratorJobRequest): Promise<CreateOrchestratorJobResponse>;
  getJob(jobId: string): Promise<OrchestratorJobRecord>;
  cancelJob(jobId: string): Promise<OrchestratorJobRecord>;
  getResources(): Promise<unknown>;
  getPresets(): Promise<unknown>;
  freeResources(): Promise<unknown>;
}

export type TopazClientLike = TopazOrchestratorClientLike;

interface RuntimeSettingsAwareTopazTask {
  id: string;
  orchestratorJobId?: string;
  topaz?: TopazTaskMetadata;
}

export class TopazTaskRunner {
  private queue: Job[] = [];
  private activeCount = 0;

  constructor(
    private readonly db: AppDB,
    private readonly orchestratorClient: TopazOrchestratorClientLike,
    private readonly config: AppConfig,
    private readonly runtimeSettings?: RuntimeSettingsProvider
  ) {}

  enqueue(taskId: string) {
    this.queue.push(async () => {
      await this.processTask(taskId);
    });
    void this.drain();
  }

  async syncTask(taskId: string) {
    const task = this.db.data.videoTasks.find((item) => item.id === taskId);
    if (!task?.orchestratorJobId) return task;
    const job = await this.orchestratorClient.getJob(task.orchestratorJobId);
    await this.applyOrchestratorJob(taskId, job);
    return this.db.data.videoTasks.find((item) => item.id === taskId);
  }

  async cancelTask(taskId: string) {
    const task = this.db.data.videoTasks.find((item) => item.id === taskId);
    if (!task?.orchestratorJobId) {
      await updateVideoTask(this.db, taskId, {
        status: "cancelled",
        errorMessage: "任务已取消"
      });
      return this.db.data.videoTasks.find((item) => item.id === taskId);
    }
    const job = await this.orchestratorClient.cancelJob(task.orchestratorJobId);
    await this.applyOrchestratorJob(taskId, job);
    return this.db.data.videoTasks.find((item) => item.id === taskId);
  }

  private async drain() {
    const settings = await this.currentSettings();
    while (this.activeCount < settings.maxConcurrentTopazTasks && this.queue.length) {
      const job = this.queue.shift();
      if (!job) return;
      this.activeCount += 1;
      void job().finally(() => {
        this.activeCount -= 1;
        void this.drain();
      });
    }
  }

  private async processTask(taskId: string) {
    try {
      const task = this.db.data.videoTasks.find((item) => item.id === taskId);
      if (!task?.topaz) throw new Error("Topaz 任务缺少处理参数。");
      await updateVideoTask(this.db, taskId, { status: "running" });
      await addPollLog(this.db, taskId, "本机计算任务提交开始", task.topaz);
      const settings = await this.fullSettings();
      const sourcePath = await this.resolveSourcePath(task);
      const payload = this.createTopazJobPayload(taskId, sourcePath, settings, task.topaz);
      const created = await this.orchestratorClient.createJob(payload);
      await updateVideoTask(this.db, taskId, {
        orchestratorJobId: created.jobId,
        orchestratorStatus: created.status,
        orchestratorUpdatedAt: new Date().toISOString(),
        topaz: {
          ...task.topaz,
          sourceLocalPath: sourcePath
        },
        raw: created
      });
      await addPollLog(this.db, taskId, `本机计算任务已提交：${created.jobId}`, created);
      await this.pollOrchestratorJob(taskId, created.jobId);
    } catch (error) {
      await updateVideoTask(this.db, taskId, {
        status: "failed",
        errorMessage: errorMessage(error)
      });
      await addPollLog(this.db, taskId, "本机计算任务失败", { error: errorMessage(error) });
    }
  }

  private async pollOrchestratorJob(taskId: string, jobId: string) {
    const started = Date.now();
    let lastStatus = "";
    while (Date.now() - started < this.config.pollTimeoutMs) {
      const job = await this.orchestratorClient.getJob(jobId);
      await this.applyOrchestratorJob(taskId, job);
      if (job.status !== lastStatus) {
        await addPollLog(this.db, taskId, `本机计算任务状态：${job.status}`, job);
        lastStatus = job.status;
      }
      if (isTerminalOrchestratorStatus(job.status)) return;
      await delay(this.config.pollIntervalMs);
    }
    throw new Error("本机计算任务轮询超时。");
  }

  private async applyOrchestratorJob(taskId: string, job: OrchestratorJobRecord) {
    const existing = this.db.data.videoTasks.find((item) => item.id === taskId);
    const outputPath = outputPathFromJob(job);
    const patch: Partial<VideoTask> = {
      status: mapOrchestratorStatusToVideoTaskStatus(job.status),
      orchestratorJobId: job.id,
      orchestratorStatus: job.status,
      orchestratorProgress: job.progress,
      orchestratorUpdatedAt: job.updatedAt,
      raw: job
    };
    if (job.status === "succeeded" && outputPath) {
      patch.downloadPath = outputPath;
      patch.topaz = {
        ...existing?.topaz,
        outputPath
      } as TopazTaskMetadata;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      patch.errorMessage = job.errorMessage || job.errorCode || (job.status === "cancelled" ? "任务已取消" : "本机计算任务失败");
    }
    await updateVideoTask(this.db, taskId, patch);
  }

  private createTopazJobPayload(taskId: string, sourcePath: string, settings: RuntimeSettings, topaz: TopazTaskMetadata): CreateOrchestratorJobRequest {
    return {
      source: "SeeDanceTest",
      externalId: taskId,
      preset: presetForTopaz(topaz),
      priority: "normal",
      input: {
        videoPath: sourcePath,
        topaz
      },
      output: {
        directory: settings.downloadDir || this.config.downloadDir
      }
    };
  }

  private async resolveSourcePath(task: RuntimeSettingsAwareTopazTask) {
    if (task.topaz?.sourceLocalPath) return resolve(task.topaz.sourceLocalPath);
    if (task.topaz?.sourceTaskId) {
      const source = this.db.data.videoTasks.find((item) => item.id === task.topaz?.sourceTaskId);
      if (!source?.downloadPath) throw new Error("选择的源视频还没有本地下载文件。");
      return resolve(source.downloadPath);
    }
    throw new Error("视频放大需要选择源视频。");
  }

  private async currentSettings() {
    const settings = await this.runtimeSettings?.();
    return {
      maxConcurrentTopazTasks: parsePositiveInteger(settings?.maxConcurrentTopazTasks, this.config.maxConcurrentTopazTasks ?? 1)
    };
  }

  private async fullSettings(): Promise<RuntimeSettings> {
    const settings = await this.runtimeSettings?.();
    return {
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
      topazEnabled: String(this.config.topazEnabled ?? false),
      topazCLIPath: this.config.topazCLIPath ?? "topaz-video",
      topazWorkDir: this.config.topazWorkDir ?? "data/topaz",
      maxConcurrentTopazTasks: String(this.config.maxConcurrentTopazTasks ?? 1),
      topazDefaultAIModel: this.config.topazDefaultAIModel ?? "prob-4",
      strangeOrchestratorURL: this.config.strangeOrchestratorURL,
      tokenPricePerThousand: String(this.config.tokenPricePerThousand),
      imageTokenPricePerThousand: String(this.config.imageTokenPricePerThousand ?? this.config.tokenPricePerThousand),
      image2APIKey: this.config.image2APIKey ?? "",
      image2APIURL: this.config.image2APIURL ?? "",
      image2Model: this.config.image2Model ?? "",
      ...settings
    };
  }
}

function presetForTopaz(topaz: TopazTaskMetadata) {
  const modes = topaz.processModes?.length ? topaz.processModes : [topaz.processMode];
  if (modes.includes("interpolate")) return "topaz.interpolate.chronos_60fps";
  if (topaz.targetPreset === "4k") return "topaz.upscale.proteus_4k";
  return "topaz.upscale.proteus_2x";
}

function outputPathFromJob(job: OrchestratorJobRecord) {
  const value = job.output.path ?? job.output.videoPath ?? job.output.outputPath;
  return typeof value === "string" ? value : undefined;
}

function isTerminalOrchestratorStatus(status: OrchestratorJobRecord["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

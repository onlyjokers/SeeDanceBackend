import type { AppConfig } from "./config.js";
import type { AppDB } from "./db.js";
import { addPollLog, updateVideoTask } from "./db.js";
import type { RuntimeSettings } from "../types.js";
import { errorMessage } from "./retry.js";
import type { TopazProcessResult } from "./topazClient.js";
import { resolve } from "node:path";

type Job = () => Promise<void>;
type RuntimeSettingsProvider = () => RuntimeSettings | Promise<RuntimeSettings>;

export interface TopazClientLike {
  process(input: {
    taskId: string;
    sourcePath: string;
    settings: RuntimeSettings;
    topaz: NonNullable<RuntimeSettingsAwareTopazTask["topaz"]>;
  }): Promise<TopazProcessResult>;
}

interface RuntimeSettingsAwareTopazTask {
  id: string;
  topaz?: {
    sourceTaskId?: string;
    sourceLocalPath?: string;
    processMode: "upscale" | "enhance" | "stabilize" | "interpolate";
    processModes?: Array<"upscale" | "enhance" | "stabilize" | "interpolate">;
    aiModel: string;
    targetPreset: "2k" | "4k" | "8k" | "2x" | "4x" | "8x";
    codec: string;
    bitrate?: string;
    qv?: number;
    crf?: number;
    qualityParams?: Record<string, number | boolean | string>;
  };
}

export class TopazTaskRunner {
  private queue: Job[] = [];
  private activeCount = 0;

  constructor(
    private readonly db: AppDB,
    private readonly topazClient: TopazClientLike,
    private readonly config: AppConfig,
    private readonly runtimeSettings?: RuntimeSettingsProvider
  ) {}

  enqueue(taskId: string) {
    this.queue.push(async () => {
      await this.processTask(taskId);
    });
    void this.drain();
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
      await addPollLog(this.db, taskId, "Topaz 视频放大开始", task.topaz);
      const settings = await this.fullSettings();
      const sourcePath = await this.resolveSourcePath(task);
      const result = await this.topazClient.process({
        taskId,
        sourcePath,
        settings,
        topaz: task.topaz
      });
      await updateVideoTask(this.db, taskId, {
        status: "succeeded",
        downloadPath: result.outputPath,
        topaz: {
          ...task.topaz,
          sourceLocalPath: sourcePath,
          sourceInfo: result.sourceInfo,
          scale: result.scale,
          outputPath: result.outputPath,
          outputSize: result.outputSize,
          durationMs: result.durationMs
        },
        raw: result.raw
      });
      await addPollLog(this.db, taskId, `Topaz 视频放大已完成：${result.outputPath}`, {
        ...(isRecord(result.raw) ? result.raw : {}),
        outputPath: result.outputPath,
        outputSize: result.outputSize,
        durationMs: result.durationMs,
        scale: result.scale
      });
    } catch (error) {
      await updateVideoTask(this.db, taskId, {
        status: "failed",
        errorMessage: errorMessage(error)
      });
      await addPollLog(this.db, taskId, "Topaz 视频放大失败", { error: errorMessage(error) });
    }
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
    const settings = this.runtimeSettings ? await this.runtimeSettings() : undefined;
    return {
      maxConcurrentTopazTasks: parsePositiveInteger(settings?.maxConcurrentTopazTasks, this.config.maxConcurrentTopazTasks ?? 1)
    };
  }

  private async fullSettings(): Promise<RuntimeSettings> {
    const settings = this.runtimeSettings ? await this.runtimeSettings() : undefined;
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
      tokenPricePerThousand: String(this.config.tokenPricePerThousand),
      imageTokenPricePerThousand: String(this.config.imageTokenPricePerThousand ?? this.config.tokenPricePerThousand),
      image2APIKey: this.config.image2APIKey ?? "",
      image2APIURL: this.config.image2APIURL ?? "",
      image2Model: this.config.image2Model ?? "",
      ...settings
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

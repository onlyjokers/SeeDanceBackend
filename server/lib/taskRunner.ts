import type { AppDB } from "./db.js";
import { addPollLog, updateVideoTask } from "./db.js";
import type { AppConfig } from "./config.js";
import type { VideoClient } from "./videoClient.js";
import { extractTokenUsage } from "./tokenUsage.js";
import { errorMessage, isUnknownSubmissionError, retryOperation } from "./retry.js";
import type { RuntimeSettings } from "../types.js";

type Job = () => Promise<void>;
type RuntimeSettingsProvider = () => RuntimeSettings | Promise<RuntimeSettings>;
export interface TaskRunContext {
  logRetry(label: string, attempt: number, maxRetries: number, message: string, raw?: unknown): Promise<void>;
}

export class SerialTaskRunner {
  private queue: Job[] = [];
  private active = false;

  constructor(
    private readonly db: AppDB,
    private readonly videoClient: VideoClient,
    private readonly config: AppConfig,
    private readonly runtimeSettings?: RuntimeSettingsProvider
  ) {}

  enqueue(taskId: string, run: (context: TaskRunContext) => Promise<{ remoteTaskId: string; raw: unknown }>) {
    this.queue.push(async () => {
      await this.processTask(taskId, run);
    });
    void this.drain();
  }

  private async drain() {
    if (this.active) return;
    this.active = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        if (job) await job();
      }
    } finally {
      this.active = false;
    }
  }

  private async processTask(taskId: string, createRemoteTask: (context: TaskRunContext) => Promise<{ remoteTaskId: string; raw: unknown }>) {
    try {
      await updateVideoTask(this.db, taskId, { status: "running" });
      const context: TaskRunContext = {
        logRetry: async (label, attempt, maxRetries, message, raw) => {
          await addPollLog(this.db, taskId, `${label}（${attempt}/${maxRetries}）：${message}`, {
            error: message,
            retryCount: attempt,
            maxRetryCount: maxRetries,
            raw
          });
        }
      };
      let created: { remoteTaskId: string; raw: unknown };
      try {
        created = await createRemoteTask(context);
      } catch (error) {
        if (isUnknownSubmissionError(error)) {
          const message = "网络波动，提交状态未知，请重新提交";
          await updateVideoTask(this.db, taskId, {
            status: "failed",
            errorMessage: message
          });
          await addPollLog(this.db, taskId, "视频任务提交状态未知", {
            error: errorMessage(error),
            userMessage: message
          });
          return;
        }
        throw error;
      }
      await updateVideoTask(this.db, taskId, {
        remoteTaskId: created.remoteTaskId,
        raw: created.raw
      });
      await addPollLog(this.db, taskId, "视频任务已提交", created.raw);

      const started = Date.now();
      let pollFailureCount = 0;
      while (Date.now() - started < this.config.pollTimeoutMs) {
        await sleep(this.config.pollIntervalMs);
        const settings = await this.currentSettings();
        let status: Awaited<ReturnType<VideoClient["getTask"]>>;
        try {
          status = await this.videoClient.getTask(created.remoteTaskId);
          pollFailureCount = 0;
        } catch (error) {
          pollFailureCount += 1;
          const message = error instanceof Error ? error.message : String(error);
          await addPollLog(this.db, taskId, `视频任务轮询失败（${pollFailureCount}/${settings.maxPollRetryCount}）：${message}`, {
            error: message,
            retryCount: pollFailureCount,
            maxRetryCount: settings.maxPollRetryCount
          });
          if (pollFailureCount > settings.maxPollRetryCount) throw error;
          continue;
        }
        await addPollLog(this.db, taskId, `视频任务状态：${status.status}`, status.raw);

        if (status.status === "failed") {
          await updateVideoTask(this.db, taskId, {
            status: "failed",
            errorMessage: status.errorMessage || "视频生成失败",
            raw: status.raw
          });
          return;
        }

        if (status.status === "succeeded") {
          if (!status.videoUrl) throw new Error("视频任务成功但没有返回视频 URL。");
          await updateVideoTask(this.db, taskId, {
            status: "succeeded",
            videoUrl: status.videoUrl,
            tokenUsage: extractTokenUsage(status.raw),
            raw: status.raw
          });
          let downloadPath: string | undefined;
          try {
            const settings = await this.currentSettings();
            downloadPath = await retryOperation(() => this.videoClient.download(status.videoUrl!, taskId), {
              maxRetries: settings.maxPollRetryCount,
              delayMs: this.config.pollIntervalMs,
              onRetry: async ({ attempt, maxRetries, message }) => {
                await addPollLog(this.db, taskId, `视频下载失败（${attempt}/${maxRetries}）：${message}`, {
                  error: message,
                  retryCount: attempt,
                  maxRetryCount: maxRetries
                });
              }
            });
          } catch (error) {
            const message = `本地下载失败：${errorMessage(error)}`;
            await updateVideoTask(this.db, taskId, {
              status: "succeeded",
              videoUrl: status.videoUrl,
              tokenUsage: extractTokenUsage(status.raw),
              raw: status.raw,
              errorMessage: message
            });
            await addPollLog(this.db, taskId, message, { error: errorMessage(error) });
            return;
          }
          await updateVideoTask(this.db, taskId, {
            status: "succeeded",
            videoUrl: status.videoUrl,
            downloadPath,
            tokenUsage: extractTokenUsage(status.raw),
            raw: status.raw
          });
          await addPollLog(this.db, taskId, `视频已下载：${downloadPath}`, status.raw);
          return;
        }

        await updateVideoTask(this.db, taskId, {
          status: status.status,
          raw: status.raw
        });
      }

      throw new Error("视频生成轮询超时。");
    } catch (error) {
      await updateVideoTask(this.db, taskId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      await addPollLog(this.db, taskId, "视频任务失败", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async currentSettings() {
    const settings = this.runtimeSettings ? await this.runtimeSettings() : undefined;
    return {
      maxPollRetryCount: parseNonNegativeInteger(settings?.maxPollRetryCount, this.config.maxPollRetryCount)
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

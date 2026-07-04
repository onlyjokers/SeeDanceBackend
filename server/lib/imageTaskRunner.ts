import type { AppConfig } from "./config.js";
import type { AppDB } from "./db.js";
import { addPollLog, updateVideoTask } from "./db.js";
import type { ImageClient, ImageGenerationResult } from "./imageClient.js";
import { errorMessage, isUnknownSubmissionError, retryOperation } from "./retry.js";
import type { RuntimeSettings } from "../types.js";
import type { TaskRunContext } from "./taskRunner.js";

type Job = () => Promise<void>;
type RuntimeSettingsProvider = () => RuntimeSettings | Promise<RuntimeSettings>;

export class ImageTaskRunner {
  private queue: Job[] = [];
  private activeCount = 0;

  constructor(
    private readonly db: AppDB,
    private readonly imageClient: ImageClient,
    private readonly config: AppConfig,
    private readonly runtimeSettings?: RuntimeSettingsProvider
  ) {}

  enqueue(taskId: string, run: (context: TaskRunContext) => Promise<ImageGenerationResult>) {
    this.queue.push(async () => {
      await this.processTask(taskId, run);
    });
    void this.drain();
  }

  private async drain() {
    const settings = await this.currentSettings();
    while (this.activeCount < settings.maxConcurrentImageTasks && this.queue.length) {
      const job = this.queue.shift();
      if (!job) return;
      this.activeCount += 1;
      void job().finally(() => {
        this.activeCount -= 1;
        void this.drain();
      });
    }
  }

  private async processTask(taskId: string, createImages: (context: TaskRunContext) => Promise<ImageGenerationResult>) {
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

      let generated: ImageGenerationResult;
      try {
        generated = await createImages(context);
      } catch (error) {
        if (isUnknownSubmissionError(error)) {
          const message = "网络波动，图片生成状态未知，请重新提交";
          await updateVideoTask(this.db, taskId, {
            status: "failed",
            errorMessage: message
          });
          await addPollLog(this.db, taskId, "图片生成提交状态未知", {
            error: errorMessage(error),
            userMessage: message
          });
          return;
        }
        throw error;
      }

      await updateVideoTask(this.db, taskId, {
        status: "running",
        imageUrls: generated.imageUrls,
        tokenUsage: generated.tokenUsage,
        raw: generated.raw
      });
      await addPollLog(this.db, taskId, "图片生成已完成", generated.raw);

      const downloadPaths: string[] = [];
      try {
        const settings = await this.currentSettings();
        for (const [index, imageUrl] of generated.imageUrls.entries()) {
          const path = await retryOperation(() => this.imageClient.download(imageUrl, taskId, index), {
            maxRetries: settings.maxPollRetryCount,
            delayMs: this.config.pollIntervalMs,
            onRetry: async ({ attempt, maxRetries, message }) => {
              await addPollLog(this.db, taskId, `图片下载失败（${attempt}/${maxRetries}）：${message}`, {
                error: message,
                retryCount: attempt,
                maxRetryCount: maxRetries,
                imageIndex: index
              });
            }
          });
          downloadPaths.push(path);
        }
      } catch (error) {
        const message = `本地图片下载失败：${errorMessage(error)}`;
        await updateVideoTask(this.db, taskId, {
          status: "succeeded",
          imageUrls: generated.imageUrls,
          imageDownloadPaths: downloadPaths,
          tokenUsage: generated.tokenUsage,
          raw: generated.raw,
          errorMessage: message
        });
        await addPollLog(this.db, taskId, message, { error: errorMessage(error) });
        return;
      }

      await updateVideoTask(this.db, taskId, {
        status: "succeeded",
        imageUrls: generated.imageUrls,
        imageDownloadPaths: downloadPaths,
        tokenUsage: generated.tokenUsage,
        raw: generated.raw
      });
      await addPollLog(this.db, taskId, `图片已下载：${downloadPaths.join(", ")}`, generated.raw);
    } catch (error) {
      await updateVideoTask(this.db, taskId, {
        status: "failed",
        errorMessage: errorMessage(error)
      });
      await addPollLog(this.db, taskId, "图片任务失败", { error: errorMessage(error) });
    }
  }

  private async currentSettings() {
    const settings = this.runtimeSettings ? await this.runtimeSettings() : undefined;
    return {
      maxPollRetryCount: parseNonNegativeInteger(settings?.maxPollRetryCount, this.config.maxPollRetryCount),
      maxConcurrentImageTasks: parsePositiveInteger(settings?.maxConcurrentImageTasks, this.config.maxConcurrentImageTasks ?? 8)
    };
  }
}

function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

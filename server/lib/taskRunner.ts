import type { AppDB } from "./db.js";
import { addPollLog, updateVideoTask } from "./db.js";
import type { AppConfig } from "./config.js";
import type { VideoClient } from "./videoClient.js";

type Job = () => Promise<void>;

export class SerialTaskRunner {
  private queue: Job[] = [];
  private active = false;

  constructor(
    private readonly db: AppDB,
    private readonly videoClient: VideoClient,
    private readonly config: AppConfig
  ) {}

  enqueue(taskId: string, run: () => Promise<{ remoteTaskId: string; raw: unknown }>) {
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

  private async processTask(taskId: string, createRemoteTask: () => Promise<{ remoteTaskId: string; raw: unknown }>) {
    try {
      await updateVideoTask(this.db, taskId, { status: "running" });
      const created = await createRemoteTask();
      await updateVideoTask(this.db, taskId, {
        remoteTaskId: created.remoteTaskId,
        raw: created.raw
      });
      await addPollLog(this.db, taskId, "视频任务已提交", created.raw);

      const started = Date.now();
      while (Date.now() - started < this.config.pollTimeoutMs) {
        await sleep(this.config.pollIntervalMs);
        const status = await this.videoClient.getTask(created.remoteTaskId);
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
          const downloadPath = await this.videoClient.download(status.videoUrl, taskId);
          await updateVideoTask(this.db, taskId, {
            status: "succeeded",
            videoUrl: status.videoUrl,
            downloadPath,
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
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

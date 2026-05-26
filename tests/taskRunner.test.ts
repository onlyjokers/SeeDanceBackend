import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../server/lib/config.js";
import { createVideoTask, openDB } from "../server/lib/db.js";
import { parseVideoTaskRequest } from "../server/lib/requestSchemas.js";
import { runtimeSettingsFromConfig } from "../server/lib/runtimeSettings.js";
import { SerialTaskRunner } from "../server/lib/taskRunner.js";
import type { VideoClient } from "../server/lib/videoClient.js";

const config: AppConfig = {
  port: 8787,
  host: "0.0.0.0",
  databasePath: "data/seendance.json",
  sqlitePath: "data/seendance.sqlite",
  downloadDir: "data/downloads",
  uploadDir: "data/uploads",
  volcengineAK: "",
  volcengineSK: "",
  volcengineRegion: "cn-beijing",
  volcengineService: "ark",
  arkAPIKey: "",
  arkVideoModel: "ep",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "",
  pollIntervalMs: 1,
  pollTimeoutMs: 1000,
  maxPollRetryCount: 5,
  maxConcurrentVideoTasks: 3
};

describe("SerialTaskRunner", () => {
  it("starts multiple video tasks concurrently up to the configured limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const first = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    const second = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "山间道路",
      references: []
    }));
    const videoClient = {
      getTask: vi.fn().mockResolvedValue({
        status: "succeeded",
        videoUrl: "https://example.test/video.mp4",
        raw: { status: "succeeded" }
      }),
      download: vi.fn().mockResolvedValue(join(dir, "video.mp4"))
    } as unknown as VideoClient;
    let activeSubmissions = 0;
    let maxActiveSubmissions = 0;
    let releaseFirstSubmission!: () => void;
    const firstSubmissionBlocked = new Promise<void>((resolve) => {
      releaseFirstSubmission = resolve;
    });

    const runner = new SerialTaskRunner(db, videoClient, {
      ...config,
      maxConcurrentVideoTasks: 2
    });
    const enqueueTask = (taskId: string, remoteTaskId: string) => {
      runner.enqueue(taskId, async () => {
        activeSubmissions += 1;
        maxActiveSubmissions = Math.max(maxActiveSubmissions, activeSubmissions);
        if (remoteTaskId === "remote-1") await firstSubmissionBlocked;
        activeSubmissions -= 1;
        return {
          remoteTaskId,
          raw: { id: remoteTaskId }
        };
      });
    };

    enqueueTask(first.id, "remote-1");
    enqueueTask(second.id, "remote-2");

    await waitForCondition(() => maxActiveSubmissions === 2);
    releaseFirstSubmission();
    await waitForTaskStatus(db, first.id);
    await waitForTaskStatus(db, second.id);

    expect(maxActiveSubmissions).toBe(2);
  });

  it("continues polling when transient status fetches fail within the retry limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    const videoClient = {
      getTask: vi.fn()
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce({
          status: "succeeded",
          videoUrl: "https://example.test/video.mp4",
          raw: { status: "succeeded" }
        }),
      download: vi.fn().mockResolvedValue(join(dir, "video.mp4"))
    } as unknown as VideoClient;

    new SerialTaskRunner(db, videoClient, config).enqueue(task.id, async () => ({
      remoteTaskId: "remote-1",
      raw: { id: "remote-1" }
    }));

    const completed = await waitForTaskStatus(db, task.id);
    expect(completed?.status).toBe("succeeded");
    expect(videoClient.getTask).toHaveBeenCalledTimes(6);
    expect(db.data.pollLogs.some((log) => log.message.includes("视频任务轮询失败（5/5）"))).toBe(true);
  });

  it("marks the task failed after exceeding the consecutive polling retry limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    const videoClient = {
      getTask: vi.fn().mockRejectedValue(new Error("fetch failed")),
      download: vi.fn()
    } as unknown as VideoClient;

    new SerialTaskRunner(db, videoClient, config).enqueue(task.id, async () => ({
      remoteTaskId: "remote-1",
      raw: { id: "remote-1" }
    }));

    const completed = await waitForTaskStatus(db, task.id);
    expect(completed?.status).toBe("failed");
    expect(completed?.errorMessage).toBe("fetch failed");
    expect(videoClient.getTask).toHaveBeenCalledTimes(6);
  });

  it("uses manager runtime settings to decide the current polling retry limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    const videoClient = {
      getTask: vi.fn().mockRejectedValue(new Error("fetch failed")),
      download: vi.fn()
    } as unknown as VideoClient;

    new SerialTaskRunner(db, videoClient, config, () => ({
      ...runtimeSettingsFromConfig(config),
      maxPollRetryCount: "1"
    })).enqueue(task.id, async () => ({
      remoteTaskId: "remote-1",
      raw: { id: "remote-1" }
    }));

    const completed = await waitForTaskStatus(db, task.id);
    expect(completed?.status).toBe("failed");
    expect(videoClient.getTask).toHaveBeenCalledTimes(2);
  });

  it("keeps a remote succeeded task succeeded when local video download keeps failing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    const videoClient = {
      getTask: vi.fn().mockResolvedValue({
        status: "succeeded",
        videoUrl: "https://example.test/video.mp4",
        raw: { status: "succeeded", usage: { total_tokens: 12 } }
      }),
      download: vi.fn().mockRejectedValue(new Error("fetch failed"))
    } as unknown as VideoClient;

    new SerialTaskRunner(db, videoClient, config, () => ({
      ...runtimeSettingsFromConfig(config),
      maxPollRetryCount: "2"
    })).enqueue(task.id, async () => ({
      remoteTaskId: "remote-1",
      raw: { id: "remote-1" }
    }));

    const completed = await waitForTask(db, task.id, (item) => item.errorMessage?.includes("本地下载失败") === true);
    expect(completed?.status).toBe("succeeded");
    expect(completed?.videoUrl).toBe("https://example.test/video.mp4");
    expect(completed?.downloadPath).toBeUndefined();
    expect(completed?.errorMessage).toContain("本地下载失败");
    expect(videoClient.download).toHaveBeenCalledTimes(3);
    expect(db.data.pollLogs.some((log) => log.message.includes("视频下载失败（2/2）"))).toBe(true);
  });

  it("reports unknown submission state when remote task creation fails with a network error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    const videoClient = {
      getTask: vi.fn(),
      download: vi.fn()
    } as unknown as VideoClient;

    new SerialTaskRunner(db, videoClient, config).enqueue(task.id, async () => {
      throw new Error("fetch failed");
    });

    const completed = await waitForTaskStatus(db, task.id);
    expect(completed?.status).toBe("failed");
    expect(completed?.errorMessage).toBe("网络波动，提交状态未知，请重新提交");
    expect(db.data.pollLogs.some((log) => log.message.includes("视频任务提交状态未知"))).toBe(true);
    expect(videoClient.getTask).not.toHaveBeenCalled();
  });

  it("records transient reference refresh failures before submitting the remote task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "multimodal",
      prompt: "图片 1 的人物转身",
      references: [{
        role: "reference",
        sourceUrl: "https://example.test/ref.png",
        localPath: join(dir, "ref.png"),
        localUrl: "/api/uploads/local/ref.png",
        assetType: "Image"
      }]
    }));
    const videoClient = {
      getTask: vi.fn().mockResolvedValue({
        status: "succeeded",
        videoUrl: "https://example.test/video.mp4",
        raw: { status: "succeeded" }
      }),
      download: vi.fn().mockResolvedValue(join(dir, "video.mp4"))
    } as unknown as VideoClient;

    new SerialTaskRunner(db, videoClient, config, () => ({
      ...runtimeSettingsFromConfig(config),
      maxPollRetryCount: "2"
    })).enqueue(task.id, async (context) => {
      await context.logRetry("参考图片重新上传失败", 1, 2, "fetch failed");
      return {
        remoteTaskId: "remote-1",
        raw: { id: "remote-1" }
      };
    });

    const completed = await waitForTaskStatus(db, task.id);
    expect(completed?.status).toBe("succeeded");
    expect(db.data.pollLogs.some((log) => log.message.includes("参考图片重新上传失败（1/2）：fetch failed"))).toBe(true);
  });
});

async function waitForTaskStatus(db: Awaited<ReturnType<typeof openDB>>, taskId: string) {
  return waitForTask(db, taskId, (task) => task.status === "succeeded" || task.status === "failed");
}

async function waitForTask(
  db: Awaited<ReturnType<typeof openDB>>,
  taskId: string,
  predicate: (task: Awaited<ReturnType<typeof openDB>>["data"]["videoTasks"][number]) => boolean
) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const task = db.data.videoTasks.find((item) => item.id === taskId);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for task to complete.");
}

async function waitForCondition(predicate: () => boolean) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition.");
}

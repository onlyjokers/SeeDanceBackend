import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../server/lib/config.js";
import { createTopazTask, openDB } from "../server/lib/db.js";
import { parseTopazTaskRequest } from "../server/lib/requestSchemas.js";
import { TopazTaskRunner, type TopazClientLike } from "../server/lib/topazTaskRunner.js";

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
  maxPollRetryCount: 2,
  maxConcurrentVideoTasks: 3,
  maxConcurrentTopazTasks: 1,
  tokenPricePerThousand: 0.049085,
  topazEnabled: true,
  topazCLIPath: "topaz-video",
  topazWorkDir: "data/topaz",
  topazDefaultAIModel: "proteus",
  corsOrigin: ""
};

describe("TopazTaskRunner", () => {
  it("stores Topaz output as a succeeded video task without token usage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-topaz-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createTopazTask(db, parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceLocalPath: join(dir, "uploads", "source.mp4"),
      targetPreset: "2x"
    }));
    const topazClient: TopazClientLike = {
      process: vi.fn().mockResolvedValue({
        outputPath: join(dir, "downloads", "topaz.mp4"),
        outputSize: 1234,
        durationMs: 25,
        sourceInfo: { width: 1280, height: 720, duration: "5" },
        scale: 2,
        raw: { success: true }
      })
    };

    new TopazTaskRunner(db, topazClient, config).enqueue(task.id);

    const completed = await waitForTopazTaskStatus(db, task.id);
    expect(completed?.status).toBe("succeeded");
    expect(completed?.mediaType).toBe("video");
    expect(completed?.taskKind).toBe("video_upscale");
    expect(completed?.downloadPath).toContain("topaz.mp4");
    expect(completed?.tokenUsage).toBeUndefined();
    expect(completed?.topaz?.outputSize).toBe(1234);
    expect(db.data.pollLogs.some((log) => log.message.includes("Topaz 视频放大已完成"))).toBe(true);
  });

  it("uses the configured Topaz concurrency limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-topaz-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const first = await createTopazTask(db, parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceLocalPath: join(dir, "uploads", "first.mp4"),
      targetPreset: "2x"
    }));
    const second = await createTopazTask(db, parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceLocalPath: join(dir, "uploads", "second.mp4"),
      targetPreset: "2x"
    }));
    let active = 0;
    let maxActive = 0;
    const topazClient: TopazClientLike = {
      process: vi.fn().mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          outputPath: join(dir, "downloads", `${Date.now()}.mp4`),
          outputSize: 1,
          durationMs: 20,
          sourceInfo: { width: 1280, height: 720 },
          scale: 2,
          raw: {}
        };
      })
    };

    const runner = new TopazTaskRunner(db, topazClient, config);
    runner.enqueue(first.id);
    runner.enqueue(second.id);

    await waitForTopazTaskStatus(db, first.id);
    await waitForTopazTaskStatus(db, second.id);
    expect(maxActive).toBe(1);
  });
});

async function waitForTopazTaskStatus(db: Awaited<ReturnType<typeof openDB>>, taskId: string) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const task = db.data.videoTasks.find((item) => item.id === taskId);
    if (task && (task.status === "succeeded" || task.status === "failed")) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Topaz task to complete.");
}

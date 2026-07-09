import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../server/lib/config.js";
import { createTopazTask, openDB } from "../server/lib/db.js";
import { parseTopazTaskRequest } from "../server/lib/requestSchemas.js";
import { TopazTaskRunner, type TopazOrchestratorClientLike } from "../server/lib/topazTaskRunner.js";

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
  strangeOrchestratorURL: "http://127.0.0.1:8790",
  corsOrigin: ""
};

describe("TopazTaskRunner", () => {
  it("submits video upscale work to StrangeOrchestrator and stores the orchestrator job id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-topaz-orchestrator-"));
    const db = await openDB(join(dir, "db.json"));
    const sourcePath = join(dir, "uploads", "source.mp4");
    const task = await createTopazTask(db, parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceLocalPath: sourcePath,
      targetPreset: "4k"
    }));
    const orchestrator: TopazOrchestratorClientLike = {
      createJob: vi.fn().mockResolvedValue({ jobId: "orch-1", status: "queued" }),
      getJob: vi.fn().mockResolvedValue({
        id: "orch-1",
        status: "succeeded",
        output: { path: join(dir, "downloads", "orchestrated.mp4") }
      }),
      cancelJob: vi.fn(),
      getResources: vi.fn(),
      getPresets: vi.fn(),
      freeResources: vi.fn()
    };

    new TopazTaskRunner(db, orchestrator, config).enqueue(task.id);

    const completed = await waitForTopazTaskStatus(db, task.id);
    expect(orchestrator.createJob).toHaveBeenCalledWith({
      source: "SeeDanceTest",
      externalId: task.id,
      preset: "topaz.upscale.proteus_4k",
      priority: "normal",
      input: { videoPath: sourcePath, topaz: expect.objectContaining({ targetPreset: "4k" }) },
      output: { directory: "data/downloads" }
    });
    expect(completed?.orchestratorJobId).toBe("orch-1");
    expect(completed?.downloadPath).toContain("orchestrated.mp4");
    expect(completed?.status).toBe("succeeded");
  });

  it("stores Topaz output as a succeeded video task without token usage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-topaz-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createTopazTask(db, parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceLocalPath: join(dir, "uploads", "source.mp4"),
      targetPreset: "2x"
    }));
    const orchestrator = createFakeOrchestrator(join(dir, "downloads", "topaz.mp4"));

    new TopazTaskRunner(db, orchestrator, config).enqueue(task.id);

    const completed = await waitForTopazTaskStatus(db, task.id);
    expect(completed?.status).toBe("succeeded");
    expect(completed?.mediaType).toBe("video");
    expect(completed?.taskKind).toBe("video_upscale");
    expect(completed?.downloadPath).toContain("topaz.mp4");
    expect(completed?.tokenUsage).toBeUndefined();
    expect(completed?.topaz?.outputPath).toContain("topaz.mp4");
    expect(db.data.pollLogs.some((log) => log.message.includes("本机计算任务状态：succeeded"))).toBe(true);
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
    const orchestrator: TopazOrchestratorClientLike = {
      createJob: vi.fn().mockImplementation(async (payload) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          jobId: `orch-${payload.externalId}`,
          status: "queued"
        };
      }),
      getJob: vi.fn().mockImplementation(async (jobId) => ({
        id: jobId,
        source: "SeeDanceTest",
        preset: "topaz.upscale.proteus_2x",
        priority: "normal",
        input: {},
        output: { path: join(dir, "downloads", `${jobId}.mp4`) },
        status: "succeeded",
        progress: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      cancelJob: vi.fn(),
      getResources: vi.fn(),
      getPresets: vi.fn(),
      freeResources: vi.fn()
    };

    const runner = new TopazTaskRunner(db, orchestrator, config);
    runner.enqueue(first.id);
    runner.enqueue(second.id);

    await waitForTopazTaskStatus(db, first.id);
    await waitForTopazTaskStatus(db, second.id);
    expect(maxActive).toBe(1);
  });
});

function createFakeOrchestrator(outputPath: string): TopazOrchestratorClientLike {
  return {
    createJob: vi.fn().mockResolvedValue({ jobId: "orch-1", status: "queued" }),
    getJob: vi.fn().mockResolvedValue({
      id: "orch-1",
      source: "SeeDanceTest",
      preset: "topaz.upscale.proteus_2x",
      priority: "normal",
      input: {},
      output: { path: outputPath },
      status: "succeeded",
      progress: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    cancelJob: vi.fn(),
    getResources: vi.fn(),
    getPresets: vi.fn(),
    freeResources: vi.fn()
  };
}

async function waitForTopazTaskStatus(db: Awaited<ReturnType<typeof openDB>>, taskId: string) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const task = db.data.videoTasks.find((item) => item.id === taskId);
    if (task && (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled")) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Topaz task to complete.");
}

import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../server/lib/config.js";
import { createImageTask, openDB } from "../server/lib/db.js";
import { parseImageTaskRequest } from "../server/lib/requestSchemas.js";
import { runtimeSettingsFromConfig } from "../server/lib/runtimeSettings.js";
import { ImageTaskRunner } from "../server/lib/imageTaskRunner.js";
import type { ImageClient } from "../server/lib/imageClient.js";

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
  maxConcurrentImageTasks: 2,
  tokenPricePerThousand: 0.049085,
  imageTokenPricePerThousand: 0.049085,
  image2APIKey: "image-key",
  image2APIURL: "https://www.cctq.ai/v1/chat/completions",
  image2Model: "gpt-image-2",
  corsOrigin: ""
};

describe("ImageTaskRunner", () => {
  it("stores generated images locally and records token usage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-image-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createImageTask(db, parseImageTaskRequest({
      prompt: "产品海报",
      ratio: "1:1",
      references: []
    }));
    const imageClient = {
      generate: vi.fn().mockResolvedValue({
        raw: { id: "chatcmpl-1", usage: { total_tokens: 42 } },
        imageUrls: ["https://example.test/result.png"],
        tokenUsage: { inputTokens: 10, outputTokens: 32, totalTokens: 42 }
      }),
      download: vi.fn().mockImplementation(async (_url: string, taskId: string, index: number) => {
        const path = join(dir, `image-task-${taskId}-${index + 1}.png`);
        return path;
      })
    } as unknown as ImageClient;

    new ImageTaskRunner(db, imageClient, config).enqueue(task.id, async () => imageClient.generate({
      prompt: task.prompt,
      ratio: "1:1",
      imageResolution: task.imageResolution ?? "1k",
      imageQuality: task.imageQuality ?? "auto",
      references: task.references ?? []
    }));

    const completed = await waitForImageTaskStatus(db, task.id);
    expect(completed?.status).toBe("succeeded");
    expect(completed?.mediaType).toBe("image");
    expect(completed?.imageUrls).toEqual(["https://example.test/result.png"]);
    expect(completed?.imageDownloadPaths).toHaveLength(1);
    expect(completed?.tokenUsage?.totalTokens).toBe(42);
    expect(db.data.pollLogs.some((log) => log.message.includes("图片已下载"))).toBe(true);
  });

  it("reports unknown submission state when image generation fails with a network error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-image-runner-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createImageTask(db, parseImageTaskRequest({
      prompt: "产品海报",
      references: []
    }));
    const imageClient = {
      generate: vi.fn(),
      download: vi.fn()
    } as unknown as ImageClient;

    new ImageTaskRunner(db, imageClient, config).enqueue(task.id, async () => {
      throw new Error("fetch failed");
    });

    const completed = await waitForImageTaskStatus(db, task.id);
    expect(completed?.status).toBe("failed");
    expect(completed?.errorMessage).toBe("网络波动，图片生成状态未知，请重新提交");
    expect(db.data.pollLogs.some((log) => log.message.includes("图片生成提交状态未知"))).toBe(true);
  });
});

async function waitForImageTaskStatus(db: Awaited<ReturnType<typeof openDB>>, taskId: string) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const task = db.data.videoTasks.find((item) => item.id === taskId);
    if (task && (task.status === "succeeded" || task.status === "failed")) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for image task to complete.");
}

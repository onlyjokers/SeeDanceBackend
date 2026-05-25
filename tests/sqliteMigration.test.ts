import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { addPollLog, createVideoTask, getStorageStats, openDB, updateVideoTask } from "../server/lib/db.js";
import { parseVideoTaskRequest } from "../server/lib/requestSchemas.js";
import type { DatabaseShape } from "../server/types.js";

describe("SQLite persistence", () => {
  it("imports existing JSON data into SQLite without deleting or modifying the JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-sqlite-"));
    const jsonPath = join(dir, "seendance.json");
    const sqlitePath = join(dir, "seendance.sqlite");
    const oldData: DatabaseShape = {
      assetGroups: [{ id: "g1", name: "refs", description: "old", groupType: "AIGC", projectName: "QiShiYi" }],
      assets: [{ id: "a1", name: "ref", url: "https://example.test/ref.png", assetType: "Image", groupId: "g1", status: "Active", projectName: "QiShiYi" }],
      videoProjects: [{ id: "p1", name: "旧项目", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" }],
      videoTasks: [{
        id: "t1",
        projectId: "p1",
        prompt: "旧任务",
        assetIds: ["a1"],
        status: "succeeded",
        tokenUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        downloadPath: join(dir, "downloads", "video-task-t1.mp4"),
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:01:00.000Z"
      }],
      pollLogs: [{ id: "l1", taskId: "t1", message: "视频已下载", createdAt: "2026-05-01T00:01:00.000Z", raw: { ok: true } }],
      runtimeSettings: undefined
    };
    await writeFile(jsonPath, JSON.stringify(oldData, null, 2));
    const before = await readFile(jsonPath, "utf8");

    const db = await openDB(jsonPath, sqlitePath);

    expect(db.data.videoTasks).toHaveLength(1);
    expect(db.data.videoTasks[0]?.tokenUsage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
    expect(db.data.pollLogs[0]?.raw).toEqual({ ok: true });
    expect(await readFile(jsonPath, "utf8")).toBe(before);
    await expect(stat(sqlitePath)).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("persists task updates across reopen through SQLite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-sqlite-"));
    const jsonPath = join(dir, "seendance.json");
    const sqlitePath = join(dir, "seendance.sqlite");
    let db = await openDB(jsonPath, sqlitePath);
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    await updateVideoTask(db, task.id, {
      status: "succeeded",
      tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      downloadPath: join(dir, "downloads", "video.mp4")
    });
    await addPollLog(db, task.id, "视频已下载");

    db = await openDB(jsonPath, sqlitePath);

    expect(db.data.videoTasks.find((item) => item.id === task.id)?.tokenUsage?.totalTokens).toBe(30);
    expect(db.data.pollLogs.some((log) => log.taskId === task.id)).toBe(true);
  });

  it("reports storage usage, task count, and generated video count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-storage-"));
    const jsonPath = join(dir, "seendance.json");
    const sqlitePath = join(dir, "seendance.sqlite");
    const downloadDir = join(dir, "downloads");
    const uploadDir = join(dir, "uploads");
    await mkdir(downloadDir, { recursive: true });
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(downloadDir, "video.mp4"), new Uint8Array([1, 2, 3, 4]));
    await writeFile(join(uploadDir, "ref.png"), new Uint8Array([1, 2]));
    const db = await openDB(jsonPath, sqlitePath);
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    await updateVideoTask(db, task.id, {
      status: "succeeded",
      downloadPath: join(downloadDir, "video.mp4")
    });

    const stats = await getStorageStats(db, { databasePath: jsonPath, sqlitePath, downloadDir, uploadDir });

    expect(stats.tasks.total).toBe(1);
    expect(stats.tasks.generatedVideos).toBe(1);
    expect(stats.files.downloadBytes).toBe(4);
    expect(stats.files.uploadBytes).toBe(2);
    expect(stats.files.totalBytes).toBeGreaterThanOrEqual(6);
  });
});

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getDownloadPathForTask, getPreviewUrlForTask, openDownloadFolder } from "../server/lib/downloadFolder.js";
import type { VideoTask } from "../server/types.js";

describe("download folder opener", () => {
  it("opens the configured download directory as an absolute local path", async () => {
    const openedPaths: string[] = [];

    const openedPath = await openDownloadFolder("data/downloads", {
      open: async (path) => {
        openedPaths.push(path);
      }
    });

    expect(openedPath).toBe(resolve("data/downloads"));
    expect(openedPaths).toEqual([resolve("data/downloads")]);
  });

  it("resolves a downloaded video task to its local file path", () => {
    const task = {
      id: "task-1",
      prompt: "test",
      assetIds: [],
      status: "succeeded",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      downloadPath: "data/downloads/task-1.mp4"
    } satisfies VideoTask;

    expect(getDownloadPathForTask(task)).toBe(resolve("data/downloads/task-1.mp4"));
  });

  it("rejects a task without a downloaded file", () => {
    const task = {
      id: "task-1",
      prompt: "test",
      assetIds: [],
      status: "running",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z"
    } satisfies VideoTask;

    expect(() => getDownloadPathForTask(task)).toThrow("这个视频任务还没有本地下载文件。");
  });

  it("uses the local downloaded file for video preview when available", () => {
    const task = {
      id: "task-1",
      prompt: "test",
      assetIds: [],
      status: "succeeded",
      videoUrl: "https://example.com/remote.mp4",
      downloadPath: "data/downloads/task-1.mp4",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z"
    } satisfies VideoTask;

    expect(getPreviewUrlForTask(task)).toBe("/api/video-tasks/task-1/download");
  });
});

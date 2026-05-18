import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { addPollLog, createVideoTask, getExecutorVideoTasks, hardDeleteVideoTaskRecord, hideVideoTaskRecord, openDB } from "../server/lib/db.js";
import { parseVideoTaskRequest } from "../server/lib/requestSchemas.js";

describe("video task record deletion", () => {
  it("hides executor records without removing the task or its logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-db-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    await addPollLog(db, task.id, "视频任务状态：succeeded");
    await db.update((data) => {
      const current = data.videoTasks.find((item) => item.id === task.id);
      if (current) current.downloadPath = join(dir, "video.mp4");
    });

    await hideVideoTaskRecord(db, task.id);

    expect(db.data.videoTasks).toHaveLength(1);
    expect(db.data.videoTasks[0]?.hiddenAt).toBeTruthy();
    expect(db.data.pollLogs).toHaveLength(1);
    expect(getExecutorVideoTasks(db.data)).toEqual([]);
  });

  it("lets manager permanently remove a hidden task and its logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-db-"));
    const db = await openDB(join(dir, "db.json"));
    const task = await createVideoTask(db, parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道",
      references: []
    }));
    await addPollLog(db, task.id, "视频任务状态：succeeded");
    await hideVideoTaskRecord(db, task.id);

    await hardDeleteVideoTaskRecord(db, task.id);

    expect(db.data.videoTasks).toEqual([]);
    expect(db.data.pollLogs).toEqual([]);
  });
});

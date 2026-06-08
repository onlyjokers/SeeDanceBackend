import { describe, expect, it } from "vitest";
import { getExecutorVideoTaskPage, getManagerVideoTaskPage } from "../server/lib/db.js";
import type { DatabaseShape, VideoTask } from "../server/types.js";

const task = (input: Partial<VideoTask> & Pick<VideoTask, "id" | "projectId" | "createdAt">): VideoTask => ({
  prompt: input.prompt ?? input.id,
  assetIds: [],
  status: input.status ?? "succeeded",
  updatedAt: input.updatedAt ?? input.createdAt,
  ...input
});

describe("video task pagination", () => {
  const data: DatabaseShape = {
    assetGroups: [],
    assets: [],
    pollLogs: [],
    runtimeSettings: undefined,
    videoProjects: [
      { id: "p1", name: "项目一", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" },
      { id: "p2", name: "已删除", deletedAt: "2026-05-02T00:00:00.000Z", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-02T00:00:00.000Z" }
    ],
    videoTasks: [
      task({ id: "t4", projectId: "p1", createdAt: "2026-05-04T10:00:00.000Z", status: "running" }),
      task({ id: "t3", projectId: "p1", createdAt: "2026-05-03T10:00:00.000Z", prompt: "火锅广告" }),
      task({ id: "t2", projectId: "p1", createdAt: "2026-05-02T10:00:00.000Z", status: "failed" }),
      task({ id: "t1", projectId: "p1", createdAt: "2026-05-01T10:00:00.000Z", hiddenAt: "2026-05-01T11:00:00.000Z" }),
      task({ id: "deleted-project-task", projectId: "p2", createdAt: "2026-05-05T10:00:00.000Z" })
    ]
  };

  it("pages executor tasks by project and excludes hidden/deleted project tasks", () => {
    const first = getExecutorVideoTaskPage(data, { projectId: "p1", limit: 2 });
    const second = getExecutorVideoTaskPage(data, { projectId: "p1", limit: 2, before: first.nextCursor });

    expect(first.items.map((item) => item.id)).toEqual(["t4", "t3"]);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(["t2"]);
    expect(second.hasMore).toBe(false);
  });

  it("pages manager tasks with filters and stable cursors", () => {
    const first = getManagerVideoTaskPage(data, { limit: 1, query: "火锅", sort: "newest" });
    const failed = getManagerVideoTaskPage(data, { limit: 10, status: "failed" });
    const byProject = getManagerVideoTaskPage(data, { limit: 10, projectId: "p2" });

    expect(first.items.map((item) => item.id)).toEqual(["t3"]);
    expect(first.nextCursor).toBe("2026-05-03T10:00:00.000Z::t3");
    expect(failed.items.map((item) => item.id)).toEqual(["t2"]);
    expect(byProject.items.map((item) => item.id)).toEqual(["deleted-project-task"]);
  });

  it("continues manager pages from the cursor position for alternate sorts", () => {
    const first = getManagerVideoTaskPage(data, { limit: 2, sort: "oldest" });
    const second = getManagerVideoTaskPage(data, { limit: 2, sort: "oldest", before: first.nextCursor });

    expect(first.items.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(second.items.map((item) => item.id)).toEqual(["t3", "t4"]);
  });
});

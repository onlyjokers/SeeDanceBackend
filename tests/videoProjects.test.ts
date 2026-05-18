import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createVideoProject, createVideoTask, ensureDefaultVideoProject, openDB, renameVideoProject } from "../server/lib/db.js";
import { parseVideoTaskRequest } from "../server/lib/requestSchemas.js";

describe("video projects", () => {
  it("creates a default project and assigns video tasks to it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-projects-"));
    const db = await openDB(join(dir, "db.json"));

    const project = await ensureDefaultVideoProject(db);
    const task = await createVideoTask(db, parseVideoTaskRequest({
      projectId: project.id,
      mode: "text",
      prompt: "城市街道",
      references: []
    }));

    expect(db.data.videoProjects).toEqual([project]);
    expect(task.projectId).toBe(project.id);
  });

  it("creates empty projects without video tasks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-projects-"));
    const db = await openDB(join(dir, "db.json"));

    const project = await createVideoProject(db, "新项目");

    expect(project.name).toBe("新项目");
    expect(db.data.videoProjects).toHaveLength(1);
    expect(db.data.videoTasks).toEqual([]);
  });

  it("renames an existing project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-projects-"));
    const db = await openDB(join(dir, "db.json"));
    const project = await createVideoProject(db, "旧名字");

    const renamed = await renameVideoProject(db, project.id, "新名字");

    expect(renamed.name).toBe("新名字");
    expect(db.data.videoProjects[0].name).toBe("新名字");
  });
});

import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createVideoProject,
  createVideoTask,
  ensureDefaultVideoProject,
  getExecutorVideoProjects,
  getExecutorVideoTasks,
  openDB,
  renameVideoProject,
  restoreVideoProject,
  softDeleteVideoProject
} from "../server/lib/db.js";
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

  it("soft deletes a project without deleting its tasks or videos", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-projects-"));
    const db = await openDB(join(dir, "db.json"));
    const project = await createVideoProject(db, "旧项目");
    const task = await createVideoTask(db, parseVideoTaskRequest({
      projectId: project.id,
      mode: "text",
      prompt: "保留视频",
      references: []
    }));

    const deleted = await softDeleteVideoProject(db, project.id);

    expect(deleted.deletedAt).toBeTruthy();
    expect(db.data.videoProjects.find((item) => item.id === project.id)).toMatchObject({ id: project.id, deletedAt: expect.any(String) });
    expect(db.data.videoTasks.find((item) => item.id === task.id)).toMatchObject({ id: task.id, projectId: project.id, prompt: "保留视频" });
  });

  it("hides deleted projects and their tasks from executor state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-projects-"));
    const db = await openDB(join(dir, "db.json"));
    const keptProject = await createVideoProject(db, "保留项目");
    const deletedProject = await createVideoProject(db, "删除项目");
    const keptTask = await createVideoTask(db, parseVideoTaskRequest({
      projectId: keptProject.id,
      mode: "text",
      prompt: "可见任务",
      references: []
    }));
    await createVideoTask(db, parseVideoTaskRequest({
      projectId: deletedProject.id,
      mode: "text",
      prompt: "隐藏任务",
      references: []
    }));

    await softDeleteVideoProject(db, deletedProject.id);

    expect(getExecutorVideoProjects(db.data).map((project) => project.id)).toEqual([keptProject.id]);
    expect(getExecutorVideoTasks(db.data).map((task) => task.id)).toEqual([keptTask.id]);
  });

  it("restores a deleted project for executor visibility", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-projects-"));
    const db = await openDB(join(dir, "db.json"));
    const project = await createVideoProject(db, "待恢复项目");
    await softDeleteVideoProject(db, project.id);

    const restored = await restoreVideoProject(db, project.id);

    expect(restored.deletedAt).toBeUndefined();
    expect(getExecutorVideoProjects(db.data).map((item) => item.id)).toContain(project.id);
  });

  it("creates a new default project when the last active project is deleted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-projects-"));
    const db = await openDB(join(dir, "db.json"));
    const project = await createVideoProject(db, "唯一项目");

    await softDeleteVideoProject(db, project.id);

    const activeProjects = getExecutorVideoProjects(db.data);
    expect(activeProjects).toHaveLength(1);
    expect(activeProjects[0]?.name).toBe("默认项目");
    expect(db.data.videoProjects.find((item) => item.id === project.id)?.deletedAt).toBeTruthy();
  });
});

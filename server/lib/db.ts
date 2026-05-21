import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { JSONFilePreset } from "lowdb/node";
import type { AppConfig } from "./config.js";
import { nonBlankRuntimeSettings, runtimeSettingsFromConfig, trimRuntimeSettings } from "./runtimeSettings.js";
import type { Asset, AssetGroup, DatabaseShape, PollLog, RuntimeSettings, VideoProject, VideoTask } from "../types.js";
import type { VideoTaskRequest } from "./requestSchemas.js";

const defaultData: DatabaseShape = {
  assetGroups: [],
  assets: [],
  videoProjects: [],
  videoTasks: [],
  pollLogs: []
};

export const defaultRuntimeSettings: RuntimeSettings = {
  port: "8787",
  host: "0.0.0.0",
  databasePath: "data/seendance.json",
  downloadDir: "data/downloads",
  uploadDir: "data/uploads",
  volcengineAK: "",
  volcengineSK: "",
  volcengineRegion: "cn-beijing",
  volcengineService: "ark",
  arkAPIKey: "",
  arkVideoModel: "ep-20260518141207-xbt4q",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "",
  pollIntervalSeconds: "5",
  pollTimeoutSeconds: "900"
};

export type AppDB = Awaited<ReturnType<typeof openDB>>;

export async function openDB(path: string) {
  await mkdir(dirname(path), { recursive: true });
  const db = await JSONFilePreset<DatabaseShape>(path, structuredClone(defaultData));
  db.data.videoProjects ??= [];
  db.data.runtimeSettings ??= undefined;
  return db;
}

export async function getRuntimeSettings(db: AppDB, config: AppConfig): Promise<RuntimeSettings> {
  const settings = {
    ...defaultRuntimeSettings,
    ...runtimeSettingsFromConfig(config),
    ...nonBlankRuntimeSettings(db.data.runtimeSettings)
  };
  if (!db.data.runtimeSettings) {
    await updateRuntimeSettings(db, settings);
  }
  return settings;
}

export async function updateRuntimeSettings(db: AppDB, patch: Partial<RuntimeSettings>): Promise<RuntimeSettings> {
  const next: RuntimeSettings = {
    ...defaultRuntimeSettings,
    ...(db.data.runtimeSettings ?? {}),
    ...trimRuntimeSettings(patch)
  };
  await db.update((data) => {
    data.runtimeSettings = next;
  });
  return next;
}

export async function upsertAssetGroup(db: AppDB, group: AssetGroup) {
  await db.update((data) => {
    const index = data.assetGroups.findIndex((item) => item.id === group.id);
    if (index >= 0) data.assetGroups[index] = { ...data.assetGroups[index], ...group };
    else data.assetGroups.unshift(group);
  });
}

export async function upsertAsset(db: AppDB, asset: Asset) {
  await db.update((data) => {
    const index = data.assets.findIndex((item) => item.id === asset.id);
    if (index >= 0) data.assets[index] = { ...data.assets[index], ...asset };
    else data.assets.unshift(asset);
  });
}

export async function deleteAsset(db: AppDB, id: string) {
  await db.update((data) => {
    data.assets = data.assets.filter((asset) => asset.id !== id);
  });
}

export async function ensureDefaultVideoProject(db: AppDB): Promise<VideoProject> {
  let project = db.data.videoProjects[0];
  const needsProject = !project;
  const needsBackfill = db.data.videoTasks.some((task) => !task.projectId);
  if (!needsProject && !needsBackfill) return project;

  await db.update((data) => {
    if (!project) {
      const now = new Date().toISOString();
      project = {
        id: crypto.randomUUID(),
        name: "默认项目",
        createdAt: now,
        updatedAt: now
      };
      data.videoProjects.unshift(project);
    }
    data.videoTasks.forEach((task) => {
      task.projectId ??= project!.id;
    });
  });
  return project;
}

export async function createVideoProject(db: AppDB, name: string): Promise<VideoProject> {
  const now = new Date().toISOString();
  const project: VideoProject = {
    id: crypto.randomUUID(),
    name: name.trim() || "未命名项目",
    createdAt: now,
    updatedAt: now
  };
  await db.update((data) => {
    data.videoProjects ??= [];
    data.videoProjects.unshift(project);
  });
  return project;
}

export async function renameVideoProject(db: AppDB, id: string, name: string): Promise<VideoProject> {
  let project: VideoProject | undefined;
  await db.update((data) => {
    project = data.videoProjects.find((item) => item.id === id);
    if (!project) return;
    project.name = name.trim() || "未命名项目";
    project.updatedAt = new Date().toISOString();
  });
  if (!project) throw new Error("项目不存在。");
  return project;
}

export async function createVideoTask(db: AppDB, input: VideoTaskRequest, assetIds: string[] = []): Promise<VideoTask> {
  const now = new Date().toISOString();
  const project = input.projectId
    ? db.data.videoProjects.find((item) => item.id === input.projectId) ?? await ensureDefaultVideoProject(db)
    : await ensureDefaultVideoProject(db);
  const task: VideoTask = {
    id: crypto.randomUUID(),
    projectId: project.id,
    prompt: input.prompt,
    assetIds,
    mode: input.mode,
    referenceTransport: input.referenceTransport,
    modelVersion: input.modelVersion,
    ratio: input.ratio,
    duration: input.duration,
    resolution: input.resolution,
    references: input.references,
    status: "queued",
    createdAt: now,
    updatedAt: now
  };
  await db.update((data) => {
    data.videoTasks.unshift(task);
  });
  return task;
}

export async function updateVideoTask(db: AppDB, id: string, patch: Partial<VideoTask>) {
  await db.update((data) => {
    const task = data.videoTasks.find((item) => item.id === id);
    if (task) Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  });
}

export async function hideVideoTaskRecord(db: AppDB, id: string) {
  await db.update((data) => {
    const task = data.videoTasks.find((item) => item.id === id);
    if (task) Object.assign(task, { hiddenAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
}

export function getExecutorVideoTasks(data: DatabaseShape) {
  return data.videoTasks.filter((task) => !task.hiddenAt);
}

export async function hardDeleteVideoTaskRecord(db: AppDB, id: string) {
  await db.update((data) => {
    data.videoTasks = data.videoTasks.filter((task) => task.id !== id);
    data.pollLogs = data.pollLogs.filter((log) => log.taskId !== id);
  });
}

export const deleteVideoTaskRecord = hardDeleteVideoTaskRecord;

export async function addPollLog(db: AppDB, taskId: string, message: string, raw?: unknown) {
  const log: PollLog = {
    id: crypto.randomUUID(),
    taskId,
    message,
    raw,
    createdAt: new Date().toISOString()
  };
  await db.update((data) => {
    data.pollLogs.unshift(log);
    data.pollLogs = data.pollLogs.slice(0, 500);
  });
}

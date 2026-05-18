import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { JSONFilePreset } from "lowdb/node";
import type { Asset, AssetGroup, DatabaseShape, PollLog, VideoTask } from "../types.js";

const defaultData: DatabaseShape = {
  assetGroups: [],
  assets: [],
  videoTasks: [],
  pollLogs: []
};

export type AppDB = Awaited<ReturnType<typeof openDB>>;

export async function openDB(path: string) {
  await mkdir(dirname(path), { recursive: true });
  return JSONFilePreset<DatabaseShape>(path, structuredClone(defaultData));
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

export async function createVideoTask(db: AppDB, prompt: string, assetIds: string[]): Promise<VideoTask> {
  const now = new Date().toISOString();
  const task: VideoTask = {
    id: crypto.randomUUID(),
    prompt,
    assetIds,
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

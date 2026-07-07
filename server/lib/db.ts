import { access, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeImage2APIURL, normalizeImage2Model, type AppConfig } from "./config.js";
import { nonBlankRuntimeSettings, runtimeSettingsFromConfig, trimRuntimeSettings } from "./runtimeSettings.js";
import type { Asset, AssetGroup, DatabaseShape, PollLog, RuntimeSettings, StorageStats, VideoProject, VideoTask } from "../types.js";
import type { ImageTaskRequest, TopazTaskRequest, VideoTaskRequest } from "./requestSchemas.js";
import { imageRatios, imageResolutions, imageSizeOptionForSize, resolveImageSize, type ImageRatio, type ImageResolution, type MediaType } from "./payloads.js";

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
  sqlitePath: "data/seendance.sqlite",
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
  pollTimeoutSeconds: "3600",
  maxPollRetryCount: "5",
  maxConcurrentVideoTasks: "100",
  maxConcurrentImageTasks: "8",
  topazEnabled: "true",
  topazCLIPath: "topaz-video",
  topazWorkDir: "data/topaz",
  maxConcurrentTopazTasks: "1",
  topazDefaultAIModel: "prob-4",
  tokenPricePerThousand: "0.049085",
  imageTokenPricePerThousand: "0.049085",
  image2APIKey: "",
  image2APIURL: "https://www.cctq.ai/v1/images/generations",
  image2Model: "gpt-image-2"
};

type DatabaseUpdater = (data: DatabaseShape) => void | Promise<void>;

export interface AppDB {
  data: DatabaseShape;
  update(updater: DatabaseUpdater): Promise<void>;
  sqlitePath: string;
  jsonPath: string;
}

export async function openDB(jsonPath: string, sqlitePath = sqlitePathFromJsonPath(jsonPath)): Promise<AppDB> {
  await mkdir(dirname(sqlitePath), { recursive: true });
  await mkdir(dirname(jsonPath), { recursive: true });
  const sqlite = new DatabaseSync(sqlitePath);
  initializeSQLite(sqlite);
  if (!hasStoredSnapshot(sqlite)) {
    const imported = await readLegacyJson(jsonPath);
    writeSnapshot(sqlite, normalizeData(imported ?? defaultData));
  }
  const db: AppDB = {
    data: readSnapshot(sqlite),
    sqlitePath,
    jsonPath,
    update: async (updater) => {
      await updater(db.data);
      db.data = normalizeData(db.data);
      writeSnapshot(sqlite, db.data);
    }
  };
  return db;
}

export async function getRuntimeSettings(db: AppDB, config: AppConfig): Promise<RuntimeSettings> {
  const originalStoredSettings = nonBlankRuntimeSettings(db.data.runtimeSettings);
  const storedSettings = migrateRuntimeSettingsDefaults(originalStoredSettings, config);
  const settings = {
    ...defaultRuntimeSettings,
    ...runtimeSettingsFromConfig(config),
    ...storedSettings
  };
  const needsSettingsMigration = storedSettings.pollTimeoutSeconds !== originalStoredSettings.pollTimeoutSeconds
    || storedSettings.image2APIURL !== originalStoredSettings.image2APIURL
    || storedSettings.image2Model !== originalStoredSettings.image2Model;
  if (!db.data.runtimeSettings || needsSettingsMigration) {
    await updateRuntimeSettings(db, settings);
  }
  return settings;
}

function migrateRuntimeSettingsDefaults(settings: Partial<RuntimeSettings>, config: AppConfig): Partial<RuntimeSettings> {
  const next = { ...settings };
  const envTimeout = String(config.pollTimeoutMs / 1000);
  if (next.pollTimeoutSeconds === "900" || next.pollTimeoutSeconds === "1800") {
    next.pollTimeoutSeconds = envTimeout;
  }
  if (next.image2APIURL) next.image2APIURL = normalizeImage2APIURL(next.image2APIURL);
  if (next.image2Model) next.image2Model = normalizeImage2Model(next.image2Model);
  return next;
}

export async function updateRuntimeSettings(db: AppDB, patch: Partial<RuntimeSettings>): Promise<RuntimeSettings> {
  const next: RuntimeSettings = {
    ...defaultRuntimeSettings,
    ...(db.data.runtimeSettings ?? {}),
    ...trimRuntimeSettings(patch)
  };
  next.image2APIURL = normalizeImage2APIURL(next.image2APIURL ?? "https://www.cctq.ai/v1/images/generations");
  next.image2Model = normalizeImage2Model(next.image2Model ?? "gpt-image-2");
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
  let project = db.data.videoProjects.find((item) => !item.deletedAt);
  const needsProject = !project;
  const needsBackfill = db.data.videoTasks.some((task) => !task.projectId);
  if (project && !needsProject && !needsBackfill) return project;

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
  if (!project) throw new Error("默认项目创建失败。");
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

export async function softDeleteVideoProject(db: AppDB, id: string): Promise<VideoProject> {
  let project: VideoProject | undefined;
  await db.update((data) => {
    project = data.videoProjects.find((item) => item.id === id);
    if (!project) return;
    const now = new Date().toISOString();
    project.deletedAt ??= now;
    project.updatedAt = now;
    if (!data.videoProjects.some((item) => !item.deletedAt)) {
      data.videoProjects.unshift({
        id: crypto.randomUUID(),
        name: "默认项目",
        createdAt: now,
        updatedAt: now
      });
    }
  });
  if (!project) throw new Error("项目不存在。");
  return project;
}

export async function restoreVideoProject(db: AppDB, id: string): Promise<VideoProject> {
  let project: VideoProject | undefined;
  await db.update((data) => {
    project = data.videoProjects.find((item) => item.id === id);
    if (!project) return;
    delete project.deletedAt;
    project.updatedAt = new Date().toISOString();
  });
  if (!project) throw new Error("项目不存在。");
  return project;
}

export async function createVideoTask(db: AppDB, input: VideoTaskRequest, assetIds: string[] = []): Promise<VideoTask> {
  const now = new Date().toISOString();
  const project = input.projectId
    ? db.data.videoProjects.find((item) => item.id === input.projectId && !item.deletedAt) ?? await ensureDefaultVideoProject(db)
    : await ensureDefaultVideoProject(db);
  const task: VideoTask = {
    id: crypto.randomUUID(),
    mediaType: "video",
    provider: "seedance",
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

export async function createImageTask(db: AppDB, input: ImageTaskRequest): Promise<VideoTask> {
  const now = new Date().toISOString();
  const project = input.projectId
    ? db.data.videoProjects.find((item) => item.id === input.projectId && !item.deletedAt) ?? await ensureDefaultVideoProject(db)
    : await ensureDefaultVideoProject(db);
  const task: VideoTask = {
    id: crypto.randomUUID(),
    taskKind: "image_generation",
    mediaType: "image",
    provider: "image2",
    projectId: project.id,
    prompt: input.prompt,
    assetIds: input.references.flatMap((reference) => reference.assetId ? [reference.assetId] : []),
    referenceTransport: input.referenceTransport,
    ratio: input.ratio,
    imageResolution: input.imageResolution,
    imageQuality: input.imageQuality,
    imageSize: input.size ?? resolveImageSize(input.ratio, input.imageResolution),
    references: input.references,
    imageModel: input.imageModel || db.data.runtimeSettings?.image2Model || defaultRuntimeSettings.image2Model,
    status: "queued",
    createdAt: now,
    updatedAt: now
  };
  await db.update((data) => {
    data.videoTasks.unshift(task);
  });
  return task;
}

export async function createTopazTask(db: AppDB, input: TopazTaskRequest): Promise<VideoTask> {
  const now = new Date().toISOString();
  const project = input.projectId
    ? db.data.videoProjects.find((item) => item.id === input.projectId && !item.deletedAt) ?? await ensureDefaultVideoProject(db)
    : await ensureDefaultVideoProject(db);
  const task: VideoTask = {
    id: crypto.randomUUID(),
    taskKind: "video_upscale",
    mediaType: "video",
    provider: "topaz",
    projectId: project.id,
    prompt: "Topaz 视频放大",
    assetIds: [],
    status: "queued",
    topaz: {
      sourceTaskId: input.sourceTaskId,
      sourceLocalPath: input.sourceLocalPath,
      processMode: input.processMode,
      processModes: input.processModes,
      aiModel: input.aiModel,
      targetPreset: input.targetPreset,
      codec: input.codec,
      bitrate: input.bitrate,
      qv: input.qv,
      crf: input.crf,
      qualityParams: input.qualityParams
    },
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
  const activeProjectIds = new Set(getExecutorVideoProjects(data).map((project) => project.id));
  return data.videoTasks.filter((task) => !task.hiddenAt && (!task.projectId || activeProjectIds.has(task.projectId)));
}

export function getExecutorVideoProjects(data: DatabaseShape) {
  return data.videoProjects.filter((project) => !project.deletedAt);
}

export interface VideoTaskPageInput {
  projectId?: string;
  mediaType?: "all" | MediaType;
  taskKind?: "all" | "video_generation" | "image_generation" | "video_upscale";
  limit?: number;
  before?: string;
  status?: "all" | VideoTask["status"] | "hidden";
  query?: string;
  sort?: "newest" | "oldest" | "status" | "project";
}

export interface VideoTaskPage {
  items: VideoTask[];
  nextCursor?: string;
  hasMore: boolean;
}

export function getExecutorVideoTaskPage(data: DatabaseShape, input: VideoTaskPageInput): VideoTaskPage {
  const activeProjectIds = new Set(getExecutorVideoProjects(data).map((project) => project.id));
  const projectId = input.projectId;
  const tasks = data.videoTasks
    .filter((task) => !task.hiddenAt && (!task.projectId || activeProjectIds.has(task.projectId)))
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => !input.mediaType || input.mediaType === "all" || mediaTypeOf(task) === input.mediaType)
    .filter((task) => !input.taskKind || input.taskKind === "all" || taskKindOf(task) === input.taskKind)
    .sort(compareTasksNewest);
  return paginateTasks(tasks, input.limit, input.before);
}

export function getManagerVideoTaskPage(data: DatabaseShape, input: VideoTaskPageInput): VideoTaskPage {
  const normalizedQuery = input.query?.trim().toLowerCase() ?? "";
  const projectNames = new Map(data.videoProjects.map((project) => [project.id, project.name]));
  const tasks = data.videoTasks
    .filter((task) => {
      if (input.projectId && task.projectId !== input.projectId) return false;
      if (input.mediaType && input.mediaType !== "all" && mediaTypeOf(task) !== input.mediaType) return false;
      if (input.taskKind && input.taskKind !== "all" && taskKindOf(task) !== input.taskKind) return false;
      if (input.status === "hidden" && !task.hiddenAt) return false;
      if (input.status && input.status !== "all" && input.status !== "hidden" && task.status !== input.status) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        task.id,
        task.remoteTaskId,
        task.prompt,
        task.modelVersion,
        task.imageModel,
        mediaTypeOf(task),
        task.status,
        projectNames.get(task.projectId ?? "")
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort(compareForManager(input.sort ?? "newest", projectNames));
  return paginateTasks(tasks, input.limit, input.before);
}

function paginateTasks(tasks: VideoTask[], rawLimit = 50, before?: string): VideoTaskPage {
  const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));
  const cursorIndex = before ? tasks.findIndex((task) => taskCursor(task) === before) : -1;
  const pageSource = cursorIndex >= 0 ? tasks.slice(cursorIndex + 1) : tasks;
  const items = pageSource.slice(0, limit);
  return {
    items,
    nextCursor: items.length ? taskCursor(items[items.length - 1]) : undefined,
    hasMore: pageSource.length > limit
  };
}

function taskCursor(task: VideoTask) {
  return `${task.createdAt}::${task.id}`;
}

function compareTasksNewest(a: VideoTask, b: VideoTask) {
  const created = b.createdAt.localeCompare(a.createdAt);
  return created || b.id.localeCompare(a.id);
}

function compareForManager(sort: NonNullable<VideoTaskPageInput["sort"]>, projectNames: Map<string, string>) {
  return (a: VideoTask, b: VideoTask) => {
    if (sort === "oldest") {
      const created = a.createdAt.localeCompare(b.createdAt);
      return created || a.id.localeCompare(b.id);
    }
    if (sort === "status") {
      return a.status.localeCompare(b.status) || compareTasksNewest(a, b);
    }
    if (sort === "project") {
      return (projectNames.get(a.projectId ?? "") ?? "").localeCompare(projectNames.get(b.projectId ?? "") ?? "", "zh-CN") || compareTasksNewest(a, b);
    }
    return compareTasksNewest(a, b);
  };
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

export async function getStorageStats(
  db: AppDB,
  paths: { databasePath: string; sqlitePath?: string; downloadDir: string; uploadDir: string }
): Promise<StorageStats> {
  const sqlitePath = paths.sqlitePath ?? db.sqlitePath;
  const [jsonBytes, sqliteBytes, downloadBytes, uploadBytes] = await Promise.all([
    fileSize(paths.databasePath),
    fileSize(sqlitePath),
    directorySize(paths.downloadDir),
    directorySize(paths.uploadDir)
  ]);
  const byStatus = {
    queued: db.data.videoTasks.filter((task) => task.status === "queued").length,
    running: db.data.videoTasks.filter((task) => task.status === "running").length,
    succeeded: db.data.videoTasks.filter((task) => task.status === "succeeded").length,
    failed: db.data.videoTasks.filter((task) => task.status === "failed").length
  };
  return {
    database: {
      jsonPath: paths.databasePath,
      sqlitePath,
      jsonBytes,
      sqliteBytes
    },
    files: {
      downloadDir: paths.downloadDir,
      uploadDir: paths.uploadDir,
      downloadBytes,
      uploadBytes,
      totalBytes: jsonBytes + sqliteBytes + downloadBytes + uploadBytes
    },
    tasks: {
      total: db.data.videoTasks.length,
      visible: db.data.videoTasks.filter((task) => !task.hiddenAt).length,
      hidden: db.data.videoTasks.filter((task) => task.hiddenAt).length,
      ...byStatus,
      generatedVideos: db.data.videoTasks.filter((task) => mediaTypeOf(task) === "video" && (task.videoUrl || task.downloadPath)).length,
      downloadedVideos: db.data.videoTasks.filter((task) => mediaTypeOf(task) === "video" && task.downloadPath).length,
      generatedImages: db.data.videoTasks.filter((task) => mediaTypeOf(task) === "image" && ((task.imageUrls?.length ?? 0) > 0 || (task.imageDownloadPaths?.length ?? 0) > 0)).length,
      downloadedImages: db.data.videoTasks.filter((task) => mediaTypeOf(task) === "image" && (task.imageDownloadPaths?.length ?? 0) > 0).length
    }
  };
}

function initializeSQLite(sqlite: DatabaseSync) {
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function hasStoredSnapshot(sqlite: DatabaseSync) {
  const row = sqlite.prepare("SELECT 1 AS ok FROM app_state WHERE id = 1").get();
  return Boolean(row);
}

function readSnapshot(sqlite: DatabaseSync): DatabaseShape {
  const row = sqlite.prepare("SELECT data FROM app_state WHERE id = 1").get();
  if (!row || typeof row.data !== "string") return normalizeData(defaultData);
  return normalizeData(JSON.parse(row.data));
}

function writeSnapshot(sqlite: DatabaseSync, data: DatabaseShape) {
  sqlite.prepare(`
    INSERT INTO app_state (id, data, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(JSON.stringify(normalizeData(data)), new Date().toISOString());
}

async function readLegacyJson(path: string): Promise<DatabaseShape | undefined> {
  try {
    const text = await readFile(path, "utf8");
    if (!text.trim()) return undefined;
    return JSON.parse(text) as DatabaseShape;
  } catch {
    return undefined;
  }
}

function normalizeData(data: Partial<DatabaseShape>): DatabaseShape {
  return {
    assetGroups: data.assetGroups ?? [],
    assets: data.assets ?? [],
    videoProjects: data.videoProjects ?? [],
    videoTasks: (data.videoTasks ?? []).map(normalizeTask),
    pollLogs: data.pollLogs ?? [],
    runtimeSettings: data.runtimeSettings
  };
}

function normalizeTask(task: VideoTask): VideoTask {
  const normalized: VideoTask = {
    taskKind: "video_generation",
    mediaType: "video",
    ...task
  };
  if (mediaTypeOf(normalized) === "image") {
    normalized.taskKind ??= "image_generation";
    const legacySize = imageSizeOptionForSize(normalized.imageSize);
    const existingResolution = imageResolutions.includes(normalized.imageResolution as ImageResolution)
      ? normalized.imageResolution as ImageResolution
      : undefined;
    normalized.ratio ??= legacySize?.ratio ?? "1:1";
    normalized.imageResolution = existingResolution ?? legacySize?.resolution ?? "1k";
    normalized.imageQuality ??= "auto";
    if (isImageRatio(normalized.ratio)) {
      normalized.imageSize ??= resolveImageSize(normalized.ratio, normalized.imageResolution);
    }
  }
  if (normalized.provider === "topaz" || normalized.taskKind === "video_upscale") {
    normalized.taskKind = "video_upscale";
    normalized.mediaType = "video";
  }
  return normalized;
}

function isImageRatio(value: unknown): value is ImageRatio {
  return imageRatios.includes(value as ImageRatio);
}

export function mediaTypeOf(task: Pick<VideoTask, "mediaType">): MediaType {
  return task.mediaType === "image" ? "image" : "video";
}

export function taskKindOf(task: Pick<VideoTask, "taskKind" | "mediaType" | "provider">) {
  if (task.taskKind) return task.taskKind;
  if (task.provider === "topaz") return "video_upscale";
  return task.mediaType === "image" ? "image_generation" : "video_generation";
}

async function fileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function directorySize(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const sizes = await Promise.all(entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) return directorySize(child);
      if (entry.isFile()) return fileSize(child);
      return 0;
    }));
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}

function sqlitePathFromJsonPath(path: string) {
  const ext = extname(path);
  return ext ? path.slice(0, -ext.length) + ".sqlite" : `${path}.sqlite`;
}

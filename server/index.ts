import express from "express";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { loadConfig, publicConfig } from "./lib/config.js";
import { openDB, upsertAssetGroup, upsertAsset, deleteAsset, createImageTask, createTopazTask, createVideoTask, createVideoProject, ensureDefaultVideoProject, getExecutorVideoTaskPage, getManagerVideoTaskPage, getRuntimeSettings, getStorageStats, hardDeleteVideoTaskRecord, hideVideoTaskRecord, mediaTypeOf, renameVideoProject, restoreVideoProject, softDeleteVideoProject, updateRuntimeSettings } from "./lib/db.js";
import { AssetsClient } from "./lib/assetsClient.js";
import { VideoClient } from "./lib/videoClient.js";
import { ImageClient } from "./lib/imageClient.js";
import { SerialTaskRunner } from "./lib/taskRunner.js";
import { ImageTaskRunner } from "./lib/imageTaskRunner.js";
import { TopazClient, assertControlledTopazSourcePath, checkTopazCLIAvailable } from "./lib/topazClient.js";
import { TopazTaskRunner } from "./lib/topazTaskRunner.js";
import { validatePublicAssetUrl, type AssetType, type VideoReferenceInput } from "./lib/payloads.js";
import { parseImageTaskRequest, parseTopazTaskRequest, parseVideoTaskRequest } from "./lib/requestSchemas.js";
import { getDownloadPathForTask, openDownloadFolder } from "./lib/downloadFolder.js";
import { uploadImageToTemporaryHost } from "./lib/uploadProvider.js";
import { mountStaticClient } from "./lib/staticRouter.js";
import { summarizeLocalUsage } from "./lib/usageStats.js";
import { fileFromLocalUpload, resolveLocalUploadPath, saveUploadedImageLocally, saveUploadedVideoLocally } from "./lib/localUploadStore.js";
import { buildTaskDebugExport } from "./lib/taskDebugExport.js";
import { errorMessage, retryOperation } from "./lib/retry.js";
import type { TaskRunContext } from "./lib/taskRunner.js";
import type { RuntimeSettings } from "./types.js";

const config = loadConfig();
const db = await openDB(config.databasePath, config.sqlitePath);
await ensureDefaultVideoProject(db);
await mkdir(config.downloadDir, { recursive: true });
await mkdir(config.uploadDir, { recursive: true });
await mkdir(config.topazWorkDir ?? "data/topaz", { recursive: true });

const assetsClient = new AssetsClient(config, () => getRuntimeSettings(db, config));
const videoClient = new VideoClient(config, () => getRuntimeSettings(db, config));
const imageClient = new ImageClient(config, () => getRuntimeSettings(db, config));
const topazClient = new TopazClient(config);
const runner = new SerialTaskRunner(db, videoClient, config, () => getRuntimeSettings(db, config));
const imageRunner = new ImageTaskRunner(db, imageClient, config, () => getRuntimeSettings(db, config));
const topazRunner = new TopazTaskRunner(db, topazClient, config, () => getRuntimeSettings(db, config));
const app = express();
const managerToken = "sts-manager-session";

app.use((req, res, next) => {
  if (!config.corsOrigin) return next();
  res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-sts-manager-token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.use(express.json({ limit: "1mb" }));

app.get("/api/config", asyncHandler(async (_req, res) => {
  const settings = await getRuntimeSettings(db, config);
  const topazCLI = await checkTopazCLIAvailable(settings.topazCLIPath ?? "topaz-video");
  res.json({
    ...publicConfig(config),
    arkAPIKeyConfigured: Boolean(settings.arkAPIKey),
    arkVideoModel: settings.arkVideoModel,
    arkBaseURL: settings.arkBaseURL,
    imageHostURL: settings.imageHostURL,
    image2APIKeyConfigured: Boolean(settings.image2APIKey),
    image2APIURL: settings.image2APIURL,
    image2Model: settings.image2Model,
    topazEnabled: settings.topazEnabled === "true",
    topazCLIPath: settings.topazCLIPath,
    topazWorkDir: settings.topazWorkDir,
    maxConcurrentTopazTasks: settings.maxConcurrentTopazTasks,
    topazDefaultAIModel: settings.topazDefaultAIModel,
    topazCLIAvailable: topazCLI.available,
    topazCLIStatus: topazCLI.status,
    assetsCredentialsConfigured: Boolean(settings.volcengineAK && settings.volcengineSK)
  });
}));

app.get("/api/state", (_req, res) => {
  res.json(db.data);
});

app.get("/api/shell-state", (_req, res) => {
  res.json({
    ...db.data,
    videoTasks: []
  });
});

app.get("/api/runtime-settings", asyncHandler(async (_req, res) => {
  if (!isManagerRequest(_req)) return res.status(401).json({ error: "需要管理权限。" });
  res.json(await getRuntimeSettings(db, config));
}));

app.patch("/api/runtime-settings", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const input = runtimeSettingsSchema.parse(req.body);
  res.json(await updateRuntimeSettings(db, input));
}));

app.get("/api/manager/usage/local", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  res.json(summarizeLocalUsage(db.data));
}));

app.get("/api/manager/storage", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  res.json(await getStorageStats(db, {
    databasePath: config.databasePath,
    sqlitePath: config.sqlitePath,
    downloadDir: config.downloadDir,
    uploadDir: config.uploadDir
  }));
}));

app.post("/api/manager/login", asyncHandler(async (req, res) => {
  const input = z.object({
    username: z.string(),
    password: z.string()
  }).parse(req.body);
  if (input.username !== "STS" || input.password !== "Sts123456") {
    return res.status(401).json({ error: "账号或密码错误。" });
  }
  res.json({ ok: true, token: managerToken });
}));

app.get("/api/v1/config", asyncHandler(async (_req, res) => {
  const settings = await getRuntimeSettings(db, config);
  const topazCLI = await checkTopazCLIAvailable(settings.topazCLIPath ?? "topaz-video");
  res.json({
    ...publicConfig(config),
    arkAPIKeyConfigured: Boolean(settings.arkAPIKey),
    arkVideoModel: settings.arkVideoModel,
    arkBaseURL: settings.arkBaseURL,
    imageHostURL: settings.imageHostURL,
    image2APIKeyConfigured: Boolean(settings.image2APIKey),
    image2APIURL: settings.image2APIURL,
    image2Model: settings.image2Model,
    topazEnabled: settings.topazEnabled === "true",
    topazCLIPath: settings.topazCLIPath,
    topazWorkDir: settings.topazWorkDir,
    maxConcurrentTopazTasks: settings.maxConcurrentTopazTasks,
    topazDefaultAIModel: settings.topazDefaultAIModel,
    topazCLIAvailable: topazCLI.available,
    topazCLIStatus: topazCLI.status,
    assetsCredentialsConfigured: Boolean(settings.volcengineAK && settings.volcengineSK)
  });
}));

app.get("/api/v1/shell-state", (_req, res) => {
  res.json({
    ...db.data,
    videoTasks: []
  });
});

app.get("/api/v1/projects", (_req, res) => {
  res.json(db.data.videoProjects);
});

app.post("/api/v1/projects", asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(1).max(40) }).parse(req.body);
  const project = await createVideoProject(db, input.name);
  res.json(project);
}));

app.patch("/api/v1/projects/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const input = z.object({ name: z.string().min(1).max(40) }).parse(req.body);
  const project = await renameVideoProject(db, id, input.name);
  res.json(project);
}));

app.delete("/api/v1/projects/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const project = await softDeleteVideoProject(db, id);
  res.json(project);
}));

app.post("/api/v1/manager/projects/:id/restore", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const id = routeParam(req.params.id);
  const project = await restoreVideoProject(db, id);
  res.json(project);
}));

app.post("/api/v1/generation-tasks", asyncHandler(async (req, res) => {
  return submitGenerationTask(req, res);
}));

app.get("/api/v1/generation-tasks", asyncHandler(async (req, res) => {
  const input = taskPageQuerySchema.parse(req.query);
  res.json(getExecutorVideoTaskPage(db.data, input));
}));

app.get("/api/v1/generation-tasks/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const task = db.data.videoTasks.find((item) => item.id === id);
  if (!task || task.hiddenAt) return res.status(404).json({ error: "生成任务不存在。" });
  res.json(task);
}));

app.delete("/api/v1/generation-tasks/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  await hideVideoTaskRecord(db, id);
  res.json({ ok: true });
}));

app.get("/api/v1/generation-tasks/:id/debug", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const debugExport = buildTaskDebugExport(db.data, id);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="seendance-task-${id}-debug.json"`);
  res.send(JSON.stringify(debugExport, null, 2));
}));

app.get("/api/v1/generation-tasks/:id/file/:index", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const task = db.data.videoTasks.find((item) => item.id === id);
  if (!task) return res.status(404).json({ error: "生成任务不存在。" });
  if (mediaTypeOf(task) === "video") {
    if (routeParam(req.params.index) !== "0") return res.status(404).json({ error: "视频任务只有一个文件。" });
    const path = getDownloadPathForTask(task);
    return res.download(path);
  }
  const index = Number(routeParam(req.params.index));
  const path = Number.isInteger(index) ? task.imageDownloadPaths?.[index] : undefined;
  if (!path) return res.status(404).json({ error: "这个图片任务还没有对应的本地文件。" });
  return res.sendFile(resolve(path));
}));

app.post("/api/v1/uploads/images", asyncHandler(async (req, res) => {
  const file = await fileFromMultipartRequest(req);
  if (!file.type.startsWith("image/")) return res.status(400).json({ error: "只支持上传图片文件。" });
  const settings = await getRuntimeSettings(db, config);
  const local = await saveUploadedImageLocally(file, settings.uploadDir || config.uploadDir);
  const uploaded = await uploadImageToTemporaryHost(file, settings.imageHostURL, fetch, {
    maxRetries: retryCountFromSettings(settings)
  });
  res.json({ ...uploaded, localPath: local.path, localUrl: local.url });
}));

app.post("/api/v1/uploads/videos", asyncHandler(async (req, res) => {
  const file = await fileFromMultipartRequest(req);
  if (!file.type.startsWith("video/")) return res.status(400).json({ error: "只支持上传视频文件。" });
  const settings = await getRuntimeSettings(db, config);
  const local = await saveUploadedVideoLocally(file, settings.uploadDir || config.uploadDir);
  res.json({ path: local.path, localPath: local.path, url: local.url, localUrl: local.url });
}));

app.get("/api/v1/uploads/local/:name", asyncHandler(async (req, res) => {
  const name = basename(routeParam(req.params.name));
  const settings = await getRuntimeSettings(db, config);
  const path = resolveLocalUploadPath(settings.uploadDir || config.uploadDir, name);
  res.sendFile(path);
}));

app.post("/api/v1/downloads/open-folder", asyncHandler(async (_req, res) => {
  const path = await openDownloadFolder(config.downloadDir);
  res.json({ ok: true, path });
}));

app.post("/api/v1/manager/login", asyncHandler(async (req, res) => {
  const input = z.object({
    username: z.string(),
    password: z.string()
  }).parse(req.body);
  if (input.username !== "STS" || input.password !== "Sts123456") {
    return res.status(401).json({ error: "账号或密码错误。" });
  }
  res.json({ ok: true, token: managerToken });
}));

app.get("/api/v1/manager/settings", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  res.json(await getRuntimeSettings(db, config));
}));

app.patch("/api/v1/manager/settings", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const input = runtimeSettingsSchema.parse(req.body);
  res.json(await updateRuntimeSettings(db, input));
}));

app.get("/api/v1/manager/usage", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  res.json(summarizeLocalUsage(db.data));
}));

app.get("/api/v1/manager/storage", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  res.json(await getStorageStats(db, {
    databasePath: config.databasePath,
    sqlitePath: config.sqlitePath,
    downloadDir: config.downloadDir,
    uploadDir: config.uploadDir
  }));
}));

app.get("/api/v1/manager/generation-tasks", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const input = managerTaskPageQuerySchema.parse(req.query);
  res.json(getManagerVideoTaskPage(db.data, input));
}));

app.delete("/api/v1/manager/generation-tasks/:id", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const id = routeParam(req.params.id);
  await hardDeleteVideoTaskRecord(db, id);
  res.json({ ok: true });
}));

app.post("/api/video-projects", asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(1).max(40) }).parse(req.body);
  const project = await createVideoProject(db, input.name);
  res.json(project);
}));

app.patch("/api/video-projects/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const input = z.object({ name: z.string().min(1).max(40) }).parse(req.body);
  const project = await renameVideoProject(db, id, input.name);
  res.json(project);
}));

app.delete("/api/video-projects/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const project = await softDeleteVideoProject(db, id);
  res.json(project);
}));

app.post("/api/manager/video-projects/:id/restore", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const id = routeParam(req.params.id);
  const project = await restoreVideoProject(db, id);
  res.json(project);
}));

app.post("/api/asset-groups", asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().min(1).max(64),
    description: z.string().max(300).optional(),
    projectName: z.string().optional()
  }).parse(req.body);
  const group = await assetsClient.createAssetGroup(input);
  await upsertAssetGroup(db, group);
  res.json(group);
}));

app.post("/api/asset-groups/:id/update", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const input = z.object({
    name: z.string().min(1).max(64),
    description: z.string().max(300).optional(),
    projectName: z.string().optional()
  }).parse(req.body);
  const raw = await assetsClient.updateAssetGroup({ id, ...input });
  const existing = db.data.assetGroups.find((group) => group.id === id);
  if (existing) await upsertAssetGroup(db, { ...existing, ...input, raw });
  res.json({ ok: true, raw });
}));

app.post("/api/assets", asyncHandler(async (req, res) => {
  const input = z.object({
    groupId: z.string().min(1),
    url: z.string().min(1),
    name: z.string().max(64).optional(),
    assetType: z.enum(["Image", "Video", "Audio"]),
    projectName: z.string().optional()
  }).parse(req.body);
  const validation = validatePublicAssetUrl(input.url);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const asset = await assetsClient.createAsset(input);
  await upsertAsset(db, asset);
  void pollAsset(asset.id, asset.projectName);
  res.json(asset);
}));

app.post("/api/uploads/image", asyncHandler(async (req, res) => {
  const file = await fileFromMultipartRequest(req);
  if (!file.type.startsWith("image/")) return res.status(400).json({ error: "只支持上传图片文件。" });
  const settings = await getRuntimeSettings(db, config);
  const local = await saveUploadedImageLocally(file, settings.uploadDir || config.uploadDir);
  const uploaded = await uploadImageToTemporaryHost(file, settings.imageHostURL, fetch, {
    maxRetries: retryCountFromSettings(settings)
  });
  res.json({ ...uploaded, localPath: local.path, localUrl: local.url });
}));

app.post("/api/uploads/video", asyncHandler(async (req, res) => {
  const file = await fileFromMultipartRequest(req);
  if (!file.type.startsWith("video/")) return res.status(400).json({ error: "只支持上传视频文件。" });
  const settings = await getRuntimeSettings(db, config);
  const local = await saveUploadedVideoLocally(file, settings.uploadDir || config.uploadDir);
  res.json({ path: local.path, localPath: local.path, url: local.url, localUrl: local.url });
}));

app.get("/api/uploads/local/:name", asyncHandler(async (req, res) => {
  const name = basename(routeParam(req.params.name));
  const settings = await getRuntimeSettings(db, config);
  const path = resolveLocalUploadPath(settings.uploadDir || config.uploadDir, name);
  res.sendFile(path);
}));

app.post("/api/assets/:id/poll", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const projectName = typeof req.body?.projectName === "string" ? req.body.projectName : undefined;
  const asset = await assetsClient.getAsset(id, projectName);
  await upsertAsset(db, asset);
  res.json(asset);
}));

app.post("/api/assets/:id/update", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const input = z.object({
    name: z.string().min(1).max(64),
    projectName: z.string().optional()
  }).parse(req.body);
  const raw = await assetsClient.updateAsset({ id, ...input });
  const existing = db.data.assets.find((asset) => asset.id === id);
  if (existing) await upsertAsset(db, { ...existing, name: input.name, raw });
  res.json({ ok: true, raw });
}));

app.delete("/api/assets/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const projectName = typeof req.query.projectName === "string" ? req.query.projectName : undefined;
  const raw = await assetsClient.deleteAsset(id, projectName);
  await deleteAsset(db, id);
  res.json({ ok: true, raw });
}));

app.post("/api/sync/assets", asyncHandler(async (req, res) => {
  const projectName = typeof req.body?.projectName === "string" ? req.body.projectName : undefined;
  const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds.filter((value: unknown) => typeof value === "string") : [];
  const rawGroups = await assetsClient.listAssetGroups(projectName);
  const rawAssets = await assetsClient.listAssets(groupIds, projectName);
  res.json({ groups: rawGroups, assets: rawAssets });
}));

app.post("/api/video-tasks", asyncHandler(async (req, res) => {
  const input = parseVideoTaskRequest(req.body);
  const task = await createVideoTask(db, input, input.references.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
  runner.enqueue(task.id, async (context) => {
    const settings = await getRuntimeSettings(db, config);
    const refreshedInputReferences = await refreshTemporaryReferences(input.references, settings, context);
    const references = input.referenceTransport === "asset"
      ? await prepareAssetReferences(refreshedInputReferences, settings, context)
      : refreshedInputReferences;
    return videoClient.createTask({
      modelVersion: input.modelVersion,
      prompt: input.prompt,
      mode: input.mode,
      ratio: input.ratio,
      duration: input.duration,
      resolution: input.resolution,
      references
    });
  });
  res.json(task);
}));

app.post("/api/generation-tasks", asyncHandler(async (req, res) => {
  return submitGenerationTask(req, res);
}));

app.get("/api/executor/tasks", asyncHandler(async (req, res) => {
  const input = taskPageQuerySchema.parse(req.query);
  res.json(getExecutorVideoTaskPage(db.data, input));
}));

app.get("/api/manager/video-tasks", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const input = managerTaskPageQuerySchema.parse(req.query);
  res.json(getManagerVideoTaskPage(db.data, input));
}));

app.get("/api/manager/generation-tasks", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const input = managerTaskPageQuerySchema.parse(req.query);
  res.json(getManagerVideoTaskPage(db.data, input));
}));

app.post("/api/downloads/open-folder", asyncHandler(async (_req, res) => {
  const path = await openDownloadFolder(config.downloadDir);
  res.json({ ok: true, path });
}));

app.get("/api/video-tasks/:id/download", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const task = db.data.videoTasks.find((item) => item.id === id);
  if (!task) return res.status(404).json({ error: "视频任务不存在。" });
  const path = getDownloadPathForTask(task);
  res.download(path);
}));

app.get("/api/generation-tasks/:id/file/:index", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const task = db.data.videoTasks.find((item) => item.id === id);
  if (!task) return res.status(404).json({ error: "生成任务不存在。" });
  if (mediaTypeOf(task) === "video") {
    if (routeParam(req.params.index) !== "0") return res.status(404).json({ error: "视频任务只有一个文件。" });
    const path = getDownloadPathForTask(task);
    return res.download(path);
  }
  const index = Number(routeParam(req.params.index));
  const path = Number.isInteger(index) ? task.imageDownloadPaths?.[index] : undefined;
  if (!path) return res.status(404).json({ error: "这个图片任务还没有对应的本地文件。" });
  return res.sendFile(resolve(path));
}));

app.get("/api/video-tasks/:id/debug", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const debugExport = buildTaskDebugExport(db.data, id);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="seendance-task-${id}-debug.json"`);
  res.send(JSON.stringify(debugExport, null, 2));
}));

app.get("/api/generation-tasks/:id/debug", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const debugExport = buildTaskDebugExport(db.data, id);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="seendance-task-${id}-debug.json"`);
  res.send(JSON.stringify(debugExport, null, 2));
}));

app.delete("/api/video-tasks/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  await hideVideoTaskRecord(db, id);
  res.json({ ok: true });
}));

app.delete("/api/generation-tasks/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  await hideVideoTaskRecord(db, id);
  res.json({ ok: true });
}));

app.delete("/api/manager/video-tasks/:id", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const id = routeParam(req.params.id);
  await hardDeleteVideoTaskRecord(db, id);
  res.json({ ok: true });
}));

app.delete("/api/manager/generation-tasks/:id", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const id = routeParam(req.params.id);
  await hardDeleteVideoTaskRecord(db, id);
  res.json({ ok: true });
}));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API 路由不存在。" });
});

mountStaticClient(app, resolve(process.cwd(), "dist"));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
});

app.listen(config.port, config.host, () => {
  console.log(`SeeDance server listening on http://${config.host}:${config.port}`);
});

async function pollAsset(id: string, projectName: string) {
  const started = Date.now();
  while (Date.now() - started < config.pollTimeoutMs) {
    await sleep(config.pollIntervalMs);
    const asset = await assetsClient.getAsset(id, projectName);
    await upsertAsset(db, asset);
    if (asset.status === "Active" || asset.status === "Failed") return;
  }
}

function asyncHandler(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function routeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

const runtimeSettingsSchema = z.object({
  port: z.string().trim().min(1),
  host: z.string().trim().min(1),
  databasePath: z.string().trim().min(1),
  downloadDir: z.string().trim().min(1),
  uploadDir: z.string().trim().min(1),
  sqlitePath: z.string().trim().min(1),
  volcengineAK: z.string().trim(),
  volcengineSK: z.string().trim(),
  volcengineRegion: z.string().trim().min(1),
  volcengineService: z.string().trim().min(1),
  arkAPIKey: z.string().trim(),
  arkVideoModel: z.string().trim().min(1),
  arkBaseURL: z.string().trim().url(),
  imageHostURL: z.string().trim().url(),
  assetProjectName: z.string().trim(),
  pollIntervalSeconds: z.string().trim().min(1),
  pollTimeoutSeconds: z.string().trim().min(1),
  maxPollRetryCount: z.string().trim().min(1),
  maxConcurrentVideoTasks: z.string().trim().min(1),
  maxConcurrentImageTasks: z.string().trim().min(1),
  topazEnabled: z.string().trim().min(1),
  topazCLIPath: z.string().trim().min(1),
  topazWorkDir: z.string().trim().min(1),
  maxConcurrentTopazTasks: z.string().trim().min(1),
  topazDefaultAIModel: z.string().trim().min(1),
  tokenPricePerThousand: z.string().trim().min(1),
  imageTokenPricePerThousand: z.string().trim().min(1),
  image2APIKey: z.string().trim(),
  image2APIURL: z.string().trim().url(),
  image2Model: z.string().trim().min(1)
});

const positiveLimitSchema = z.coerce.number().int().min(1).max(100).optional();
const taskPageQuerySchema = z.object({
  projectId: z.string().optional(),
  mediaType: z.enum(["all", "video", "image"]).optional(),
  taskKind: z.enum(["all", "video_generation", "image_generation", "video_upscale"]).optional(),
  limit: positiveLimitSchema,
  before: z.string().optional()
});
const managerTaskPageQuerySchema = taskPageQuerySchema.extend({
  status: z.enum(["all", "queued", "running", "succeeded", "failed", "hidden"]).optional(),
  query: z.string().optional(),
  sort: z.enum(["newest", "oldest", "status", "project"]).optional()
});

function isManagerRequest(req: express.Request) {
  return req.headers["x-sts-manager-token"] === managerToken;
}

async function submitGenerationTask(req: express.Request, res: express.Response) {
  if (req.body?.taskKind === "video_upscale") {
    const input = parseTopazTaskRequest(req.body);
    const settings = await getRuntimeSettings(db, config);
    if (settings.topazEnabled !== "true") return res.status(400).json({ error: "Topaz 视频放大未启用。" });
    if (input.sourceLocalPath) {
      input.sourceLocalPath = assertControlledTopazSourcePath(input.sourceLocalPath, {
        uploadDir: settings.uploadDir || config.uploadDir,
        downloadDir: settings.downloadDir || config.downloadDir
      });
    }
    if (input.sourceTaskId) {
      const source = db.data.videoTasks.find((task) => task.id === input.sourceTaskId);
      if (!source?.downloadPath) return res.status(400).json({ error: "选择的源视频还没有本地下载文件。" });
      assertControlledTopazSourcePath(source.downloadPath, {
        uploadDir: settings.uploadDir || config.uploadDir,
        downloadDir: settings.downloadDir || config.downloadDir
      });
    }
    const task = await createTopazTask(db, input);
    topazRunner.enqueue(task.id);
    return res.json(task);
  }

  if (req.body?.mediaType === "image") {
    const input = parseImageTaskRequest(req.body);
    await getRuntimeSettings(db, config);
    const task = await createImageTask(db, input);
    imageRunner.enqueue(task.id, async (context) => {
      const settings = await getRuntimeSettings(db, config);
      const refreshed = await refreshTemporaryReferences(input.references, settings, context);
      const references = await prepareImageReferences(refreshed);
      return imageClient.generate({
        prompt: input.prompt,
        ratio: input.ratio,
        imageResolution: input.imageResolution,
        imageQuality: input.imageQuality,
        size: input.size,
        imageModel: input.imageModel,
        references
      });
    });
    return res.json(task);
  }

  const input = parseVideoTaskRequest({ ...req.body, mediaType: "video" });
  const task = await createVideoTask(db, input, input.references.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
  runner.enqueue(task.id, async (context) => {
    const settings = await getRuntimeSettings(db, config);
    const refreshedInputReferences = await refreshTemporaryReferences(input.references, settings, context);
    const references = input.referenceTransport === "asset"
      ? await prepareAssetReferences(refreshedInputReferences, settings, context)
      : refreshedInputReferences;
    return videoClient.createTask({
      modelVersion: input.modelVersion,
      prompt: input.prompt,
      mode: input.mode,
      ratio: input.ratio,
      duration: input.duration,
      resolution: input.resolution,
      references
    });
  });
  return res.json(task);
}

async function prepareAssetReferences(references: VideoReferenceInput[], settings: RuntimeSettings, context?: TaskRunContext) {
  const prepared: VideoReferenceInput[] = [];
  for (const [index, reference] of references.entries()) {
    if (reference.assetId) {
      const existing = db.data.assets.find((asset) => asset.id === reference.assetId);
      if (!existing) throw new Error("选择的素材不存在。");
      if (existing.status !== "Active") throw new Error("只有 Active 状态的素材可以用于视频生成。");
      prepared.push(reference);
      continue;
    }
    if (!reference.sourceUrl) throw new Error("参考图片缺少公网 URL。");
    const validation = validatePublicAssetUrl(reference.sourceUrl);
    if (!validation.ok) throw new Error(validation.message);
    const group = await ensureDefaultAssetGroup(settings, context);
    const asset = await retryWithTaskLog(
      () => assetsClient.createAsset({
        groupId: group.id,
        url: reference.sourceUrl!,
        name: reference.label || `reference-${index + 1}`,
        assetType: reference.assetType,
        projectName: group.projectName
      }),
      settings,
      context,
      "Asset 创建失败"
    );
    await upsertAsset(db, asset);
    const activeAsset = await waitForAssetActive(asset.id, asset.projectName, settings, context);
    prepared.push({
      ...reference,
      assetId: activeAsset.id,
      sourceUrl: undefined
    });
  }
  return prepared;
}

async function prepareImageReferences(references: VideoReferenceInput[]) {
  const prepared: VideoReferenceInput[] = [];
  for (const reference of references) {
    if (reference.assetId) {
      const existing = db.data.assets.find((asset) => asset.id === reference.assetId);
      if (!existing) throw new Error("选择的素材不存在。");
      if (existing.status !== "Active") throw new Error("只有 Active 状态的素材可以用于图片生成。");
      prepared.push({
        ...reference,
        sourceUrl: existing.url
      });
      continue;
    }
    if (!reference.sourceUrl) throw new Error("参考图片缺少公网 URL。");
    const validation = validatePublicAssetUrl(reference.sourceUrl);
    if (!validation.ok) throw new Error(validation.message);
    prepared.push(reference);
  }
  return prepared;
}

async function ensureDefaultAssetGroup(settings: RuntimeSettings, context?: TaskRunContext) {
  const expectedProjectName = settings.assetProjectName || "";
  const existing = db.data.assetGroups.find((group) => group.projectName === expectedProjectName);
  if (existing) return existing;
  const group = await retryWithTaskLog(
    () => assetsClient.createAssetGroup({
      name: "seendance-reference-assets",
      description: "SeeDance UI uploaded reference assets",
      projectName: settings.assetProjectName || undefined
    }),
    settings,
    context,
    "Asset 分组创建失败"
  );
  await upsertAssetGroup(db, group);
  return group;
}

async function refreshTemporaryReferences(references: VideoReferenceInput[], settings: RuntimeSettings, context?: TaskRunContext) {
  const refreshed: VideoReferenceInput[] = [];
  for (const reference of references) {
    if (!reference.localPath) {
      refreshed.push(reference);
      continue;
    }
    const file = await fileFromLocalUpload(reference.localPath, reference.label || "reference.png");
    const uploaded = await uploadImageToTemporaryHost(file, settings.imageHostURL, fetch, {
      maxRetries: retryCountFromSettings(settings),
      onRetry: async ({ attempt, maxRetries, message }) => {
        await context?.logRetry("参考图片重新上传失败", attempt, maxRetries, message);
      }
    });
    refreshed.push({
      ...reference,
      sourceUrl: uploaded.url,
      previewUrl: reference.localUrl || reference.previewUrl || uploaded.url
    });
  }
  return refreshed;
}

async function waitForAssetActive(id: string, projectName: string, settings: RuntimeSettings, context?: TaskRunContext) {
  const started = Date.now();
  while (Date.now() - started < config.pollTimeoutMs) {
    await sleep(config.pollIntervalMs);
    const asset = await retryWithTaskLog(
      () => assetsClient.getAsset(id, projectName),
      settings,
      context,
      "Asset 状态轮询失败"
    );
    await upsertAsset(db, asset);
    if (asset.status === "Active") return asset;
    if (asset.status === "Failed") throw new Error(asset.errorMessage || "素材预处理失败。");
  }
  throw new Error("素材预处理轮询超时。");
}

async function retryWithTaskLog<T>(
  operation: () => Promise<T>,
  settings: RuntimeSettings,
  context: TaskRunContext | undefined,
  label: string
) {
  return retryOperation(operation, {
    maxRetries: retryCountFromSettings(settings),
    delayMs: config.pollIntervalMs,
    onRetry: async ({ attempt, maxRetries, message }) => {
      await context?.logRetry(label, attempt, maxRetries, message);
    }
  });
}

function retryCountFromSettings(settings: RuntimeSettings) {
  const value = Number(settings.maxPollRetryCount);
  return Number.isInteger(value) && value >= 0 ? value : config.maxPollRetryCount;
}

async function fileFromMultipartRequest(req: express.Request) {
  const contentType = req.headers["content-type"] || "";
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const response = new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } });
  const form = await response.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("请求中缺少 file。");
  return file;
}

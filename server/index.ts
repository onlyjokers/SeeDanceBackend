import express from "express";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { loadConfig, publicConfig } from "./lib/config.js";
import { openDB, upsertAssetGroup, upsertAsset, deleteAsset, createVideoTask, createVideoProject, ensureDefaultVideoProject, getRuntimeSettings, hardDeleteVideoTaskRecord, hideVideoTaskRecord, renameVideoProject, updateRuntimeSettings } from "./lib/db.js";
import { AssetsClient } from "./lib/assetsClient.js";
import { VideoClient } from "./lib/videoClient.js";
import { SerialTaskRunner } from "./lib/taskRunner.js";
import { validatePublicAssetUrl, type AssetType, type VideoReferenceInput } from "./lib/payloads.js";
import { parseVideoTaskRequest } from "./lib/requestSchemas.js";
import { getDownloadPathForTask, openDownloadFolder } from "./lib/downloadFolder.js";
import { uploadImageToTemporaryHost } from "./lib/uploadProvider.js";
import { mountStaticClient } from "./lib/staticRouter.js";
import { summarizeLocalUsage } from "./lib/usageStats.js";
import { emptyOfficialUsage, InferenceUsageClient } from "./lib/inferenceUsageClient.js";
import { fileFromLocalUpload, resolveLocalUploadPath, saveUploadedImageLocally } from "./lib/localUploadStore.js";
import { buildTaskDebugExport } from "./lib/taskDebugExport.js";
import { errorMessage, retryOperation } from "./lib/retry.js";
import type { TaskRunContext } from "./lib/taskRunner.js";
import type { RuntimeSettings } from "./types.js";

const config = loadConfig();
const db = await openDB(config.databasePath);
await ensureDefaultVideoProject(db);
await mkdir(config.downloadDir, { recursive: true });
await mkdir(config.uploadDir, { recursive: true });

const assetsClient = new AssetsClient(config, () => getRuntimeSettings(db, config));
const videoClient = new VideoClient(config, () => getRuntimeSettings(db, config));
const inferenceUsageClient = new InferenceUsageClient();
const runner = new SerialTaskRunner(db, videoClient, config, () => getRuntimeSettings(db, config));
const app = express();
const managerToken = "sts-manager-session";

app.use(express.json({ limit: "1mb" }));

app.get("/api/config", asyncHandler(async (_req, res) => {
  const settings = await getRuntimeSettings(db, config);
  res.json({
    ...publicConfig(config),
    arkAPIKeyConfigured: Boolean(settings.arkAPIKey),
    arkVideoModel: settings.arkVideoModel,
    arkBaseURL: settings.arkBaseURL,
    imageHostURL: settings.imageHostURL,
    assetsCredentialsConfigured: Boolean(settings.volcengineAK && settings.volcengineSK)
  });
}));

app.get("/api/state", (_req, res) => {
  res.json(db.data);
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

app.get("/api/manager/usage/official", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  try {
    const settings = await getRuntimeSettings(db, config);
    res.json(await inferenceUsageClient.getRecentUsage(settings, { days: 7 }));
  } catch (error) {
    res.json(emptyOfficialUsage(error instanceof Error ? error.message : String(error)));
  }
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

app.get("/api/video-tasks/:id/debug", asyncHandler(async (req, res) => {
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

app.delete("/api/manager/video-tasks/:id", asyncHandler(async (req, res) => {
  if (!isManagerRequest(req)) return res.status(401).json({ error: "需要管理权限。" });
  const id = routeParam(req.params.id);
  await hardDeleteVideoTaskRecord(db, id);
  res.json({ ok: true });
}));

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
  maxPollRetryCount: z.string().trim().min(1)
});

function isManagerRequest(req: express.Request) {
  return req.headers["x-sts-manager-token"] === managerToken;
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

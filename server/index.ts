import express from "express";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { loadConfig, publicConfig } from "./lib/config.js";
import { openDB, upsertAssetGroup, upsertAsset, deleteAsset, createVideoTask } from "./lib/db.js";
import { AssetsClient } from "./lib/assetsClient.js";
import { VideoClient } from "./lib/videoClient.js";
import { SerialTaskRunner } from "./lib/taskRunner.js";
import { validatePublicAssetUrl, type AssetType } from "./lib/payloads.js";
import { parseVideoTaskRequest } from "./lib/requestSchemas.js";
import { getDownloadPathForTask, openDownloadFolder } from "./lib/downloadFolder.js";

const config = loadConfig();
const db = await openDB(config.databasePath);
await mkdir(config.downloadDir, { recursive: true });

const assetsClient = new AssetsClient(config);
const videoClient = new VideoClient(config);
const runner = new SerialTaskRunner(db, videoClient, config);
const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/api/config", (_req, res) => {
  res.json(publicConfig(config));
});

app.get("/api/state", (_req, res) => {
  res.json(db.data);
});

app.post("/api/asset-groups", asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().min(1).max(64),
    description: z.string().max(300).optional(),
    projectName: z.string().optional().default("default")
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
    projectName: z.string().optional().default("default")
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
    projectName: z.string().optional().default("default")
  }).parse(req.body);
  const validation = validatePublicAssetUrl(input.url);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const asset = await assetsClient.createAsset(input);
  await upsertAsset(db, asset);
  void pollAsset(asset.id, asset.projectName);
  res.json(asset);
}));

app.post("/api/assets/:id/poll", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const projectName = typeof req.body?.projectName === "string" ? req.body.projectName : "default";
  const asset = await assetsClient.getAsset(id, projectName);
  await upsertAsset(db, asset);
  res.json(asset);
}));

app.post("/api/assets/:id/update", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const input = z.object({
    name: z.string().min(1).max(64),
    projectName: z.string().optional().default("default")
  }).parse(req.body);
  const raw = await assetsClient.updateAsset({ id, ...input });
  const existing = db.data.assets.find((asset) => asset.id === id);
  if (existing) await upsertAsset(db, { ...existing, name: input.name, raw });
  res.json({ ok: true, raw });
}));

app.delete("/api/assets/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const projectName = typeof req.query.projectName === "string" ? req.query.projectName : "default";
  const raw = await assetsClient.deleteAsset(id, projectName);
  await deleteAsset(db, id);
  res.json({ ok: true, raw });
}));

app.post("/api/sync/assets", asyncHandler(async (req, res) => {
  const projectName = typeof req.body?.projectName === "string" ? req.body.projectName : "default";
  const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds.filter((value: unknown) => typeof value === "string") : [];
  const rawGroups = await assetsClient.listAssetGroups(projectName);
  const rawAssets = await assetsClient.listAssets(groupIds, projectName);
  res.json({ groups: rawGroups, assets: rawAssets });
}));

app.post("/api/video-tasks", asyncHandler(async (req, res) => {
  const input = parseVideoTaskRequest(req.body);
  const selectedAssets = input.assetIds.map((id) => db.data.assets.find((asset) => asset.id === id));
  if (selectedAssets.some((asset) => !asset)) return res.status(400).json({ error: "选择的素材不存在。" });
  if (selectedAssets.some((asset) => asset?.status !== "Active")) return res.status(400).json({ error: "只有 Active 状态的素材可以用于视频生成。" });

  const task = await createVideoTask(db, input.prompt, input.assetIds);
  runner.enqueue(task.id, () => videoClient.createTask(input.prompt, selectedAssets as Array<NonNullable<typeof selectedAssets[number]>>));
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`SeeDance server listening on http://127.0.0.1:${config.port}`);
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

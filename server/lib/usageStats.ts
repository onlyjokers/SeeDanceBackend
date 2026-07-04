import type { DatabaseShape, VideoTask } from "../types.js";
import type { MediaType } from "./payloads.js";
import { mediaTypeOf } from "./db.js";
import { resolveTaskTokenUsage } from "./taskTokenUsage.js";

export interface LocalUsageSummary {
  source: "local";
  credentialsRequired: false;
  totals: {
    requests: number;
    visible: number;
    hidden: number;
    downloaded: number;
    referenceImages: number;
    videos: number;
    images: number;
    downloadedVideos: number;
    downloadedImages: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costEstimate: {
    currency: "CNY";
    unit: "per_1k_tokens";
    ratePerThousandTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
  byStatus: Record<VideoTask["status"], number>;
  byMediaType: Record<MediaType, MediaUsageSummary>;
  byProject: Array<{ projectId: string; projectName: string; requests: number; succeeded: number; failed: number; hidden: number }>;
  byModel: Array<{ modelVersion: string; requests: number; succeeded: number; failed: number }>;
  byDay: Array<{ day: string; requests: number }>;
  projectUsage: ProjectUsageSummary[];
}

export type UsageGranularity = "hour" | "day" | "week" | "month";

export interface MediaUsageSummary {
  requests: number;
  succeeded: number;
  failed: number;
  hidden: number;
  downloaded: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface UsageBucket {
  key: string;
  label: string;
  requests: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ProjectUsageSummary {
  projectId: string;
  projectName: string;
  deletedAt?: string;
  requests: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  mediaTypes: Record<MediaType, MediaUsageSummary>;
  buckets: Record<UsageGranularity, UsageBucket[]>;
  bucketsByMediaType: Record<MediaType, Record<UsageGranularity, UsageBucket[]>>;
}

export function summarizeLocalUsage(data: DatabaseShape): LocalUsageSummary {
  const byStatus: LocalUsageSummary["byStatus"] = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  const byMediaType: Record<MediaType, MutableMediaUsageSummary> = {
    video: createMediaUsage(),
    image: createMediaUsage()
  };
  const byProject = new Map<string, LocalUsageSummary["byProject"][number]>();
  const byModel = new Map<string, LocalUsageSummary["byModel"][number]>();
  const byDay = new Map<string, number>();
  const projectNames = new Map(data.videoProjects.map((project) => [project.id, project.name]));
  const rate = parsePositiveNumber(data.runtimeSettings?.tokenPricePerThousand, 0.049085);
  const imageRate = parsePositiveNumber(data.runtimeSettings?.imageTokenPricePerThousand, rate);
  const projectUsage = new Map<string, MutableProjectUsage>();
  for (const project of data.videoProjects) {
    projectUsage.set(project.id, createProjectUsage(project.id, project.name, project.deletedAt));
  }
  let hidden = 0;
  let downloaded = 0;
  let downloadedVideos = 0;
  let downloadedImages = 0;
  let videos = 0;
  let images = 0;
  let referenceImages = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (const task of data.videoTasks) {
    const mediaType = mediaTypeOf(task);
    const taskRate = mediaType === "image" ? imageRate : rate;
    byStatus[task.status] += 1;
    if (task.hiddenAt) hidden += 1;
    if (mediaType === "video") videos += 1;
    if (mediaType === "image") images += 1;
    const taskDownloaded = mediaType === "image" ? (task.imageDownloadPaths?.length ?? 0) > 0 : Boolean(task.downloadPath);
    if (taskDownloaded) downloaded += 1;
    if (mediaType === "video" && task.downloadPath) downloadedVideos += 1;
    if (mediaType === "image" && (task.imageDownloadPaths?.length ?? 0) > 0) downloadedImages += 1;
    referenceImages += (task.references ?? []).filter((reference) => reference.assetType === "Image").length;
    const tokenUsage = resolveTaskTokenUsage(task, data.pollLogs.filter((log) => log.taskId === task.id));
    inputTokens += tokenUsage?.inputTokens ?? 0;
    outputTokens += tokenUsage?.outputTokens ?? 0;
    totalTokens += tokenUsage?.totalTokens ?? 0;
    addTaskToMediaUsage(byMediaType[mediaType], task, tokenUsage, taskRate, taskDownloaded);

    const projectId = task.projectId || "default";
    const project = byProject.get(projectId) ?? {
      projectId,
      projectName: projectNames.get(projectId) ?? "默认项目",
      requests: 0,
      succeeded: 0,
      failed: 0,
      hidden: 0
    };
    project.requests += 1;
    if (task.status === "succeeded") project.succeeded += 1;
    if (task.status === "failed") project.failed += 1;
    if (task.hiddenAt) project.hidden += 1;
    byProject.set(projectId, project);
    const usageProject = projectUsage.get(projectId) ?? createProjectUsage(projectId, projectNames.get(projectId) ?? "默认项目");
    addTaskToProjectUsage(usageProject, task, tokenUsage, taskRate);
    projectUsage.set(projectId, usageProject);

    const modelVersion = task.modelVersion || task.imageModel || "unknown";
    const model = byModel.get(modelVersion) ?? { modelVersion, requests: 0, succeeded: 0, failed: 0 };
    model.requests += 1;
    if (task.status === "succeeded") model.succeeded += 1;
    if (task.status === "failed") model.failed += 1;
    byModel.set(modelVersion, model);

    const day = task.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  return {
    source: "local",
    credentialsRequired: false,
    totals: {
      requests: data.videoTasks.length,
      visible: data.videoTasks.length - hidden,
      hidden,
      downloaded,
      referenceImages,
      videos,
      images,
      downloadedVideos,
      downloadedImages,
      inputTokens,
      outputTokens,
      totalTokens
    },
    costEstimate: {
      currency: "CNY",
      unit: "per_1k_tokens",
      ratePerThousandTokens: rate,
      totalTokens,
      estimatedCost: roundMoney(byMediaType.video.estimatedCost + byMediaType.image.estimatedCost)
    },
    byStatus,
    byMediaType,
    byProject: [...byProject.values()].sort((a, b) => b.requests - a.requests),
    byModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, requests]) => ({ day, requests })),
    projectUsage: [...projectUsage.values()].map((project) => finalizeProjectUsage(project, rate)).sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests)
  };
}

type MutableProjectUsage = Omit<ProjectUsageSummary, "buckets" | "bucketsByMediaType"> & {
  buckets: Record<UsageGranularity, Map<string, UsageBucket>>;
  bucketsByMediaType: Record<MediaType, Record<UsageGranularity, Map<string, UsageBucket>>>;
};

type MutableMediaUsageSummary = MediaUsageSummary;

function createProjectUsage(projectId: string, projectName: string, deletedAt?: string): MutableProjectUsage {
  return {
    projectId,
    projectName,
    deletedAt,
    requests: 0,
    succeeded: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    mediaTypes: {
      video: createMediaUsage(),
      image: createMediaUsage()
    },
    buckets: {
      hour: new Map(),
      day: new Map(),
      week: new Map(),
      month: new Map()
    },
    bucketsByMediaType: {
      video: {
        hour: new Map(),
        day: new Map(),
        week: new Map(),
        month: new Map()
      },
      image: {
        hour: new Map(),
        day: new Map(),
        week: new Map(),
        month: new Map()
      }
    }
  };
}

function addTaskToProjectUsage(project: MutableProjectUsage, task: VideoTask, tokenUsage: ReturnType<typeof resolveTaskTokenUsage>, rate: number) {
  const mediaType = mediaTypeOf(task);
  const inputTokens = tokenUsage?.inputTokens ?? 0;
  const outputTokens = tokenUsage?.outputTokens ?? 0;
  const totalTaskTokens = tokenUsage?.totalTokens ?? 0;
  project.requests += 1;
  if (task.status === "succeeded") project.succeeded += 1;
  if (task.status === "failed") project.failed += 1;
  project.inputTokens += inputTokens;
  project.outputTokens += outputTokens;
  project.totalTokens += totalTaskTokens;
  project.estimatedCost = roundMoney((project.totalTokens / 1000) * rate);
  addTaskToMediaUsage(project.mediaTypes[mediaType], task, tokenUsage, rate, mediaType === "image" ? (task.imageDownloadPaths?.length ?? 0) > 0 : Boolean(task.downloadPath));

  const date = validDate(task.updatedAt) ?? validDate(task.createdAt);
  if (!date) return;
  for (const granularity of ["hour", "day", "week", "month"] as const) {
    const bucketKey = bucketKeyFor(date, granularity);
    const bucket = project.buckets[granularity].get(bucketKey.key) ?? {
      key: bucketKey.key,
      label: bucketKey.label,
      requests: 0,
      succeeded: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0
    };
    bucket.requests += 1;
    if (task.status === "succeeded") bucket.succeeded += 1;
    if (task.status === "failed") bucket.failed += 1;
    bucket.inputTokens += inputTokens;
    bucket.outputTokens += outputTokens;
    bucket.totalTokens += totalTaskTokens;
    bucket.estimatedCost = roundMoney((bucket.totalTokens / 1000) * rate);
    project.buckets[granularity].set(bucket.key, bucket);
    const mediaBucket = project.bucketsByMediaType[mediaType][granularity].get(bucketKey.key) ?? {
      key: bucketKey.key,
      label: bucketKey.label,
      requests: 0,
      succeeded: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0
    };
    mediaBucket.requests += 1;
    if (task.status === "succeeded") mediaBucket.succeeded += 1;
    if (task.status === "failed") mediaBucket.failed += 1;
    mediaBucket.inputTokens += inputTokens;
    mediaBucket.outputTokens += outputTokens;
    mediaBucket.totalTokens += totalTaskTokens;
    mediaBucket.estimatedCost = roundMoney((mediaBucket.totalTokens / 1000) * rate);
    project.bucketsByMediaType[mediaType][granularity].set(mediaBucket.key, mediaBucket);
  }
}

function finalizeProjectUsage(project: MutableProjectUsage, rate: number): ProjectUsageSummary {
  return {
    ...project,
    estimatedCost: roundMoney(project.mediaTypes.video.estimatedCost + project.mediaTypes.image.estimatedCost),
    buckets: {
      hour: sortedBuckets(project.buckets.hour),
      day: sortedBuckets(project.buckets.day),
      week: sortedBuckets(project.buckets.week),
      month: sortedBuckets(project.buckets.month)
    },
    bucketsByMediaType: {
      video: {
        hour: sortedBuckets(project.bucketsByMediaType.video.hour),
        day: sortedBuckets(project.bucketsByMediaType.video.day),
        week: sortedBuckets(project.bucketsByMediaType.video.week),
        month: sortedBuckets(project.bucketsByMediaType.video.month)
      },
      image: {
        hour: sortedBuckets(project.bucketsByMediaType.image.hour),
        day: sortedBuckets(project.bucketsByMediaType.image.day),
        week: sortedBuckets(project.bucketsByMediaType.image.week),
        month: sortedBuckets(project.bucketsByMediaType.image.month)
      }
    }
  };
}

function createMediaUsage(): MutableMediaUsageSummary {
  return {
    requests: 0,
    succeeded: 0,
    failed: 0,
    hidden: 0,
    downloaded: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0
  };
}

function addTaskToMediaUsage(summary: MutableMediaUsageSummary, task: VideoTask, tokenUsage: ReturnType<typeof resolveTaskTokenUsage>, rate: number, downloaded: boolean) {
  const inputTokens = tokenUsage?.inputTokens ?? 0;
  const outputTokens = tokenUsage?.outputTokens ?? 0;
  const totalTokens = tokenUsage?.totalTokens ?? 0;
  summary.requests += 1;
  if (task.status === "succeeded") summary.succeeded += 1;
  if (task.status === "failed") summary.failed += 1;
  if (task.hiddenAt) summary.hidden += 1;
  if (downloaded) summary.downloaded += 1;
  summary.inputTokens += inputTokens;
  summary.outputTokens += outputTokens;
  summary.totalTokens += totalTokens;
  summary.estimatedCost = roundMoney((summary.totalTokens / 1000) * rate);
}

function sortedBuckets(buckets: Map<string, UsageBucket>) {
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function bucketKeyFor(date: Date, granularity: UsageGranularity) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  if (granularity === "hour") {
    const key = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:00:00.000Z`;
    return { key, label: `${pad2(month)}-${pad2(day)} ${pad2(hour)}:00` };
  }
  if (granularity === "day") {
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    return { key, label: key };
  }
  if (granularity === "week") {
    const week = isoWeek(date);
    return { key: `${week.year}-W${pad2(week.week)}`, label: `${week.year}-W${pad2(week.week)}` };
  }
  const key = `${year}-${pad2(month)}`;
  return { key, label: key };
}

function isoWeek(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: day.getUTCFullYear(), week };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function estimateTokenCost(totalTokens: number, rawRate: string | undefined) {
  const rate = parsePositiveNumber(rawRate, 0.049085);
  return {
    currency: "CNY" as const,
    unit: "per_1k_tokens" as const,
    ratePerThousandTokens: rate,
    totalTokens,
    estimatedCost: roundMoney((totalTokens / 1000) * rate)
  };
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

import type { DatabaseShape, VideoTask } from "../types.js";
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
  byProject: Array<{ projectId: string; projectName: string; requests: number; succeeded: number; failed: number; hidden: number }>;
  byModel: Array<{ modelVersion: string; requests: number; succeeded: number; failed: number }>;
  byDay: Array<{ day: string; requests: number }>;
  projectUsage: ProjectUsageSummary[];
}

export type UsageGranularity = "hour" | "day" | "week" | "month";

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
  buckets: Record<UsageGranularity, UsageBucket[]>;
}

export function summarizeLocalUsage(data: DatabaseShape): LocalUsageSummary {
  const byStatus: LocalUsageSummary["byStatus"] = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  const byProject = new Map<string, LocalUsageSummary["byProject"][number]>();
  const byModel = new Map<string, LocalUsageSummary["byModel"][number]>();
  const byDay = new Map<string, number>();
  const projectNames = new Map(data.videoProjects.map((project) => [project.id, project.name]));
  const rate = parsePositiveNumber(data.runtimeSettings?.tokenPricePerThousand, 0.049085);
  const projectUsage = new Map<string, MutableProjectUsage>();
  for (const project of data.videoProjects) {
    projectUsage.set(project.id, createProjectUsage(project.id, project.name, project.deletedAt));
  }
  let hidden = 0;
  let downloaded = 0;
  let referenceImages = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (const task of data.videoTasks) {
    byStatus[task.status] += 1;
    if (task.hiddenAt) hidden += 1;
    if (task.downloadPath) downloaded += 1;
    referenceImages += (task.references ?? []).filter((reference) => reference.assetType === "Image").length;
    const tokenUsage = resolveTaskTokenUsage(task, data.pollLogs.filter((log) => log.taskId === task.id));
    inputTokens += tokenUsage?.inputTokens ?? 0;
    outputTokens += tokenUsage?.outputTokens ?? 0;
    totalTokens += tokenUsage?.totalTokens ?? 0;

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
    addTaskToProjectUsage(usageProject, task, tokenUsage, rate);
    projectUsage.set(projectId, usageProject);

    const modelVersion = task.modelVersion || "unknown";
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
      inputTokens,
      outputTokens,
      totalTokens
    },
    costEstimate: estimateTokenCost(totalTokens, data.runtimeSettings?.tokenPricePerThousand),
    byStatus,
    byProject: [...byProject.values()].sort((a, b) => b.requests - a.requests),
    byModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, requests]) => ({ day, requests })),
    projectUsage: [...projectUsage.values()].map((project) => finalizeProjectUsage(project, rate)).sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests)
  };
}

type MutableProjectUsage = Omit<ProjectUsageSummary, "buckets"> & {
  buckets: Record<UsageGranularity, Map<string, UsageBucket>>;
};

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
    buckets: {
      hour: new Map(),
      day: new Map(),
      week: new Map(),
      month: new Map()
    }
  };
}

function addTaskToProjectUsage(project: MutableProjectUsage, task: VideoTask, tokenUsage: ReturnType<typeof resolveTaskTokenUsage>, rate: number) {
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
  }
}

function finalizeProjectUsage(project: MutableProjectUsage, rate: number): ProjectUsageSummary {
  return {
    ...project,
    estimatedCost: roundMoney((project.totalTokens / 1000) * rate),
    buckets: {
      hour: sortedBuckets(project.buckets.hour),
      day: sortedBuckets(project.buckets.day),
      week: sortedBuckets(project.buckets.week),
      month: sortedBuckets(project.buckets.month)
    }
  };
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

import type { DatabaseShape, VideoTask } from "../types.js";

export interface LocalUsageSummary {
  source: "local";
  credentialsRequired: false;
  totals: {
    requests: number;
    visible: number;
    hidden: number;
    downloaded: number;
    referenceImages: number;
  };
  byStatus: Record<VideoTask["status"], number>;
  byProject: Array<{ projectId: string; projectName: string; requests: number; succeeded: number; failed: number; hidden: number }>;
  byModel: Array<{ modelVersion: string; requests: number; succeeded: number; failed: number }>;
  byDay: Array<{ day: string; requests: number }>;
}

export function summarizeLocalUsage(data: DatabaseShape): LocalUsageSummary {
  const byStatus: LocalUsageSummary["byStatus"] = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  const byProject = new Map<string, LocalUsageSummary["byProject"][number]>();
  const byModel = new Map<string, LocalUsageSummary["byModel"][number]>();
  const byDay = new Map<string, number>();
  const projectNames = new Map(data.videoProjects.map((project) => [project.id, project.name]));
  let hidden = 0;
  let downloaded = 0;
  let referenceImages = 0;

  for (const task of data.videoTasks) {
    byStatus[task.status] += 1;
    if (task.hiddenAt) hidden += 1;
    if (task.downloadPath) downloaded += 1;
    referenceImages += (task.references ?? []).filter((reference) => reference.assetType === "Image").length;

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
      referenceImages
    },
    byStatus,
    byProject: [...byProject.values()].sort((a, b) => b.requests - a.requests),
    byModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, requests]) => ({ day, requests }))
  };
}

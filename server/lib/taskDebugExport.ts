import type { DatabaseShape, PollLog, VideoTask } from "../types.js";
import { resolveTaskTokenUsage } from "./taskTokenUsage.js";

export function buildTaskDebugExport(data: DatabaseShape, taskId: string, exportedAt = new Date().toISOString()) {
  const task = data.videoTasks.find((item) => item.id === taskId);
  if (!task) throw new Error("视频任务不存在。");
  const logs = data.pollLogs
    .filter((log) => log.taskId === taskId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const project = data.videoProjects.find((item) => item.id === task.projectId);

  return {
    exportedAt,
    task: {
      ...task,
      projectName: project?.name ?? "默认项目"
    },
    timings: taskTimings(task, logs),
    tokenUsage: resolveTaskTokenUsage(task, logs) ?? null,
    logs
  };
}

function taskTimings(task: VideoTask, logs: PollLog[]) {
  const createdAtMs = new Date(task.createdAt).getTime();
  const updatedAtMs = new Date(task.updatedAt).getTime();
  const submittedAt = logs.find((log) => log.message === "视频任务已提交")?.createdAt;
  const firstRunningAt = task.status === "running" || task.remoteTaskId ? submittedAt : undefined;
  const finishedAt = task.status === "succeeded" || task.status === "failed" ? task.updatedAt : undefined;

  return {
    createdAt: task.createdAt,
    submittedAt: submittedAt ?? null,
    firstRunningAt: firstRunningAt ?? null,
    finishedAt: finishedAt ?? null,
    updatedAt: task.updatedAt,
    queueMs: submittedAt ? durationMs(task.createdAt, submittedAt) : null,
    executionMs: submittedAt && finishedAt ? durationMs(submittedAt, finishedAt) : null,
    totalMs: Number.isFinite(createdAtMs) && Number.isFinite(updatedAtMs) ? updatedAtMs - createdAtMs : null
  };
}

function durationMs(start: string, end: string) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return endMs - startMs;
}

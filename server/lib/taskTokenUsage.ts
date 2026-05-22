import type { PollLog, TokenUsage, VideoTask } from "../types.js";
import { extractTokenUsage } from "./tokenUsage.js";

export function resolveTaskTokenUsage(task: VideoTask, logs: PollLog[] = []): TokenUsage | undefined {
  if (task.tokenUsage) return task.tokenUsage;
  const fromTaskRaw = extractTokenUsage(task.raw);
  if (fromTaskRaw) return fromTaskRaw;
  for (const log of logs) {
    const fromLog = extractTokenUsage(log.raw);
    if (fromLog) return fromLog;
  }
  return undefined;
}

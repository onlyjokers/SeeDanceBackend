import { describe, expect, it } from "vitest";
import { buildTaskDebugExport } from "../server/lib/taskDebugExport.js";
import type { DatabaseShape } from "../server/types.js";

describe("task debug export", () => {
  it("exports ids, timings, token usage, and poll logs for a task", () => {
    const data: DatabaseShape = {
      assetGroups: [],
      assets: [],
      runtimeSettings: undefined,
      videoProjects: [
        { id: "p1", name: "调试项目", createdAt: "2026-05-22T10:00:00.000Z", updatedAt: "2026-05-22T10:00:00.000Z" }
      ],
      videoTasks: [
        {
          id: "task-local",
          projectId: "p1",
          remoteTaskId: "task-remote",
          prompt: "镜头推进",
          assetIds: [],
          mode: "multimodal",
          modelVersion: "doubao-seedance-2-0-fast-260128",
          status: "succeeded",
          tokenUsage: { inputTokens: 12, outputTokens: 88, totalTokens: 100 },
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:02:30.000Z"
        }
      ],
      pollLogs: [
        { id: "log-2", taskId: "task-local", message: "视频任务状态：succeeded", createdAt: "2026-05-22T10:02:00.000Z", raw: { status: "succeeded" } },
        { id: "log-1", taskId: "task-local", message: "视频任务已提交", createdAt: "2026-05-22T10:00:30.000Z", raw: { id: "task-remote" } }
      ]
    };

    const exported = buildTaskDebugExport(data, "task-local", "2026-05-22T10:03:00.000Z");

    expect(exported.task.id).toBe("task-local");
    expect(exported.task.remoteTaskId).toBe("task-remote");
    expect(exported.task.projectName).toBe("调试项目");
    expect(exported.timings.queueMs).toBe(30000);
    expect(exported.timings.executionMs).toBe(120000);
    expect(exported.timings.totalMs).toBe(150000);
    expect(exported.tokenUsage).toEqual({ inputTokens: 12, outputTokens: 88, totalTokens: 100 });
    expect(exported.logs.map((log) => log.id)).toEqual(["log-1", "log-2"]);
  });

  it("backfills token usage from task raw data for older completed records", () => {
    const data: DatabaseShape = {
      assetGroups: [],
      assets: [],
      runtimeSettings: undefined,
      videoProjects: [],
      pollLogs: [],
      videoTasks: [
        {
          id: "task-old",
          prompt: "旧任务",
          assetIds: [],
          status: "succeeded",
          raw: {
            usage: {
              completion_tokens: 50638,
              total_tokens: 50638
            }
          },
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:05:00.000Z"
        }
      ]
    };

    const exported = buildTaskDebugExport(data, "task-old");

    expect(exported.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 50638, totalTokens: 50638 });
  });
});

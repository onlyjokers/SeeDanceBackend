import { describe, expect, it } from "vitest";
import { summarizeLocalUsage } from "../server/lib/usageStats.js";
import type { DatabaseShape } from "../server/types.js";

describe("usage stats", () => {
  it("summarizes local generation requests by status, project, model, and downloads", () => {
    const data: DatabaseShape = {
      assetGroups: [],
      assets: [],
      pollLogs: [],
      runtimeSettings: undefined,
      videoProjects: [
        { id: "p1", name: "广告", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" },
        { id: "p2", name: "短剧", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" }
      ],
      videoTasks: [
        {
          id: "t1",
          projectId: "p1",
          prompt: "a",
          assetIds: [],
          mode: "multimodal",
          modelVersion: "seedance2.0fast_vip",
          ratio: "16:9",
          duration: 5,
          references: [
            { role: "reference", assetType: "Image", sourceUrl: "https://example.com/1.png" },
            { role: "reference", assetType: "Image", sourceUrl: "https://example.com/2.png" }
          ],
          status: "succeeded",
          downloadPath: "/tmp/video.mp4",
          createdAt: "2026-05-18T08:00:00.000Z",
          updatedAt: "2026-05-18T08:30:00.000Z"
        },
        {
          id: "t2",
          projectId: "p2",
          prompt: "b",
          assetIds: [],
          mode: "frames",
          modelVersion: "seedance2.0",
          status: "failed",
          hiddenAt: "2026-05-18T09:00:00.000Z",
          createdAt: "2026-05-18T09:00:00.000Z",
          updatedAt: "2026-05-18T09:10:00.000Z"
        },
        {
          id: "t3",
          projectId: "p1",
          prompt: "c",
          assetIds: [],
          mode: "multimodal",
          modelVersion: "seedance2.0fast_vip",
          status: "running",
          createdAt: "2026-05-19T01:00:00.000Z",
          updatedAt: "2026-05-19T01:00:00.000Z"
        }
      ]
    };

    const summary = summarizeLocalUsage(data);

    expect(summary.totals.requests).toBe(3);
    expect(summary.source).toBe("local");
    expect(summary.credentialsRequired).toBe(false);
    expect(summary.totals.hidden).toBe(1);
    expect(summary.totals.downloaded).toBe(1);
    expect(summary.byStatus).toEqual({ queued: 0, running: 1, succeeded: 1, failed: 1 });
    expect(summary.byProject[0]).toMatchObject({ projectId: "p1", projectName: "广告", requests: 2 });
    expect(summary.byModel[0]).toMatchObject({ modelVersion: "seedance2.0fast_vip", requests: 2 });
    expect(summary.byDay).toEqual([
      { day: "2026-05-18", requests: 2 },
      { day: "2026-05-19", requests: 1 }
    ]);
    expect(summary.totals.referenceImages).toBe(2);
  });
});

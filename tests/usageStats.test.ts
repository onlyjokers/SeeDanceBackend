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
          modelVersion: "doubao-seedance-2-0-fast-260128",
          ratio: "16:9",
          duration: 5,
          references: [
            { role: "reference", assetType: "Image", sourceUrl: "https://example.com/1.png" },
            { role: "reference", assetType: "Image", sourceUrl: "https://example.com/2.png" }
          ],
          status: "succeeded",
          tokenUsage: { inputTokens: 10, outputTokens: 90, totalTokens: 100 },
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
          modelVersion: "doubao-seedance-2-0-260128",
          status: "failed",
          raw: { usage: { completion_tokens: 20, total_tokens: 20 } },
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
          modelVersion: "doubao-seedance-2-0-fast-260128",
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
    expect(summary.totals.inputTokens).toBe(10);
    expect(summary.totals.outputTokens).toBe(110);
    expect(summary.totals.totalTokens).toBe(120);
    expect(summary.costEstimate).toEqual({
      currency: "CNY",
      unit: "per_1k_tokens",
      ratePerThousandTokens: 0.049085,
      totalTokens: 120,
      estimatedCost: 0.01
    });
    expect(summary.byStatus).toEqual({ queued: 0, running: 1, succeeded: 1, failed: 1 });
    expect(summary.byProject[0]).toMatchObject({ projectId: "p1", projectName: "广告", requests: 2 });
    expect(summary.byModel[0]).toMatchObject({ modelVersion: "doubao-seedance-2-0-fast-260128", requests: 2 });
    expect(summary.byDay).toEqual([
      { day: "2026-05-18", requests: 2 },
      { day: "2026-05-19", requests: 1 }
    ]);
    expect(summary.totals.referenceImages).toBe(2);
  });

  it("aggregates project token and cost trends by finished time buckets", () => {
    const data: DatabaseShape = {
      assetGroups: [],
      assets: [],
      pollLogs: [],
      runtimeSettings: { tokenPricePerThousand: "0.05" } as DatabaseShape["runtimeSettings"],
      videoProjects: [
        { id: "p1", name: "广告", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" },
        { id: "p2", name: "已删项目", deletedAt: "2026-05-20T00:00:00.000Z", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-20T00:00:00.000Z" }
      ],
      videoTasks: [
        {
          id: "t1",
          projectId: "p1",
          prompt: "a",
          assetIds: [],
          status: "succeeded",
          tokenUsage: { inputTokens: 100, outputTokens: 900, totalTokens: 1000 },
          createdAt: "2026-05-18T08:00:00.000Z",
          updatedAt: "2026-05-18T10:15:00.000Z"
        },
        {
          id: "t2",
          projectId: "p1",
          prompt: "b",
          assetIds: [],
          status: "failed",
          tokenUsage: { inputTokens: 50, outputTokens: 450, totalTokens: 500 },
          createdAt: "2026-05-18T09:00:00.000Z",
          updatedAt: "2026-05-19T01:30:00.000Z"
        },
        {
          id: "t3",
          projectId: "p2",
          prompt: "c",
          assetIds: [],
          status: "succeeded",
          tokenUsage: { inputTokens: 20, outputTokens: 180, totalTokens: 200 },
          createdAt: "2026-06-03T03:00:00.000Z",
          updatedAt: "2026-06-03T04:00:00.000Z"
        }
      ]
    };

    const summary = summarizeLocalUsage(data);
    const project = summary.projectUsage.find((item) => item.projectId === "p1");
    const deletedProject = summary.projectUsage.find((item) => item.projectId === "p2");

    expect(project).toMatchObject({
      projectId: "p1",
      projectName: "广告",
      requests: 2,
      failed: 1,
      totalTokens: 1500,
      estimatedCost: 0.08
    });
    expect(project?.buckets.hour.map((bucket) => [bucket.key, bucket.totalTokens, bucket.estimatedCost])).toEqual([
      ["2026-05-18T10:00:00.000Z", 1000, 0.05],
      ["2026-05-19T01:00:00.000Z", 500, 0.03]
    ]);
    expect(project?.buckets.day.map((bucket) => [bucket.key, bucket.totalTokens])).toEqual([
      ["2026-05-18", 1000],
      ["2026-05-19", 500]
    ]);
    expect(project?.buckets.week.map((bucket) => [bucket.label, bucket.totalTokens])).toEqual([["2026-W21", 1500]]);
    expect(project?.buckets.month.map((bucket) => [bucket.label, bucket.totalTokens])).toEqual([["2026-05", 1500]]);
    expect(deletedProject).toMatchObject({ projectId: "p2", projectName: "已删项目", deletedAt: "2026-05-20T00:00:00.000Z", totalTokens: 200 });
  });

  it("separates video and image usage while preserving project totals", () => {
    const data: DatabaseShape = {
      assetGroups: [],
      assets: [],
      pollLogs: [],
      runtimeSettings: { tokenPricePerThousand: "0.05", imageTokenPricePerThousand: "0.10" } as DatabaseShape["runtimeSettings"],
      videoProjects: [
        { id: "p1", name: "混合项目", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" }
      ],
      videoTasks: [
        {
          id: "v1",
          mediaType: "video",
          projectId: "p1",
          prompt: "video",
          assetIds: [],
          status: "succeeded",
          tokenUsage: { inputTokens: 10, outputTokens: 90, totalTokens: 100 },
          downloadPath: "/tmp/video.mp4",
          createdAt: "2026-05-18T08:00:00.000Z",
          updatedAt: "2026-05-18T08:30:00.000Z"
        },
        {
          id: "i1",
          mediaType: "image",
          projectId: "p1",
          prompt: "image",
          assetIds: [],
          status: "succeeded",
          tokenUsage: { inputTokens: 20, outputTokens: 180, totalTokens: 200 },
          imageDownloadPaths: ["/tmp/image.png"],
          imageModel: "image2",
          createdAt: "2026-05-18T09:00:00.000Z",
          updatedAt: "2026-05-18T09:30:00.000Z"
        }
      ]
    };

    const summary = summarizeLocalUsage(data);
    const project = summary.projectUsage.find((item) => item.projectId === "p1");

    expect(summary.totals.videos).toBe(1);
    expect(summary.totals.images).toBe(1);
    expect(summary.totals.downloadedVideos).toBe(1);
    expect(summary.totals.downloadedImages).toBe(1);
    expect(summary.byMediaType.video.totalTokens).toBe(100);
    expect(summary.byMediaType.image.totalTokens).toBe(200);
    expect(summary.byMediaType.image.estimatedCost).toBe(0.02);
    expect(project?.totalTokens).toBe(300);
    expect(project?.mediaTypes.image.requests).toBe(1);
    expect(project?.bucketsByMediaType.image.day[0]).toMatchObject({ totalTokens: 200 });
  });
});

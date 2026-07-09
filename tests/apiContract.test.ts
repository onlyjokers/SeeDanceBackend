import { describe, expect, it } from "vitest";
import { apiV1Paths, apiV1Prefix, createAPIClient } from "../server/contract.js";

describe("API contract", () => {
  it("publishes stable v1 paths for the separate frontend", () => {
    expect(apiV1Prefix).toBe("/api/v1");
    expect(apiV1Paths.config).toBe("/api/v1/config");
    expect(apiV1Paths.projects).toBe("/api/v1/projects");
    expect(apiV1Paths.project("project 1")).toBe("/api/v1/projects/project%201");
    expect(apiV1Paths.managerProjectRestore("project 1")).toBe("/api/v1/manager/projects/project%201/restore");
    expect(apiV1Paths.generationTasks).toBe("/api/v1/generation-tasks");
    expect(apiV1Paths.generationTaskCancel("task 1")).toBe("/api/v1/generation-tasks/task%201/cancel");
    expect(apiV1Paths.uploadImages).toBe("/api/v1/uploads/images");
    expect(apiV1Paths.uploadLocal("ref 1.png")).toBe("/api/v1/uploads/local/ref%201.png");
    expect(apiV1Paths.downloadsOpenFolder).toBe("/api/v1/downloads/open-folder");
    expect(apiV1Paths.managerLogin).toBe("/api/v1/manager/login");
    expect(apiV1Paths.managerSettings).toBe("/api/v1/manager/settings");
    expect(apiV1Paths.managerUsage).toBe("/api/v1/manager/usage");
    expect(apiV1Paths.managerStorage).toBe("/api/v1/manager/storage");
    expect(apiV1Paths.managerGenerationTasks).toBe("/api/v1/manager/generation-tasks");
    expect(apiV1Paths.managerLocalComputeResources).toBe("/api/v1/manager/local-compute/resources");
    expect(apiV1Paths.managerLocalComputePresets).toBe("/api/v1/manager/local-compute/presets");
    expect(apiV1Paths.managerLocalComputeFree).toBe("/api/v1/manager/local-compute/free");
  });

  it("creates a frontend-safe API client with base URL normalization", () => {
    const client = createAPIClient({ baseURL: "http://127.0.0.1:8787/" });
    expect(client.url(apiV1Paths.config)).toBe("http://127.0.0.1:8787/api/v1/config");
  });
});

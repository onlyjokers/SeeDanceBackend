import { describe, expect, it } from "vitest";
import { normalizeAppState } from "../src/appState.js";

describe("normalizeAppState", () => {
  it("fills missing array fields from legacy shell-state payloads", () => {
    const state = normalizeAppState({
      videoTasks: [{ id: "task-1" }]
    });

    expect(state.assetGroups).toEqual([]);
    expect(state.assets).toEqual([]);
    expect(state.videoProjects).toEqual([]);
    expect(state.videoTasks).toEqual([{ id: "task-1" }]);
    expect(state.pollLogs).toEqual([]);
  });
});

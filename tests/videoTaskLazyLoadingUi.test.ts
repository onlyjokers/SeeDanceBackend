import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("video task lazy loading UI", () => {
  const source = readFileSync("src/main.tsx", "utf8");

  it("loads executor history through paginated task pages", () => {
    expect(source).toContain("/api/executor/tasks");
    expect(source).toContain("loadOlderExecutorTasks");
    expect(source).toContain("onScroll={handleTimelineScroll}");
  });

  it("loads manager records through the manager pagination API", () => {
    expect(source).toContain("/api/manager/video-tasks");
    expect(source).toContain("loadMoreManagerRecords");
    expect(source).not.toContain("<ManagerRecords tasks={state.videoTasks}");
  });

  it("does not preload videos while rendering long task lists", () => {
    expect(source).toContain('preload="none"');
    expect(source).not.toContain('preload="metadata"');
  });
});

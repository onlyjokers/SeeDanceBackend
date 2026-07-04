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
    expect(source).toContain("/api/manager/generation-tasks");
    expect(source).toContain("loadMoreManagerRecords");
    expect(source).not.toContain("<ManagerRecords tasks={state.videoTasks}");
  });

  it("exposes image generation as a media task mode", () => {
    expect(source).toContain("图片生成");
    expect(source).toContain('mediaType === "image"');
    expect(source).toContain("imagePreviewUrl");
    expect(source).toContain("imageResolution");
    expect(source).toContain("imageQuality");
    expect(source).toContain("quality-menu");
    expect(source).not.toContain("imageResolutionSupported");
    expect(source).not.toContain("当前比例不可用");
    expect(source).toContain("gpt-image-2-pro");
    expect(source).not.toContain('value: "4k"');
    expect(source).not.toContain("label: \"4K\"");
  });

  it("persists executor composer settings across page refreshes", () => {
    expect(source).toContain("EXECUTOR_COMPOSER_STORAGE_KEY");
    expect(source).toContain("loadPersistedComposerState");
    expect(source).toContain("savePersistedComposerState");
    expect(source).toContain("localStorage.getItem(EXECUTOR_COMPOSER_STORAGE_KEY)");
    expect(source).toContain("localStorage.setItem(EXECUTOR_COMPOSER_STORAGE_KEY");
  });

  it("does not preload videos while rendering long task lists", () => {
    expect(source).toContain('preload="none"');
    expect(source).not.toContain('preload="metadata"');
  });
});

import { describe, expect, it } from "vitest";
import { parseTopazTaskRequest } from "../server/lib/requestSchemas.js";

describe("topaz task request schema", () => {
  it("accepts a controlled local upload source and defaults to proteus", () => {
    expect(parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceLocalPath: "/tmp/seendance/data/uploads/input.mp4",
      targetPreset: "4k"
    })).toMatchObject({
      mediaType: "video",
      taskKind: "video_upscale",
      sourceLocalPath: "/tmp/seendance/data/uploads/input.mp4",
      processMode: "enhance",
      aiModel: "proteus",
      targetPreset: "4k",
      codec: "h264_videotoolbox"
    });
  });

  it("accepts an existing generated video as source", () => {
    expect(parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceTaskId: "task-1",
      processMode: "upscale",
      aiModel: "iris-2",
      targetPreset: "2x",
      qv: 42
    })).toMatchObject({
      sourceTaskId: "task-1",
      processMode: "upscale",
      aiModel: "iris-2",
      targetPreset: "2x",
      qv: 42
    });
  });

  it("accepts multiple process modes while preserving the legacy single process mode", () => {
    expect(parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceTaskId: "task-1",
      processMode: "enhance",
      processModes: ["stabilize", "upscale"],
      targetPreset: "4x"
    })).toMatchObject({
      sourceTaskId: "task-1",
      processMode: "enhance",
      processModes: ["stabilize", "upscale"],
      targetPreset: "4x"
    });
  });

  it("requires at least one process mode when processModes is provided", () => {
    expect(() => parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceTaskId: "task-1",
      processModes: [],
      targetPreset: "2x"
    })).toThrow();
  });

  it("requires exactly one source", () => {
    expect(() => parseTopazTaskRequest({
      taskKind: "video_upscale",
      targetPreset: "2x"
    })).toThrow("视频放大需要选择源视频");

    expect(() => parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceTaskId: "task-1",
      sourceLocalPath: "/tmp/input.mp4",
      targetPreset: "2x"
    })).toThrow("只能选择一种源视频");
  });

  it("rejects unsupported target presets and process modes", () => {
    expect(() => parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceTaskId: "task-1",
      targetPreset: "1080p"
    })).toThrow();

    expect(() => parseTopazTaskRequest({
      taskKind: "video_upscale",
      sourceTaskId: "task-1",
      processMode: "denoise",
      targetPreset: "2x"
    })).toThrow();
  });
});

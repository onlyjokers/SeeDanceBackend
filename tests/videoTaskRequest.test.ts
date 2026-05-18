import { describe, expect, it } from "vitest";
import { parseVideoTaskRequest } from "../server/lib/requestSchemas.js";

describe("video task request schema", () => {
  it("allows text-to-video without selected assets", () => {
    expect(parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道延时摄影",
      assetIds: []
    })).toEqual({
      mode: "text",
      prompt: "城市街道延时摄影",
      assetIds: []
    });
  });

  it("requires assets for asset-reference generation", () => {
    expect(() => parseVideoTaskRequest({
      mode: "asset",
      prompt: "图片 1 的人物转身",
      assetIds: []
    })).toThrow("素材参考生成至少需要选择一个 Active 素材");
  });
});

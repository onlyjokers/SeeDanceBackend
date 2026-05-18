import { describe, expect, it } from "vitest";
import { parseVideoTaskRequest } from "../server/lib/requestSchemas.js";

describe("video task request schema", () => {
  it("allows text-to-video without selected references", () => {
    expect(parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道延时摄影",
      references: []
    })).toEqual({
      mode: "text",
      prompt: "城市街道延时摄影",
      referenceTransport: "asset",
      modelVersion: "seedance2.0fast_vip",
      ratio: "16:9",
      duration: 5,
      references: []
    });
  });

  it("accepts multimodal references with direct urls", () => {
    expect(parseVideoTaskRequest({
      mode: "multimodal",
      referenceTransport: "url",
      prompt: "图片 1 的人物转身",
      modelVersion: "seedance2.0",
      ratio: "9:16",
      duration: 12,
      references: [
        {
          role: "reference",
          sourceUrl: "https://litter.catbox.moe/ref.png",
          previewUrl: "https://litter.catbox.moe/ref.png",
          assetType: "Image"
        }
      ]
    }).references).toHaveLength(1);
  });

  it("requires two images for first-last-frame generation", () => {
    expect(() => parseVideoTaskRequest({
      mode: "frames",
      prompt: "图片 1 的人物转身",
      references: [
        {
          role: "first_frame",
          sourceUrl: "https://litter.catbox.moe/start.png",
          previewUrl: "https://litter.catbox.moe/start.png",
          assetType: "Image"
        }
      ]
    })).toThrow("首尾帧模式需要上传首帧和尾帧");
  });

  it("limits all-around references to three images", () => {
    expect(() => parseVideoTaskRequest({
      mode: "multimodal",
      prompt: "参考这些图片生成",
      references: [1, 2, 3, 4].map((index) => ({
        role: "reference",
        sourceUrl: `https://litter.catbox.moe/${index}.png`,
        previewUrl: `https://litter.catbox.moe/${index}.png`,
        assetType: "Image"
      }))
    })).toThrow("全能参考最多支持 3 张图片");
  });

  it("rejects unsupported model, ratio, and duration values", () => {
    expect(() => parseVideoTaskRequest({
      mode: "text",
      prompt: "城市",
      modelVersion: "seedance1.0",
      ratio: "2:1",
      duration: 16,
      references: []
    })).toThrow();
  });
});

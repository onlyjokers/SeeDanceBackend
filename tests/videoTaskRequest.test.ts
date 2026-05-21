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
      referenceTransport: "url",
      modelVersion: "doubao-seedance-2-0-fast-260128",
      ratio: "16:9",
      duration: 5,
      resolution: "720p",
      references: []
    });
  });

  it("accepts multimodal references with direct urls", () => {
    expect(parseVideoTaskRequest({
      mode: "multimodal",
      referenceTransport: "url",
      prompt: "图片 1 的人物转身",
      modelVersion: "doubao-seedance-2-0-260128",
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

  it("accepts 1080p for non-fast Seedance 2.0", () => {
    expect(parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道延时摄影",
      modelVersion: "doubao-seedance-2-0-260128",
      resolution: "1080p",
      references: []
    }).resolution).toBe("1080p");
  });

  it("rejects 1080p for Seedance 2.0 Fast", () => {
    expect(() => parseVideoTaskRequest({
      mode: "text",
      prompt: "城市街道延时摄影",
      modelVersion: "doubao-seedance-2-0-fast-260128",
      resolution: "1080p",
      references: []
    })).toThrow("Seedance 2.0 Fast 不支持 1080p");
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

  it("allows up to nine all-around reference images", () => {
    expect(parseVideoTaskRequest({
      mode: "multimodal",
      prompt: "参考这些图片生成",
      references: Array.from({ length: 9 }, (_, index) => ({
        role: "reference",
        sourceUrl: `https://litter.catbox.moe/${index + 1}.png`,
        previewUrl: `https://litter.catbox.moe/${index + 1}.png`,
        assetType: "Image"
      }))
    }).references).toHaveLength(9);
  });

  it("rejects the tenth all-around reference image", () => {
    expect(() => parseVideoTaskRequest({
      mode: "multimodal",
      prompt: "参考这些图片生成",
      references: Array.from({ length: 10 }, (_, index) => ({
        role: "reference",
        sourceUrl: `https://litter.catbox.moe/${index + 1}.png`,
        previewUrl: `https://litter.catbox.moe/${index + 1}.png`,
        assetType: "Image"
      }))
    })).toThrow("全能参考最多支持 9 张图片");
  });

  it("rejects unsupported model, ratio, and duration values", () => {
    expect(() => parseVideoTaskRequest({
      mode: "text",
      prompt: "城市",
      modelVersion: "seedance2.0fast_vip",
      ratio: "2:1",
      duration: 16,
      references: []
    })).toThrow();
  });
});

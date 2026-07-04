import { describe, expect, it } from "vitest";
import { parseImageTaskRequest } from "../server/lib/requestSchemas.js";

describe("image task request", () => {
  it("allows pure prompt image generation", () => {
    expect(parseImageTaskRequest({
      prompt: "生成一张山谷海报",
      references: []
    })).toMatchObject({
      mediaType: "image",
      prompt: "生成一张山谷海报",
      ratio: "1:1",
      imageResolution: "1k",
      imageQuality: "auto",
      imageModel: "gpt-image-2",
      references: []
    });
  });

  it("allows prompt plus reference images", () => {
    expect(parseImageTaskRequest({
      prompt: "参考图片 1 的人物姿势",
      ratio: "16:9",
      imageResolution: "1k",
      imageQuality: "high",
      imageModel: "gpt-image-2-pro",
      references: [{ role: "reference", sourceUrl: "https://example.test/ref.png", assetType: "Image" }]
    })).toMatchObject({ imageModel: "gpt-image-2-pro", imageResolution: "1k", imageQuality: "high", references: expect.any(Array) });
  });

  it("rejects 4k image resolution requests", () => {
    expect(() => parseImageTaskRequest({
      prompt: "超宽 4k",
      ratio: "16:9",
      imageResolution: "4k",
      references: []
    })).toThrow();
  });

  it("rejects more than nine reference images", () => {
    expect(() => parseImageTaskRequest({
      prompt: "太多参考图",
      references: Array.from({ length: 10 }, (_, index) => ({
        role: "reference",
        sourceUrl: `https://example.test/${index}.png`,
        assetType: "Image"
      }))
    })).toThrow("图片生成最多支持 9 张参考图");
  });
});

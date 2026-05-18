import { describe, expect, it } from "vitest";
import {
  buildCreateAssetGroupPayload,
  buildCreateAssetPayload,
  buildVideoTaskPayload,
  validatePublicAssetUrl
} from "../server/lib/payloads.js";

describe("Assets API payloads", () => {
  it("matches the docx CreateAssetGroup fields", () => {
    expect(buildCreateAssetGroupPayload({
      name: "portrait-set",
      description: "reference assets",
      projectName: "default"
    })).toEqual({
      Name: "portrait-set",
      Description: "reference assets",
      GroupType: "AIGC",
      ProjectName: "default"
    });
  });

  it("matches the docx CreateAsset fields", () => {
    expect(buildCreateAssetPayload({
      groupId: "group-1",
      url: "https://example.com/ref.png",
      name: "ref",
      assetType: "Image",
      projectName: "default"
    })).toEqual({
      GroupId: "group-1",
      URL: "https://example.com/ref.png",
      Name: "ref",
      AssetType: "Image",
      ProjectName: "default"
    });
  });

  it("rejects base64 and non-public asset URLs", () => {
    expect(validatePublicAssetUrl("data:image/png;base64,abc").ok).toBe(false);
    expect(validatePublicAssetUrl("http://localhost:3000/a.png").ok).toBe(false);
    expect(validatePublicAssetUrl("https://example.com/a.png").ok).toBe(true);
  });
});

describe("video task payloads", () => {
  it("uses asset:// references without injecting asset ids into prompt text", () => {
    const payload = buildVideoTaskPayload({
      model: "ep-model",
      prompt: "让图片 1 的人物转身看向镜头",
      assets: [{ id: "Asset-2026abc", assetType: "Image", label: "图片 1" }]
    });

    expect(payload.model).toBe("ep-model");
    expect(JSON.stringify(payload)).toContain('"url":"asset://Asset-2026abc"');
    expect(JSON.stringify(payload)).toContain('"role":"reference_image"');
    expect(payload.content[0]).toEqual({
      type: "text",
      text: "让图片 1 的人物转身看向镜头"
    });
  });

  it("supports text-only video payloads", () => {
    const payload = buildVideoTaskPayload({
      model: "ep-model",
      prompt: "一只玻璃杯在日光下缓慢旋转，背景干净",
      assets: []
    });

    expect(payload).toEqual({
      model: "ep-model",
      content: [
        {
          type: "text",
          text: "一只玻璃杯在日光下缓慢旋转，背景干净"
        }
      ]
    });
  });
});

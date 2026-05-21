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
      description: "reference assets"
    })).toEqual({
      Name: "portrait-set",
      Description: "reference assets",
      GroupType: "AIGC"
    });
  });

  it("matches the docx CreateAsset fields", () => {
    expect(buildCreateAssetPayload({
      groupId: "group-1",
      url: "https://example.com/ref.png",
      name: "ref",
      assetType: "Image"
    })).toEqual({
      GroupId: "group-1",
      URL: "https://example.com/ref.png",
      Name: "ref",
      AssetType: "Image"
    });
  });

  it("passes ProjectName only when explicitly configured", () => {
    expect(buildCreateAssetGroupPayload({
      name: "portrait-set",
      projectName: "project-a"
    })).toMatchObject({ ProjectName: "project-a" });
    expect(buildCreateAssetPayload({
      groupId: "group-1",
      url: "https://example.com/ref.png",
      assetType: "Image",
      projectName: "project-a"
    })).toMatchObject({ ProjectName: "project-a" });
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
      modelVersion: "doubao-seedance-2-0-fast-260128",
      prompt: "让图片 1 的人物转身看向镜头",
      mode: "multimodal",
      ratio: "16:9",
      duration: 5,
      references: [{ assetId: "Asset-2026abc", assetType: "Image", role: "reference", label: "图片 1" }]
    });

    expect(payload.model).toBe("doubao-seedance-2-0-fast-260128");
    expect(payload.ratio).toBe("16:9");
    expect(payload.duration).toBe(5);
    expect(payload.resolution).toBe("720p");
    expect(payload).not.toHaveProperty("video_resolution");
    expect(JSON.stringify(payload)).toContain('"url":"asset://Asset-2026abc"');
    expect(JSON.stringify(payload)).toContain('"role":"reference_image"');
    expect(payload.content[0]).toEqual({
      type: "text",
      text: "让图片 1 的人物转身看向镜头"
    });
  });

  it("supports text-only video payloads", () => {
    const payload = buildVideoTaskPayload({
      modelVersion: "doubao-seedance-2-0-fast-260128",
      prompt: "一只玻璃杯在日光下缓慢旋转，背景干净",
      mode: "text",
      ratio: "1:1",
      duration: 8,
      resolution: "1080p",
      references: []
    });

    expect(payload).toEqual({
      model: "doubao-seedance-2-0-fast-260128",
      duration: 8,
      ratio: "1:1",
      resolution: "1080p",
      content: [
        {
          type: "text",
          text: "一只玻璃杯在日光下缓慢旋转，背景干净"
        }
      ]
    });
  });

  it("supports direct HTTPS image references for advanced mode", () => {
    const payload = buildVideoTaskPayload({
      modelVersion: "doubao-seedance-2-0-260128",
      prompt: "参考图片 1 的构图",
      mode: "multimodal",
      ratio: "21:9",
      duration: 4,
      references: [{
        sourceUrl: "https://litter.catbox.moe/ref.png",
        assetType: "Image",
        role: "reference",
        label: "图片 1"
      }]
    });

    expect(JSON.stringify(payload)).toContain('"url":"https://litter.catbox.moe/ref.png"');
  });

  it("marks first and last frame references in frames mode", () => {
    const payload = buildVideoTaskPayload({
      modelVersion: "doubao-seedance-2-0-fast-260128",
      prompt: "从首帧自然过渡到尾帧",
      mode: "frames",
      ratio: "16:9",
      duration: 5,
      references: [
        { sourceUrl: "https://litter.catbox.moe/start.png", assetType: "Image", role: "first_frame", label: "首帧" },
        { sourceUrl: "https://litter.catbox.moe/end.png", assetType: "Image", role: "last_frame", label: "尾帧" }
      ]
    });

    expect(payload.content[1]).toMatchObject({ role: "first_frame" });
    expect(payload.content[2]).toMatchObject({ role: "last_frame" });
    expect(payload).not.toHaveProperty("ratio");
  });
});

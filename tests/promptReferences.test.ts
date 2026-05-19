import { describe, expect, it } from "vitest";
import { insertReferenceToken, labelForReferenceIndex } from "../src/promptReferences.js";

describe("prompt references", () => {
  it("labels reference slots with API-compatible image references", () => {
    expect(labelForReferenceIndex(0)).toBe("图片 1");
    expect(labelForReferenceIndex(8)).toBe("图片 9");
  });

  it("inserts an API-compatible image reference into prompt text", () => {
    expect(insertReferenceToken("", "图片 1")).toBe("图片 1 ");
    expect(insertReferenceToken("模仿动作", "图片 2")).toBe("模仿动作 图片 2 ");
    expect(insertReferenceToken("模仿动作   ", "图片 2")).toBe("模仿动作 图片 2 ");
  });
});

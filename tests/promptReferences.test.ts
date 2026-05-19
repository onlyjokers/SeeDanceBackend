import { describe, expect, it } from "vitest";
import { insertReferenceToken, labelForReferenceIndex } from "../src/promptReferences.js";

describe("prompt references", () => {
  it("labels reference slots with image tokens", () => {
    expect(labelForReferenceIndex(0)).toBe("图片1");
    expect(labelForReferenceIndex(8)).toBe("图片9");
  });

  it("inserts an @ image token into prompt text", () => {
    expect(insertReferenceToken("", "图片1")).toBe("@图片1 ");
    expect(insertReferenceToken("模仿动作", "图片2")).toBe("模仿动作 @图片2 ");
    expect(insertReferenceToken("模仿动作   ", "图片2")).toBe("模仿动作 @图片2 ");
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("manager official usage UI", () => {
  it("does not expose the unavailable official usage fetch path or metrics", async () => {
    const source = await readFile("src/main.tsx", "utf8");

    expect(source).not.toContain("/api/manager/usage/official");
    expect(source).not.toContain("刷新官方");
    expect(source).not.toContain("官方请求");
    expect(source).not.toContain("官方 Token");
    expect(source).not.toContain("官方图片量");
  });

  it("does not expose the unavailable official usage backend route", async () => {
    const source = await readFile("server/index.ts", "utf8");

    expect(source).not.toContain("/api/manager/usage/official");
    expect(source).not.toContain("InferenceUsageClient");
    expect(source).not.toContain("GetInferenceUsage");
  });
});

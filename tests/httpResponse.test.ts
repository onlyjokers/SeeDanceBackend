import { describe, expect, it } from "vitest";
import { readJsonOrThrow } from "../src/http.js";

describe("HTTP response parsing", () => {
  it("surfaces HTML error responses without JSON parse failures", async () => {
    const response = new Response("<!DOCTYPE html><pre>Cannot DELETE /api/video-projects/p1</pre>", {
      status: 404,
      headers: { "Content-Type": "text/html" }
    });

    await expect(readJsonOrThrow(response, "删除项目失败")).rejects.toThrow("Cannot DELETE /api/video-projects/p1");
  });

  it("uses JSON error messages when the API returns JSON", async () => {
    const response = new Response(JSON.stringify({ error: "项目不存在。" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });

    await expect(readJsonOrThrow(response, "删除项目失败")).rejects.toThrow("项目不存在。");
  });
});

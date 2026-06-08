import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("API fallback", () => {
  it("returns JSON for unknown API routes before serving the client shell", () => {
    const source = readFileSync("server/index.ts", "utf8");
    const apiFallbackIndex = source.indexOf('app.use("/api"');
    const staticMountIndex = source.indexOf("mountStaticClient(app");

    expect(apiFallbackIndex).toBeGreaterThan(-1);
    expect(apiFallbackIndex).toBeLessThan(staticMountIndex);
    expect(source).toContain('res.status(404).json({ error: "API 路由不存在。" })');
  });
});

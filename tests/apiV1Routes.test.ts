import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("api v1 routes", () => {
  const source = readFileSync("server/index.ts", "utf8");

  it("keeps legacy routes while exposing v1 routes for the separate frontend", () => {
    expect(source).toContain('app.get("/api/config"');
    expect(source).toContain('app.get("/api/v1/config"');
    expect(source).toContain('app.get("/api/v1/projects"');
    expect(source).toContain('app.post("/api/v1/projects"');
    expect(source).toContain('app.post("/api/v1/generation-tasks"');
    expect(source).toContain('app.get("/api/v1/generation-tasks"');
    expect(source).toContain('app.get("/api/v1/generation-tasks/:id"');
    expect(source).toContain('app.post("/api/v1/uploads/images"');
    expect(source).toContain('app.post("/api/v1/manager/login"');
    expect(source).toContain('app.get("/api/v1/manager/settings"');
    expect(source).toContain('app.patch("/api/v1/manager/settings"');
    expect(source).toContain('app.get("/api/v1/manager/generation-tasks"');
    expect(source).toContain('app.delete("/api/v1/manager/generation-tasks/:id"');
  });
});

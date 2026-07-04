import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("video task pagination API routes", () => {
  const source = readFileSync("server/index.ts", "utf8");

  it("exposes executor and manager paginated task routes before the API fallback", () => {
    const executorRoute = 'app.get("/api/executor/tasks"';
    const managerRoute = 'app.get("/api/manager/video-tasks"';
    const managerGenerationRoute = 'app.get("/api/manager/generation-tasks"';
    const shellRoute = 'app.get("/api/shell-state"';
    const fallbackRoute = 'app.use("/api"';

    expect(source).toContain(executorRoute);
    expect(source).toContain(managerRoute);
    expect(source).toContain(managerGenerationRoute);
    expect(source).toContain(shellRoute);
    expect(source.indexOf(executorRoute)).toBeLessThan(source.indexOf(fallbackRoute));
    expect(source.indexOf(managerRoute)).toBeLessThan(source.indexOf(fallbackRoute));
    expect(source.indexOf(managerGenerationRoute)).toBeLessThan(source.indexOf(fallbackRoute));
    expect(source.indexOf(shellRoute)).toBeLessThan(source.indexOf(fallbackRoute));
  });

  it("protects the manager task page route with the manager token", () => {
    const routeStart = source.indexOf('app.get("/api/manager/video-tasks"');
    const routeEnd = source.indexOf('app.post("/api/downloads/open-folder"', routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("isManagerRequest(req)");
    expect(routeSource).toContain("getManagerVideoTaskPage(db.data");
  });

  it("protects the manager generation task page route with the manager token", () => {
    const routeStart = source.indexOf('app.get("/api/manager/generation-tasks"');
    const routeEnd = source.indexOf('app.post("/api/downloads/open-folder"', routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource).toContain("isManagerRequest(req)");
    expect(routeSource).toContain("getManagerVideoTaskPage(db.data");
  });
});

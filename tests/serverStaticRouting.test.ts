import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

describe("production client routing", () => {
  it("serves the built client shell for /executor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-static-"));
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "dist", "index.html"), "<!doctype html><html><body><div id=\"root\"></div></body></html>");

    const { createStaticRouter } = await import("../server/lib/staticRouter.js");
    const router = createStaticRouter(join(dir, "dist"));
    const response = await router("/executor");

    expect(response.status).toBe(200);
    expect(response.body).toContain('<div id="root"></div>');
  });
});

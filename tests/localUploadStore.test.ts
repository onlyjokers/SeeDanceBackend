import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { saveUploadedImageLocally } from "../server/lib/localUploadStore.js";

describe("local upload store", () => {
  it("persists uploaded reference images and returns a local API URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-uploads-"));
    const file = new File([new Uint8Array([1, 2, 3])], "参考 图.png", { type: "image/png" });

    const saved = await saveUploadedImageLocally(file, dir);

    await expect(readFile(saved.path)).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(saved.url).toMatch(/^\/api\/uploads\/local\//);
    expect(saved.path.endsWith(".png")).toBe(true);
  });
});

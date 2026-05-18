import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { defaultRuntimeSettings, getRuntimeSettings, openDB, updateRuntimeSettings } from "../server/lib/db.js";
import { loadConfig } from "../server/lib/config.js";
import { uploadImageToTemporaryHost } from "../server/lib/uploadProvider.js";

describe("runtime settings", () => {
  it("starts with the STS defaults requested for manager control", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-db-"));
    const db = await openDB(join(dir, "db.json"));

    const settings = await getRuntimeSettings(db, loadConfig());

    expect(settings).toMatchObject({
      arkVideoModel: "ep-20260518141207-xbt4q",
      arkAPIKey: "",
      arkBaseURL: "https://ark.cn-beijing.volces.com",
      imageHostURL: "https://uguu.se/upload.php"
    });
  });

  it("persists manager updates immediately for later reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-db-"));
    const db = await openDB(join(dir, "db.json"));

    await updateRuntimeSettings(db, {
      arkVideoModel: "ep-next",
      arkAPIKey: "ark-next",
      arkBaseURL: "https://example.test",
      imageHostURL: "https://images.example.test/upload"
    });

    await expect(getRuntimeSettings(db, loadConfig())).resolves.toMatchObject({
      arkVideoModel: "ep-next",
      arkAPIKey: "ark-next",
      arkBaseURL: "https://example.test",
      imageHostURL: "https://images.example.test/upload"
    });
  });

  it("uses the configured image host endpoint when uploading references", async () => {
    const calls: string[] = [];
    const fetchMock = async (url: string | URL | Request) => {
      calls.push(String(url));
      return {
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          files: [{ url: "https://cdn.example.test/reference.png" }]
        })
      } as Response;
    };

    const result = await uploadImageToTemporaryHost(
      new File([new Uint8Array([1])], "reference.png", { type: "image/png" }),
      defaultRuntimeSettings.imageHostURL,
      fetchMock as typeof fetch
    );

    expect(calls).toEqual(["https://uguu.se/upload.php"]);
    expect(result.url).toBe("https://cdn.example.test/reference.png");
  });
});

import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { getRuntimeSettings, openDB, updateRuntimeSettings } from "../server/lib/db.js";
import type { AppConfig } from "../server/lib/config.js";

const config: AppConfig = {
  port: 8787,
  host: "0.0.0.0",
  databasePath: "data/seendance.json",
  downloadDir: "data/downloads",
  uploadDir: "data/uploads",
  volcengineAK: "ak-from-env",
  volcengineSK: "sk-from-env",
  volcengineRegion: "cn-beijing",
  volcengineService: "ark",
  arkAPIKey: "ark-from-env",
  arkVideoModel: "ep-from-env",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "QiShiYi",
  pollIntervalMs: 5000,
  pollTimeoutMs: 900000
};

describe("expanded runtime settings", () => {
  it("seeds manager-editable settings from the current env config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-settings-"));
    const db = await openDB(join(dir, "db.json"));

    await expect(getRuntimeSettings(db, config)).resolves.toMatchObject({
      port: "8787",
      host: "0.0.0.0",
      databasePath: "data/seendance.json",
      downloadDir: "data/downloads",
      uploadDir: "data/uploads",
      volcengineAK: "ak-from-env",
      volcengineSK: "sk-from-env",
      volcengineRegion: "cn-beijing",
      volcengineService: "ark",
      arkAPIKey: "ark-from-env",
      arkVideoModel: "ep-from-env",
      arkBaseURL: "https://ark.cn-beijing.volces.com",
      imageHostURL: "https://uguu.se/upload.php",
      assetProjectName: "QiShiYi",
      pollIntervalSeconds: "5",
      pollTimeoutSeconds: "900"
    });
  });

  it("persists additional env-backed settings from manager updates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-settings-"));
    const db = await openDB(join(dir, "db.json"));

    await updateRuntimeSettings(db, {
      volcengineAK: "ak-next",
      volcengineSK: "sk-next",
      assetProjectName: "NextProject",
      pollIntervalSeconds: "10",
      pollTimeoutSeconds: "1200"
    });

    await expect(getRuntimeSettings(db, config)).resolves.toMatchObject({
      volcengineAK: "ak-next",
      volcengineSK: "sk-next",
      assetProjectName: "NextProject",
      pollIntervalSeconds: "10",
      pollTimeoutSeconds: "1200"
    });
  });

  it("uses env config for fields that are missing or blank in existing stored settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-settings-"));
    const db = await openDB(join(dir, "db.json"));
    await db.update((data) => {
      data.runtimeSettings = {
        ...(data.runtimeSettings ?? awaitableRuntimeSettingsFallback()),
        arkAPIKey: "",
        volcengineAK: "",
        uploadDir: ""
      };
    });

    await expect(getRuntimeSettings(db, config)).resolves.toMatchObject({
      arkAPIKey: "ark-from-env",
      volcengineAK: "ak-from-env",
      uploadDir: "data/uploads"
    });
  });
});

function awaitableRuntimeSettingsFallback() {
  return {
    port: "8787",
    host: "0.0.0.0",
    databasePath: "data/seendance.json",
    downloadDir: "data/downloads",
    uploadDir: "data/uploads",
    volcengineAK: "",
    volcengineSK: "",
    volcengineRegion: "cn-beijing",
    volcengineService: "ark",
    arkAPIKey: "",
    arkVideoModel: "ep-from-env",
    arkBaseURL: "https://ark.cn-beijing.volces.com",
    imageHostURL: "https://uguu.se/upload.php",
    assetProjectName: "QiShiYi",
    pollIntervalSeconds: "5",
    pollTimeoutSeconds: "900"
  };
}

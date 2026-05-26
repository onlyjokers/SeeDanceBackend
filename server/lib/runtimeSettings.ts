import type { AppConfig } from "./config.js";
import type { RuntimeSettings } from "../types.js";

export function runtimeSettingsFromConfig(config: AppConfig): RuntimeSettings {
  return {
    port: String(config.port),
    host: config.host,
    databasePath: config.databasePath,
    sqlitePath: config.sqlitePath,
    downloadDir: config.downloadDir,
    uploadDir: config.uploadDir,
    volcengineAK: config.volcengineAK,
    volcengineSK: config.volcengineSK,
    volcengineRegion: config.volcengineRegion,
    volcengineService: config.volcengineService,
    arkAPIKey: config.arkAPIKey,
    arkVideoModel: config.arkVideoModel,
    arkBaseURL: config.arkBaseURL,
    imageHostURL: config.imageHostURL,
    assetProjectName: config.assetProjectName,
    pollIntervalSeconds: String(config.pollIntervalMs / 1000),
    pollTimeoutSeconds: String(config.pollTimeoutMs / 1000),
    maxPollRetryCount: String(config.maxPollRetryCount),
    maxConcurrentVideoTasks: String(config.maxConcurrentVideoTasks)
  };
}

export function trimRuntimeSettings(patch: Partial<RuntimeSettings>): Partial<RuntimeSettings> {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
  ) as Partial<RuntimeSettings>;
}

export function nonBlankRuntimeSettings(patch: Partial<RuntimeSettings> | undefined): Partial<RuntimeSettings> {
  if (!patch) return {};
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => typeof value !== "string" || value.trim() !== "")
  ) as Partial<RuntimeSettings>;
}

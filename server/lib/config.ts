import "dotenv/config";

export interface AppConfig {
  port: number;
  databasePath: string;
  downloadDir: string;
  volcengineAK: string;
  volcengineSK: string;
  volcengineRegion: string;
  arkAPIKey: string;
  arkVideoModel: string;
  arkBaseURL: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  return {
    port: numberEnv("PORT", 8787),
    databasePath: process.env.DATABASE_PATH || "data/seendance.json",
    downloadDir: process.env.DOWNLOAD_DIR || "data/downloads",
    volcengineAK: process.env.VOLCENGINE_AK || "",
    volcengineSK: process.env.VOLCENGINE_SK || "",
    volcengineRegion: process.env.VOLCENGINE_REGION || "cn-beijing",
    arkAPIKey: process.env.ARK_API_KEY || "",
    arkVideoModel: process.env.ARK_VIDEO_MODEL || "ep-20260512140336-qdrjq",
    arkBaseURL: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com",
    pollIntervalMs: numberEnv("POLL_INTERVAL_SECONDS", 5) * 1000,
    pollTimeoutMs: numberEnv("POLL_TIMEOUT_SECONDS", 900) * 1000
  };
}

export function publicConfig(config: AppConfig) {
  return {
    assetsCredentialsConfigured: Boolean(config.volcengineAK && config.volcengineSK),
    arkAPIKeyConfigured: Boolean(config.arkAPIKey),
    arkVideoModel: config.arkVideoModel,
    volcengineRegion: config.volcengineRegion,
    pollIntervalSeconds: config.pollIntervalMs / 1000,
    pollTimeoutSeconds: config.pollTimeoutMs / 1000
  };
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

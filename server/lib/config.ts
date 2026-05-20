import "dotenv/config";

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  downloadDir: string;
  volcengineAK: string;
  volcengineSK: string;
  volcengineRegion: string;
  volcengineService: string;
  arkAPIKey: string;
  arkVideoModel: string;
  arkBaseURL: string;
  imageHostURL: string;
  assetProjectName: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  return {
    port: numberEnv("PORT", 8787),
    host: process.env.HOST || "0.0.0.0",
    databasePath: process.env.DATABASE_PATH || "data/seendance.json",
    downloadDir: process.env.DOWNLOAD_DIR || "data/downloads",
    volcengineAK: process.env.VOLCENGINE_AK || "",
    volcengineSK: process.env.VOLCENGINE_SK || "",
    volcengineRegion: process.env.VOLCENGINE_REGION || "cn-beijing",
    volcengineService: process.env.VOLCENGINE_SERVICE || "ark",
    arkAPIKey: process.env.ARK_API_KEY || "",
    arkVideoModel: process.env.ARK_VIDEO_MODEL || "ep-20260518141207-xbt4q",
    arkBaseURL: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com",
    imageHostURL: process.env.IMAGE_HOST_URL || "https://uguu.se/upload.php",
    assetProjectName: process.env.ASSET_PROJECT_NAME || "",
    pollIntervalMs: numberEnv("POLL_INTERVAL_SECONDS", 5) * 1000,
    pollTimeoutMs: numberEnv("POLL_TIMEOUT_SECONDS", 900) * 1000
  };
}

export function publicConfig(config: AppConfig) {
  return {
    assetsCredentialsConfigured: Boolean(config.volcengineAK && config.volcengineSK),
    arkAPIKeyConfigured: Boolean(config.arkAPIKey),
    arkVideoModel: config.arkVideoModel,
    arkBaseURL: config.arkBaseURL,
    imageHostURL: config.imageHostURL,
    assetProjectNameConfigured: Boolean(config.assetProjectName),
    volcengineRegion: config.volcengineRegion,
    volcengineService: config.volcengineService,
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

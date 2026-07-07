import "dotenv/config";
import { dirname, extname, join, basename } from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  sqlitePath: string;
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
  maxPollRetryCount: number;
  maxConcurrentVideoTasks: number;
  maxConcurrentImageTasks?: number;
  topazEnabled?: boolean;
  topazCLIPath?: string;
  topazWorkDir?: string;
  maxConcurrentTopazTasks?: number;
  topazDefaultAIModel?: string;
  tokenPricePerThousand: number;
  imageTokenPricePerThousand?: number;
  image2APIKey?: string;
  image2APIURL?: string;
  image2Model?: string;
  uploadDir: string;
  corsOrigin: string;
}

export function loadConfig(): AppConfig {
  return {
    port: numberEnv("PORT", 8787),
    host: process.env.HOST || "0.0.0.0",
    databasePath: process.env.DATABASE_PATH || "data/seendance.json",
    sqlitePath: process.env.SQLITE_PATH || sqlitePathFromJsonPath(process.env.DATABASE_PATH || "data/seendance.json"),
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
    pollTimeoutMs: numberEnv("POLL_TIMEOUT_SECONDS", 3600) * 1000,
    maxPollRetryCount: integerEnv("MAX_POLL_RETRY_COUNT", 5),
    maxConcurrentVideoTasks: integerEnv("MAX_CONCURRENT_VIDEO_TASKS", 100),
    maxConcurrentImageTasks: integerEnv("MAX_CONCURRENT_IMAGE_TASKS", 8),
    topazEnabled: booleanEnv("TOPAZ_ENABLED", false),
    topazCLIPath: process.env.TOPAZ_CLI_PATH || "topaz-video",
    topazWorkDir: process.env.TOPAZ_WORK_DIR || "data/topaz",
    maxConcurrentTopazTasks: integerEnv("MAX_CONCURRENT_TOPAZ_TASKS", 1) || 1,
    topazDefaultAIModel: process.env.TOPAZ_DEFAULT_AI_MODEL || "proteus",
    tokenPricePerThousand: numberEnv("TOKEN_PRICE_PER_THOUSAND", 0.049085),
    imageTokenPricePerThousand: numberEnv("IMAGE_TOKEN_PRICE_PER_THOUSAND", numberEnv("TOKEN_PRICE_PER_THOUSAND", 0.049085)),
    image2APIKey: process.env.IMAGE2_API_KEY || "",
    image2APIURL: normalizeImage2APIURL(process.env.IMAGE2_API_URL || "https://www.cctq.ai/v1/images/generations"),
    image2Model: normalizeImage2Model(process.env.IMAGE2_MODEL || "gpt-image-2"),
    uploadDir: process.env.UPLOAD_DIR || "data/uploads",
    corsOrigin: process.env.CORS_ORIGIN || ""
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
    pollTimeoutSeconds: config.pollTimeoutMs / 1000,
    maxPollRetryCount: config.maxPollRetryCount,
    maxConcurrentVideoTasks: config.maxConcurrentVideoTasks,
    maxConcurrentImageTasks: config.maxConcurrentImageTasks ?? 8,
    topazEnabled: config.topazEnabled ?? false,
    topazCLIPath: config.topazCLIPath ?? "topaz-video",
    topazWorkDir: config.topazWorkDir ?? "data/topaz",
    maxConcurrentTopazTasks: config.maxConcurrentTopazTasks ?? 1,
    topazDefaultAIModel: config.topazDefaultAIModel ?? "proteus",
    tokenPricePerThousand: config.tokenPricePerThousand,
    imageTokenPricePerThousand: config.imageTokenPricePerThousand ?? config.tokenPricePerThousand,
    image2APIKeyConfigured: Boolean(config.image2APIKey),
    image2APIURL: normalizeImage2APIURL(config.image2APIURL ?? "https://www.cctq.ai/v1/images/generations"),
    image2Model: normalizeImage2Model(config.image2Model ?? "gpt-image-2"),
    uploadDir: config.uploadDir,
    corsOrigin: config.corsOrigin,
    sqlitePath: config.sqlitePath
  };
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function sqlitePathFromJsonPath(path: string) {
  const ext = extname(path);
  const name = ext ? basename(path, ext) : basename(path);
  return join(dirname(path), `${name}.sqlite`);
}

export function normalizeImage2Model(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "image2") return "gpt-image-2";
  if (trimmed === "image2-pro") return "gpt-image-2-pro";
  return trimmed;
}

export function normalizeImage2APIURL(value: string) {
  const trimmed = value.trim() || "https://www.cctq.ai/v1/images/generations";
  return trimmed
    .replace(/\/v1\/chat\/completions\/?$/, "/v1/images/generations")
    .replace(/\/v1\/images\/edits\/?$/, "/v1/images/generations");
}

export function normalizeImage2EditAPIURL(value: string) {
  return normalizeImage2APIURL(value).replace(/\/v1\/images\/generations\/?$/, "/v1/images/edits");
}

import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../server/lib/config.js";

describe("server host binding", () => {
  const originalAssetProjectName = process.env.ASSET_PROJECT_NAME;
  const originalVolcengineService = process.env.VOLCENGINE_SERVICE;
  const originalPollTimeoutSeconds = process.env.POLL_TIMEOUT_SECONDS;
  const originalMaxPollRetryCount = process.env.MAX_POLL_RETRY_COUNT;
  const originalMaxConcurrentVideoTasks = process.env.MAX_CONCURRENT_VIDEO_TASKS;
  const originalTokenPricePerThousand = process.env.TOKEN_PRICE_PER_THOUSAND;
  const originalStrangeOrchestratorURL = process.env.STRANGE_ORCHESTRATOR_URL;
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (originalAssetProjectName === undefined) delete process.env.ASSET_PROJECT_NAME;
    else process.env.ASSET_PROJECT_NAME = originalAssetProjectName;
    if (originalVolcengineService === undefined) delete process.env.VOLCENGINE_SERVICE;
    else process.env.VOLCENGINE_SERVICE = originalVolcengineService;
    if (originalPollTimeoutSeconds === undefined) delete process.env.POLL_TIMEOUT_SECONDS;
    else process.env.POLL_TIMEOUT_SECONDS = originalPollTimeoutSeconds;
    if (originalMaxPollRetryCount === undefined) delete process.env.MAX_POLL_RETRY_COUNT;
    else process.env.MAX_POLL_RETRY_COUNT = originalMaxPollRetryCount;
    if (originalMaxConcurrentVideoTasks === undefined) delete process.env.MAX_CONCURRENT_VIDEO_TASKS;
    else process.env.MAX_CONCURRENT_VIDEO_TASKS = originalMaxConcurrentVideoTasks;
    if (originalTokenPricePerThousand === undefined) delete process.env.TOKEN_PRICE_PER_THOUSAND;
    else process.env.TOKEN_PRICE_PER_THOUSAND = originalTokenPricePerThousand;
    if (originalStrangeOrchestratorURL === undefined) delete process.env.STRANGE_ORCHESTRATOR_URL;
    else process.env.STRANGE_ORCHESTRATOR_URL = originalStrangeOrchestratorURL;
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  it("defaults to 0.0.0.0 so the app can be reached from the LAN", () => {
    const config = loadConfig();

    expect(config.host).toBe("0.0.0.0");
  });

  it("does not force an Asset project name unless configured", () => {
    delete process.env.ASSET_PROJECT_NAME;

    const config = loadConfig();

    expect(config.assetProjectName).toBe("");
  });

  it("reads an Asset project name only when explicitly configured", () => {
    process.env.ASSET_PROJECT_NAME = "project-a";

    const config = loadConfig();

    expect(config.assetProjectName).toBe("project-a");
  });

  it("defaults Volcengine service signing to ark", () => {
    delete process.env.VOLCENGINE_SERVICE;

    const config = loadConfig();

    expect(config.volcengineService).toBe("ark");
  });

  it("allows Volcengine service signing to be configured explicitly", () => {
    process.env.VOLCENGINE_SERVICE = "ark";

    const config = loadConfig();

    expect(config.volcengineService).toBe("ark");
  });

  it("defaults video polling timeout to one hour", () => {
    delete process.env.POLL_TIMEOUT_SECONDS;

    const config = loadConfig();

    expect(config.pollTimeoutMs).toBe(3600 * 1000);
  });

  it("defaults video polling retries to five transient failures", () => {
    delete process.env.MAX_POLL_RETRY_COUNT;

    const config = loadConfig();

    expect(config.maxPollRetryCount).toBe(5);
  });

  it("allows video polling retries to be configured explicitly", () => {
    process.env.MAX_POLL_RETRY_COUNT = "8";

    const config = loadConfig();

    expect(config.maxPollRetryCount).toBe(8);
  });

  it("defaults video task concurrency to one hundred", () => {
    delete process.env.MAX_CONCURRENT_VIDEO_TASKS;

    const config = loadConfig();

    expect(config.maxConcurrentVideoTasks).toBe(100);
  });

  it("allows video task concurrency to be configured explicitly", () => {
    process.env.MAX_CONCURRENT_VIDEO_TASKS = "12";

    const config = loadConfig();

    expect(config.maxConcurrentVideoTasks).toBe(12);
  });

  it("defaults token price to the current configured estimate", () => {
    delete process.env.TOKEN_PRICE_PER_THOUSAND;

    const config = loadConfig();

    expect(config.tokenPricePerThousand).toBe(0.049085);
  });

  it("allows token price to be configured explicitly", () => {
    process.env.TOKEN_PRICE_PER_THOUSAND = "0.05";

    const config = loadConfig();

    expect(config.tokenPricePerThousand).toBe(0.05);
  });

  it("defaults local compute manager URL to StrangeOrchestrator", () => {
    delete process.env.STRANGE_ORCHESTRATOR_URL;

    const config = loadConfig();

    expect(config.strangeOrchestratorURL).toBe("http://127.0.0.1:8790");
  });

  it("allows local compute manager URL to be configured explicitly", () => {
    process.env.STRANGE_ORCHESTRATOR_URL = "http://127.0.0.1:8791";

    const config = loadConfig();

    expect(config.strangeOrchestratorURL).toBe("http://127.0.0.1:8791");
  });

  it("does not enable cross-origin frontend access unless configured", () => {
    delete process.env.CORS_ORIGIN;

    const config = loadConfig();

    expect(config.corsOrigin).toBe("");
  });

  it("allows the separate frontend origin to be configured", () => {
    process.env.CORS_ORIGIN = "http://127.0.0.1:5173";

    const config = loadConfig();

    expect(config.corsOrigin).toBe("http://127.0.0.1:5173");
  });
});

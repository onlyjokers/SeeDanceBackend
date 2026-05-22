import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../server/lib/config.js";

describe("server host binding", () => {
  const originalAssetProjectName = process.env.ASSET_PROJECT_NAME;
  const originalVolcengineService = process.env.VOLCENGINE_SERVICE;
  const originalPollTimeoutSeconds = process.env.POLL_TIMEOUT_SECONDS;

  afterEach(() => {
    if (originalAssetProjectName === undefined) delete process.env.ASSET_PROJECT_NAME;
    else process.env.ASSET_PROJECT_NAME = originalAssetProjectName;
    if (originalVolcengineService === undefined) delete process.env.VOLCENGINE_SERVICE;
    else process.env.VOLCENGINE_SERVICE = originalVolcengineService;
    if (originalPollTimeoutSeconds === undefined) delete process.env.POLL_TIMEOUT_SECONDS;
    else process.env.POLL_TIMEOUT_SECONDS = originalPollTimeoutSeconds;
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
});

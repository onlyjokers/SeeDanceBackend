import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoClient } from "../server/lib/videoClient.js";
import type { AppConfig } from "../server/lib/config.js";
import type { RuntimeSettings } from "../server/types.js";

const config: AppConfig = {
  port: 8787,
  host: "127.0.0.1",
  databasePath: "data/test.json",
  sqlitePath: "data/test.sqlite",
  downloadDir: "data/downloads",
  uploadDir: "data/uploads",
  volcengineAK: "",
  volcengineSK: "",
  volcengineRegion: "cn-beijing",
  volcengineService: "ark",
  arkAPIKey: "ark-test",
  arkVideoModel: "ep-should-not-override-selected-model",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "",
  pollIntervalMs: 5000,
  pollTimeoutMs: 3600000,
  maxPollRetryCount: 5,
  maxConcurrentVideoTasks: 100
};

const runtimeSettings: RuntimeSettings = {
  port: "8787",
  host: "127.0.0.1",
  databasePath: "data/test.json",
  sqlitePath: "data/test.sqlite",
  downloadDir: "data/downloads",
  uploadDir: "data/uploads",
  volcengineAK: "",
  volcengineSK: "",
  volcengineRegion: "cn-beijing",
  volcengineService: "ark",
  arkAPIKey: "ark-test",
  arkVideoModel: "ep-should-not-override-selected-model",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "",
  pollIntervalSeconds: "5",
  pollTimeoutSeconds: "3600",
  maxPollRetryCount: "5",
  maxConcurrentVideoTasks: "100"
};

describe("VideoClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the selected official Seedance model instead of one shared runtime EP", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "task-1" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new VideoClient(config, () => runtimeSettings);
    await client.createTask({
      modelVersion: "doubao-seedance-2-0-fast-260128",
      prompt: "生成一个产品视频",
      mode: "text",
      ratio: "16:9",
      duration: 5,
      resolution: "1080p",
      references: []
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("doubao-seedance-2-0-fast-260128");
    expect(body.model).not.toBe("ep-should-not-override-selected-model");
    expect(body.resolution).toBe("1080p");
    expect(body).not.toHaveProperty("video_resolution");
  });
});

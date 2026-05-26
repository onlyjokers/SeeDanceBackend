import { afterEach, describe, expect, it, vi } from "vitest";
import { InferenceUsageClient } from "../server/lib/inferenceUsageClient.js";
import type { RuntimeSettings } from "../server/types.js";

vi.mock("../server/lib/volcengineSigner.js", () => ({
  signVolcengineRequest: () => ({
    amzDate: "20260521T000000Z",
    contentHash: "hash",
    authorization: "VOLCENGINE-HMAC-SHA256 Credential=test"
  })
}));

const settings: RuntimeSettings = {
  port: "8787",
  host: "0.0.0.0",
  databasePath: "data/seendance.json",
  sqlitePath: "data/seendance.sqlite",
  downloadDir: "data/downloads",
  uploadDir: "data/uploads",
  volcengineAK: "ak",
  volcengineSK: "sk",
  volcengineRegion: "cn-beijing",
  volcengineService: "ark",
  arkAPIKey: "ark",
  arkVideoModel: "ep",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "QiShiYi",
  pollIntervalSeconds: "5",
  pollTimeoutSeconds: "3600",
  maxPollRetryCount: "5",
  maxConcurrentVideoTasks: "100",
  tokenPricePerThousand: "0.049085"
};

describe("InferenceUsageClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries GetInferenceUsage and totals official request/token/image counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(_url)).toContain("GetInferenceUsage");
      return new Response(JSON.stringify({
        Result: {
          Fields: [
            { Name: "Day" },
            { Name: "InputTokens" },
            { Name: "OutputTokens" },
            { Name: "ImageCount" },
            { Name: "ReqCnt" }
          ],
          Data: [
            ["2026-05-20", "10", "20", "2", "1"],
            ["2026-05-21", "5", "7", "1", "3"]
          ],
          DataCount: 2
        }
      }), { status: 200 });
    }));

    const usage = await new InferenceUsageClient().getRecentUsage(settings, { days: 7 });

    expect(usage.source).toBe("official");
    expect(usage.totals).toEqual({
      requests: 4,
      inputTokens: 15,
      outputTokens: 27,
      totalTokens: 42,
      imageCount: 3
    });
    expect(usage.rows).toHaveLength(2);
  });
});

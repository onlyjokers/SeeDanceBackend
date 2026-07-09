import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsClient } from "../server/lib/assetsClient.js";
import type { AppConfig } from "../server/lib/config.js";

vi.mock("../server/lib/volcengineSigner.js", () => ({
  signVolcengineRequest: () => ({
    amzDate: "20260520T000000Z",
    contentHash: "hash",
    authorization: "VOLCENGINE-HMAC-SHA256 Credential=test"
  })
}));

const config: AppConfig = {
  port: 8787,
  host: "0.0.0.0",
  databasePath: "data/test.json",
  sqlitePath: "data/test.sqlite",
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
  assetProjectName: "",
  pollIntervalMs: 1000,
  pollTimeoutMs: 10000,
  maxPollRetryCount: 5,
  maxConcurrentVideoTasks: 100,
  strangeOrchestratorURL: "http://127.0.0.1:8790",
  tokenPricePerThousand: 0.049085,
  corsOrigin: ""
};

describe("AssetsClient ProjectName handling", () => {
  const bodies: unknown[] = [];

  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ Result: { Id: "Asset-1", Status: "Active" } }), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send ProjectName for asset operations unless explicitly provided", async () => {
    const client = new AssetsClient(config);

    await client.getAsset("Asset-1");
    await client.listAssetGroups();
    await client.listAssets(["group-1"]);
    await client.updateAssetGroup({ id: "group-1", name: "refs" });
    await client.updateAsset({ id: "Asset-1", name: "ref" });
    await client.deleteAsset("Asset-1");

    expect(bodies).toHaveLength(6);
    for (const body of bodies) expect(body).not.toHaveProperty("ProjectName");
  });

  it("sends ProjectName for asset operations when explicitly provided", async () => {
    const client = new AssetsClient(config);

    await client.getAsset("Asset-1", "project-a");
    await client.listAssetGroups("project-a");
    await client.listAssets(["group-1"], "project-a");
    await client.updateAssetGroup({ id: "group-1", name: "refs", projectName: "project-a" });
    await client.updateAsset({ id: "Asset-1", name: "ref", projectName: "project-a" });
    await client.deleteAsset("Asset-1", "project-a");

    expect(bodies).toHaveLength(6);
    for (const body of bodies) expect(body).toMatchObject({ ProjectName: "project-a" });
  });

  it("does not keep an implicit default project name from create responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({
        Result: {
          Id: bodies.length === 1 ? "group-1" : "Asset-1",
          ProjectName: "default"
        }
      }), { status: 200 });
    }));
    const client = new AssetsClient(config);

    const group = await client.createAssetGroup({ name: "refs" });
    const asset = await client.createAsset({ groupId: group.id, url: "https://example.com/ref.png", assetType: "Image" });

    expect(group.projectName).toBe("");
    expect(asset.projectName).toBe("");
  });

  it("retries transient Volcengine request failures with the configured retry count", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Result: { Id: "Asset-1", Status: "Active" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const retries: string[] = [];
    const client = new AssetsClient(config, undefined, {
      maxRetries: 1,
      onRetry: ({ message }) => {
        retries.push(message);
      }
    });

    const asset = await client.getAsset("Asset-1");

    expect(asset.id).toBe("Asset-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retries).toEqual(["fetch failed"]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageClient } from "../server/lib/imageClient.js";
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
  arkAPIKey: "",
  arkVideoModel: "ep",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "",
  pollIntervalMs: 5000,
  pollTimeoutMs: 3600000,
  maxPollRetryCount: 5,
  maxConcurrentVideoTasks: 100,
  maxConcurrentImageTasks: 8,
  tokenPricePerThousand: 0.049085,
  imageTokenPricePerThousand: 0.049085,
  image2APIKey: "image-key",
  image2APIURL: "https://www.cctq.ai/v1/chat/completions",
  image2Model: "gpt-image-2",
  corsOrigin: ""
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
  arkAPIKey: "",
  arkVideoModel: "ep",
  arkBaseURL: "https://ark.cn-beijing.volces.com",
  imageHostURL: "https://uguu.se/upload.php",
  assetProjectName: "",
  pollIntervalSeconds: "5",
  pollTimeoutSeconds: "3600",
  maxPollRetryCount: "5",
  maxConcurrentVideoTasks: "100",
  maxConcurrentImageTasks: "8",
  tokenPricePerThousand: "0.049085",
  imageTokenPricePerThousand: "0.049085",
  image2APIKey: "image-key",
  image2APIURL: "https://www.cctq.ai/v1/chat/completions",
  image2Model: "gpt-image-2"
};

describe("ImageClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads one reference image and sends image2 edits as Micu multipart image form data", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const value = String(url);
      if (value === "https://example.test/ref.png") {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "Content-Type": "image/png" }
        });
      }
      if (value === "https://www.cctq.ai/v1/images/edits") {
        return new Response(JSON.stringify({
          created: 123,
          data: [{ url: "https://example.test/result.png" }],
          usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`unexpected fetch: ${value}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ImageClient(config, () => runtimeSettings);
    const result = await client.generate({
      prompt: "生成一张产品图",
      ratio: "1:1",
      imageResolution: "2k",
      imageQuality: "medium",
      references: [{ role: "reference", assetType: "Image", sourceUrl: "https://example.test/ref.png" }]
    });

    expect(result.imageUrls).toEqual(["https://example.test/result.png"]);
    expect(result.tokenUsage).toEqual({ inputTokens: 11, outputTokens: 22, totalTokens: 33 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://example.test/ref.png");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://www.cctq.ai/v1/images/edits", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer image-key"
      })
    }));
    expect(fetchMock.mock.calls[1][1]?.headers).not.toHaveProperty("Content-Type");
    const body = fetchMock.mock.calls[1][1]?.body;
    expect(body).toBeInstanceOf(FormData);
    const formData = body as FormData;
    expect(formData.get("model")).toBe("gpt-image-2");
    expect(formData.get("prompt")).toBe("生成一张产品图");
    expect(formData.get("size")).toBe("2048x2048");
    expect(formData.get("quality")).toBe("medium");
    expect(formData.get("n")).toBe("1");
    expect(formData.get("response_format")).toBe("url");
    expect(formData.get("image")).toBeInstanceOf(Blob);
    expect(formData.getAll("image[]")).toHaveLength(0);
    expect(formData.get("tools")).toBeNull();
    expect(formData.get("tool_choice")).toBeNull();
  });

  it("normalizes chat completions settings to image edit endpoints for reference image generation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const value = String(url);
      if (value === "https://example.test/ref.png") {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "Content-Type": "image/png" }
        });
      }
      if (value === "https://www.cctq.ai/v1/images/edits") {
        return new Response(JSON.stringify({ data: [{ url: "https://example.test/result.png" }] }));
      }
      throw new Error(`unexpected fetch: ${value}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ImageClient(config, () => ({
      ...runtimeSettings,
      image2APIURL: "https://www.cctq.ai/v1/chat/completions"
    }));
    await client.generate({
      prompt: "参考图编辑",
      ratio: "16:9",
      imageResolution: "2k",
      imageQuality: "high",
      references: [{ role: "reference", assetType: "Image", sourceUrl: "https://example.test/ref.png" }]
    });

    expect(fetchMock.mock.calls[1][0]).toBe("https://www.cctq.ai/v1/images/edits");
  });

  it("sends multiple reference images as repeated image array form parts", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const value = String(url);
      if (value.startsWith("https://example.test/ref-")) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "Content-Type": "image/png" }
        });
      }
      if (value === "https://www.cctq.ai/v1/images/edits") {
        return new Response(JSON.stringify({ data: [{ url: "https://example.test/result.png" }] }));
      }
      throw new Error(`unexpected fetch: ${value}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ImageClient(config, () => runtimeSettings);
    await client.generate({
      prompt: "融合多张参考图",
      ratio: "1:1",
      imageResolution: "1k",
      imageQuality: "auto",
      references: [
        { role: "reference", assetType: "Image", sourceUrl: "https://example.test/ref-1.png" },
        { role: "reference", assetType: "Image", sourceUrl: "https://example.test/ref-2.png" }
      ]
    });

    const formData = fetchMock.mock.calls[2][1]?.body as FormData;
    expect(formData.get("image")).toBeNull();
    expect(formData.getAll("image[]")).toHaveLength(2);
    expect(formData.get("response_format")).toBe("url");
  });

  it("supports pure prompt generation without reference images", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: [{ type: "image_url", image_url: { url: "https://example.test/prompt-only.png" } }] } }]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ImageClient(config, () => runtimeSettings);
    const result = await client.generate({
      prompt: "纯文字生成",
      ratio: "16:9",
      imageResolution: "1k",
      imageQuality: "auto",
      references: []
    });

    expect(result.imageUrls).toEqual(["https://example.test/prompt-only.png"]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.prompt).toBe("纯文字生成");
    expect(body.size).toBe("1792x1024");
    expect(body.quality).toBe("auto");
    expect(body).not.toHaveProperty("image_urls");
  });

  it("includes the normalized endpoint in image API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: { message: "Tool choice 'image_generation' not found in 'tools' parameter." }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ImageClient(config, () => ({
      ...runtimeSettings,
      image2APIURL: "https://www.cctq.ai/v1/chat/completions"
    }));
    await expect(client.generate({
      prompt: "纯文字生成",
      ratio: "16:9",
      imageResolution: "1k",
      imageQuality: "auto",
      references: []
    })).rejects.toThrow("endpoint=https://www.cctq.ai/v1/images/generations");
  });

  it("maps 2k square requests to the documented 2048 size", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: [{ url: "https://example.test/2k.png" }] })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ImageClient(config, () => runtimeSettings);
    await client.generate({
      prompt: "2k 方图",
      ratio: "1:1",
      imageResolution: "2k",
      imageQuality: "high",
      references: []
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.size).toBe("2048x2048");
    expect(body.quality).toBe("high");
  });

  it("allows any image ratio at 2k by computing size from the resolution tier", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: [{ url: "https://example.test/wide-2k.png" }] })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ImageClient(config, () => runtimeSettings);
    await client.generate({
      prompt: "2k 横版",
      ratio: "16:9",
      imageResolution: "2k",
      imageQuality: "high",
      references: []
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.size).toBe("3584x2048");
  });
});

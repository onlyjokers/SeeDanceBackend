import { describe, expect, it, vi } from "vitest";
import { uploadImageToTemporaryHost } from "../server/lib/uploadProvider.js";

describe("temporary image upload provider", () => {
  it("returns a public https image url from the provider response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        files: [{ url: "https://n.uguu.se/example.png" }]
      })
    });

    const result = await uploadImageToTemporaryHost(
      new File([new Uint8Array([1, 2, 3])], "reference.png", { type: "image/png" }),
      fetchMock as unknown as typeof fetch
    );

    expect(result).toEqual({
      provider: "uguu",
      url: "https://n.uguu.se/example.png",
      expiresIn: "temporary"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://uguu.se/upload.php",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("rejects non-url upload responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "upload failed"
    });

    await expect(uploadImageToTemporaryHost(
      new File([new Uint8Array([1])], "reference.png", { type: "image/png" }),
      fetchMock as unknown as typeof fetch
    )).rejects.toThrow("图床没有返回可用的 HTTPS 图片 URL");
  });

  it("retries transient upload failures with the configured retry count", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          files: [{ url: "https://n.uguu.se/retried.png" }]
        })
      });
    const retries: string[] = [];

    const result = await uploadImageToTemporaryHost(
      new File([new Uint8Array([1])], "reference.png", { type: "image/png" }),
      "https://uguu.se/upload.php",
      fetchMock as unknown as typeof fetch,
      {
        maxRetries: 1,
        onRetry: ({ message }) => {
          retries.push(message);
        }
      }
    );

    expect(result.url).toBe("https://n.uguu.se/retried.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retries).toEqual(["fetch failed"]);
  });
});

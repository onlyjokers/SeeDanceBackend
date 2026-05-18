import { describe, expect, it } from "vitest";
import { signVolcengineRequest } from "../server/lib/volcengineSigner.js";

describe("Volcengine request signing", () => {
  it("creates signed headers for the Assets API universal endpoint", () => {
    const signed = signVolcengineRequest({
      method: "POST",
      path: "/",
      query: "Action=CreateAssetGroup&Version=2024-01-01",
      body: JSON.stringify({ Name: "test", Description: "test", GroupType: "AIGC", ProjectName: "default" }),
      region: "cn-beijing",
      service: "ark",
      accessKey: "AKLT_TEST",
      secretKey: "SECRET_TEST",
      now: new Date("2026-03-26T00:00:00.000Z")
    });

    expect(signed.amzDate).toBe("20260326T000000Z");
    expect(signed.contentHash).toHaveLength(64);
    expect(signed.authorization).toContain("HMAC-SHA256 Credential=AKLT_TEST/20260326/cn-beijing/ark/request");
    expect(signed.authorization).toContain("SignedHeaders=content-type;host;x-content-sha256;x-date");
    expect(signed.authorization).toContain("Signature=");
  });
});

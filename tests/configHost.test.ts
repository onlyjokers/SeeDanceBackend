import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/lib/config.js";

describe("server host binding", () => {
  it("defaults to 0.0.0.0 so the app can be reached from the LAN", () => {
    const config = loadConfig();

    expect(config.host).toBe("0.0.0.0");
  });
});

import { describe, expect, it } from "vitest";
import { resolveUsageCostEstimate } from "../src/managerUsage.js";

describe("manager usage compatibility", () => {
  it("derives a cost estimate when older local usage responses omit it", () => {
    expect(resolveUsageCostEstimate({
      totals: {
        totalTokens: 120
      }
    })).toEqual({
      currency: "CNY",
      unit: "per_1k_tokens",
      ratePerThousandTokens: 0.049085,
      totalTokens: 120,
      estimatedCost: 0.01
    });
  });
});

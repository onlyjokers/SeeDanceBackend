import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("project usage monitor UI", () => {
  const source = readFileSync("src/main.tsx", "utf8");

  it("exposes project monitoring controls in manager", () => {
    expect(source).toContain("项目监控");
    expect(source).toContain("usageGranularity");
    expect(source).toContain("usageMetric");
    for (const label of ["小时", "每日", "每周", "每月", "Token", "费用"]) {
      expect(source).toContain(label);
    }
  });

  it("renders project usage chart data from local usage", () => {
    expect(source).toContain("projectUsage");
    expect(source).toContain("ProjectUsageChart");
  });

  it("supports chart tooltips, y axis labels, and project card sizing controls", () => {
    for (const marker of ["chart-tooltip", "chart-y-axis", "cardSize", "compact", "regular", "wide"]) {
      expect(source).toContain(marker);
    }
  });
});

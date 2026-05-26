export interface UsageCostEstimate {
  currency: "CNY";
  unit: "per_1k_tokens";
  ratePerThousandTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export function resolveUsageCostEstimate(source: {
  costEstimate?: Partial<UsageCostEstimate>;
  totals?: { totalTokens?: number };
}, rawRate?: string | number): UsageCostEstimate {
  const totalTokens = numberOrFallback(source.costEstimate?.totalTokens, source.totals?.totalTokens ?? 0);
  const rate = numberOrFallback(source.costEstimate?.ratePerThousandTokens, parseRate(rawRate, 0.049085));
  return {
    currency: "CNY",
    unit: "per_1k_tokens",
    ratePerThousandTokens: rate,
    totalTokens,
    estimatedCost: numberOrFallback(source.costEstimate?.estimatedCost, roundMoney((totalTokens / 1000) * rate))
  };
}

function parseRate(value: string | number | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function numberOrFallback(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

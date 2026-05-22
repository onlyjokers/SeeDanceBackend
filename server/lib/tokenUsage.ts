import type { TokenUsage } from "../types.js";

export function extractTokenUsage(source: unknown): TokenUsage | undefined {
  const inputTokens = findNumber(source, ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]);
  const outputTokens = findNumber(source, ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"]);
  const totalTokens = findNumber(source, ["total_tokens", "totalTokens"]);

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;

  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  const total = totalTokens ?? input + output;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total
  };
}

function findNumber(source: unknown, keys: string[]): number | undefined {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const visit = (value: unknown): number | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    for (const [key, child] of Object.entries(value)) {
      if (!wanted.has(key.toLowerCase())) continue;
      if (typeof child === "number" && Number.isFinite(child)) return child;
      if (typeof child === "string" && child.trim()) {
        const parsed = Number(child);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(source);
}

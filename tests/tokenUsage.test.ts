import { describe, expect, it } from "vitest";
import { extractTokenUsage } from "../server/lib/tokenUsage.js";

describe("token usage extraction", () => {
  it("extracts token usage from nested Ark style responses", () => {
    expect(extractTokenUsage({
      result: {
        usage: {
          prompt_tokens: "12",
          completion_tokens: 88,
          total_tokens: 100
        }
      }
    })).toEqual({
      inputTokens: 12,
      outputTokens: 88,
      totalTokens: 100
    });
  });

  it("derives total tokens when only input and output are returned", () => {
    expect(extractTokenUsage({
      usage: {
        input_tokens: 7,
        output_tokens: 13
      }
    })).toEqual({
      inputTokens: 7,
      outputTokens: 13,
      totalTokens: 20
    });
  });

  it("uses completion tokens as output tokens when prompt tokens are absent", () => {
    expect(extractTokenUsage({
      usage: {
        completion_tokens: 50638,
        total_tokens: 50638
      }
    })).toEqual({
      inputTokens: 0,
      outputTokens: 50638,
      totalTokens: 50638
    });
  });
});

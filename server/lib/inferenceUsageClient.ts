import { signVolcengineRequest } from "./volcengineSigner.js";
import type { RuntimeSettings } from "../types.js";

const endpoint = "https://open.volcengineapi.com";
const apiVersion = "2024-01-01";

export interface OfficialInferenceUsageSummary {
  source: "official";
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    imageCount: number;
  };
  rows: Array<Record<string, string | number>>;
  dataCount: number;
  error?: string;
}
type OfficialUsageTotals = OfficialInferenceUsageSummary["totals"];

export class InferenceUsageClient {
  async getRecentUsage(settings: RuntimeSettings, options: { days: number }): Promise<OfficialInferenceUsageSummary> {
    if (!settings.volcengineAK || !settings.volcengineSK) {
      throw new Error("缺少 VOLCENGINE_AK / VOLCENGINE_SK，无法查询官方推理用量。");
    }
    const body = JSON.stringify({
      QueryInterval: "Day",
      StartTime: dateOffset(-Math.max(1, options.days - 1)),
      EndTime: dateOffset(0)
    });
    const query = new URLSearchParams({
      Action: "GetInferenceUsage",
      Version: apiVersion
    }).toString();
    const signature = signVolcengineRequest({
      method: "POST",
      path: "/",
      query,
      body,
      region: settings.volcengineRegion || "cn-beijing",
      service: settings.volcengineService || "ark",
      accessKey: settings.volcengineAK,
      secretKey: settings.volcengineSK
    });
    const response = await fetch(`${endpoint}/?${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "open.volcengineapi.com",
        "X-Date": signature.amzDate,
        "X-Content-Sha256": signature.contentHash,
        Authorization: signature.authorization
      },
      body
    });
    const text = await response.text();
    const decoded = text ? JSON.parse(text) : {};
    if (!response.ok || decoded.ResponseMetadata?.Error) {
      const message = decoded.ResponseMetadata?.Error?.Message || text || response.statusText;
      throw new Error(`GetInferenceUsage 调用失败：${message}`);
    }
    return summarizeUsage(decoded);
  }
}

export function emptyOfficialUsage(error?: string): OfficialInferenceUsageSummary {
  return {
    source: "official",
    totals: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, imageCount: 0 },
    rows: [],
    dataCount: 0,
    error
  };
}

function summarizeUsage(raw: unknown): OfficialInferenceUsageSummary {
  const result = objectAt(raw, ["Result"]) ?? {};
  const fieldNames = fieldsFromResult(result);
  const rows = dataFromResult(result).map((row) => rowToRecord(fieldNames, row));
  const totals = rows.reduce<OfficialUsageTotals>((sum, row) => ({
    requests: sum.requests + numberAt(row, "ReqCnt"),
    inputTokens: sum.inputTokens + numberAt(row, "InputTokens"),
    outputTokens: sum.outputTokens + numberAt(row, "OutputTokens"),
    totalTokens: sum.totalTokens + numberAt(row, "TotalTokens"),
    imageCount: sum.imageCount + numberAt(row, "ImageCount")
  }), { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, imageCount: 0 });
  if (!totals.totalTokens) totals.totalTokens = totals.inputTokens + totals.outputTokens;
  return {
    source: "official",
    totals,
    rows,
    dataCount: numberAt(result, "DataCount") || rows.length
  };
}

function objectAt(source: unknown, path: string[]) {
  const value = path.reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
    return undefined;
  }, source);
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function fieldsFromResult(result: Record<string, unknown>) {
  const fields = Array.isArray(result.Fields) ? result.Fields : [];
  return fields.map((field, index) => {
    if (field && typeof field === "object") {
      const name = (field as Record<string, unknown>).Name ?? (field as Record<string, unknown>).name;
      if (typeof name === "string" && name) return name;
    }
    return `Field${index + 1}`;
  });
}

function dataFromResult(result: Record<string, unknown>) {
  return Array.isArray(result.Data) ? result.Data.filter(Array.isArray) as unknown[][] : [];
}

function rowToRecord(fields: string[], row: unknown[]) {
  return Object.fromEntries(row.map((value, index) => [fields[index] ?? `Field${index + 1}`, normalizeValue(value)]));
}

function normalizeValue(value: unknown) {
  if (typeof value === "number" || typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function numberAt(source: Record<string, unknown>, key: string) {
  const value = source[key];
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dateOffset(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

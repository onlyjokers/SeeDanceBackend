const arrayFields = ["assetGroups", "assets", "videoProjects", "videoTasks", "pollLogs"] as const;

type AppStateArrayField = (typeof arrayFields)[number];

export type NormalizedAppState<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  [K in AppStateArrayField]: unknown[];
};

export function normalizeAppState<T extends Record<string, unknown> = Record<string, unknown>>(value: unknown): NormalizedAppState<T> {
  const source = isRecord(value) ? value : {};
  const normalized: Record<string, unknown> = { ...source };
  for (const field of arrayFields) {
    normalized[field] = Array.isArray(source[field]) ? source[field] : [];
  }
  return normalized as NormalizedAppState<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

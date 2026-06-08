export async function readJsonOrThrow<T = unknown>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");
  const payload = isJson ? await response.json().catch(() => undefined) : undefined;
  const text = isJson ? "" : await response.text().catch(() => "");

  if (response.ok) {
    if (isJson) return payload as T;
    throw new Error(cleanResponseText(text) || fallbackMessage);
  }

  const jsonError = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : "";
  throw new Error(jsonError || cleanResponseText(text) || `${fallbackMessage}（${response.status}）`);
}

function cleanResponseText(value: string) {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

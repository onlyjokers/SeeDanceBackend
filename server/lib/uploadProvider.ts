export interface UploadedImage {
  provider: "uguu";
  url: string;
  expiresIn: "temporary";
}

const uguuEndpoint = "https://uguu.se/upload.php";

export async function uploadImageToTemporaryHost(
  file: File,
  endpointOrFetcher: string | typeof fetch = uguuEndpoint,
  fetcher: typeof fetch = fetch
): Promise<UploadedImage> {
  const endpoint = typeof endpointOrFetcher === "string" ? endpointOrFetcher : uguuEndpoint;
  const request = typeof endpointOrFetcher === "function" ? endpointOrFetcher : fetcher;
  const body = new FormData();
  body.set("files[]", file);

  const response = await request(endpoint, {
    method: "POST",
    body
  });
  const text = (await response.text()).trim();
  if (!response.ok) throw new Error(`图床上传失败：${response.status} ${text}`);
  let decoded: { success?: boolean; files?: Array<{ url?: string }> };
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error("图床没有返回可用的 HTTPS 图片 URL。");
  }
  const url = decoded.files?.[0]?.url?.replaceAll("\\/", "/");
  if (!decoded.success || !url?.startsWith("https://")) throw new Error("图床没有返回可用的 HTTPS 图片 URL。");
  return {
    provider: "uguu",
    url,
    expiresIn: "temporary"
  };
}

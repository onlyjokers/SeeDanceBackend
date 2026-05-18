import { createHash, createHmac } from "node:crypto";

export interface SignInput {
  method: string;
  path: string;
  query?: string;
  body: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  now?: Date;
}

export function signVolcengineRequest(input: SignInput) {
  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const shortDate = amzDate.slice(0, 8);
  const contentHash = sha256Hex(input.body);
  const canonicalHeaders = [
    `content-type:application/json`,
    `host:open.volcengineapi.com`,
    `x-content-sha256:${contentHash}`,
    `x-date:${amzDate}`
  ].join("\n") + "\n";
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    input.query ?? "",
    canonicalHeaders,
    signedHeaders,
    contentHash
  ].join("\n");
  const credentialScope = `${shortDate}/${input.region}/${input.service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = getSigningKey(input.secretKey, shortDate, input.region, input.service);
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = `HMAC-SHA256 Credential=${input.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    amzDate,
    contentHash
  };
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function getSigningKey(secretKey: string, date: string, region: string, service: string) {
  const kDate = hmac(secretKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "request");
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

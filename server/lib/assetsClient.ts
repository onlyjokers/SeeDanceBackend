import type { AppConfig } from "./config.js";
import { buildCreateAssetGroupPayload, buildCreateAssetPayload, type AssetType } from "./payloads.js";
import { retryOperation, type RetryOptions } from "./retry.js";
import { signVolcengineRequest } from "./volcengineSigner.js";
import type { Asset, AssetGroup, RuntimeSettings } from "../types.js";

const apiVersion = "2024-01-01";
const endpoint = "https://open.volcengineapi.com";
const withProjectName = (payload: Record<string, unknown>, projectName?: string) => {
  if (projectName) payload.ProjectName = projectName;
  return payload;
};
type RuntimeSettingsProvider = () => RuntimeSettings | Promise<RuntimeSettings>;

export class AssetsClient {
  constructor(
    private readonly config: AppConfig,
    private readonly runtimeSettings?: RuntimeSettingsProvider,
    private readonly retryOptions?: RetryOptions
  ) {}

  async isConfigured() {
    const settings = await this.settings();
    return Boolean(settings.volcengineAK && settings.volcengineSK);
  }

  async createAssetGroup(input: { name: string; description?: string; projectName?: string }) {
    const payload = buildCreateAssetGroupPayload(input);
    const raw = await this.call("CreateAssetGroup", payload);
    const id = stringAt(raw, ["Result", "Id"]) || stringAt(raw, ["Id"]);
    if (!id) throw new Error("CreateAssetGroup 响应里没有 Id");
    const group: AssetGroup = {
      id,
      name: input.name,
      description: input.description ?? "",
      groupType: "AIGC",
      projectName: responseProjectName(raw, input.projectName),
      createTime: stringAt(raw, ["Result", "CreateTime"]),
      updateTime: stringAt(raw, ["Result", "UpdateTime"]),
      raw
    };
    return group;
  }

  async createAsset(input: { groupId: string; url: string; name?: string; assetType: AssetType; projectName?: string }) {
    const raw = await this.call("CreateAsset", buildCreateAssetPayload(input));
    const id = stringAt(raw, ["Result", "Id"]) || stringAt(raw, ["Result", "AssetId"]) || stringAt(raw, ["Id"]);
    if (!id) throw new Error("CreateAsset 响应里没有 Id");
    const asset: Asset = {
      id,
      name: input.name ?? "",
      url: input.url,
      assetType: input.assetType,
      groupId: input.groupId,
      status: "Processing",
      projectName: responseProjectName(raw, input.projectName),
      raw
    };
    return asset;
  }

  async getAsset(id: string, projectName?: string) {
    const raw = await this.call("GetAsset", withProjectName({ Id: id }, projectName));
    const result = objectAt(raw, ["Result"]) ?? raw;
    const asset: Asset = {
      id: stringAt(result, ["Id"]) || id,
      name: stringAt(result, ["Name"]),
      url: stringAt(result, ["URL"]),
      assetType: (stringAt(result, ["AssetType"]) || "Image") as AssetType,
      groupId: stringAt(result, ["GroupId"]),
      status: stringAt(result, ["Status"]) || "Processing",
      errorCode: stringAt(result, ["Error", "Code"]),
      errorMessage: stringAt(result, ["Error", "Message"]),
      projectName: stringAt(result, ["ProjectName"]) || projectName || "",
      createTime: stringAt(result, ["CreateTime"]),
      updateTime: stringAt(result, ["UpdateTime"]),
      raw
    };
    return asset;
  }

  async listAssetGroups(projectName?: string) {
    return this.call("ListAssetGroups", withProjectName({
      Filter: { GroupType: "AIGC" },
      PageNumber: 1,
      PageSize: 100,
      SortBy: "CreateTime",
      SortOrder: "Desc"
    }, projectName));
  }

  async listAssets(groupIds: string[] = [], projectName?: string) {
    return this.call("ListAssets", withProjectName({
      Filter: { GroupType: "AIGC", ...(groupIds.length ? { GroupIds: groupIds } : {}) },
      PageNumber: 1,
      PageSize: 100,
      SortBy: "CreateTime",
      SortOrder: "Desc"
    }, projectName));
  }

  async updateAssetGroup(input: { id: string; name: string; description?: string; projectName?: string }) {
    const raw = await this.call("UpdateAssetGroup", withProjectName({
      Id: input.id,
      Name: input.name,
      Description: input.description ?? ""
    }, input.projectName));
    return raw;
  }

  async updateAsset(input: { id: string; name: string; projectName?: string }) {
    return this.call("UpdateAsset", withProjectName({
      Id: input.id,
      Name: input.name
    }, input.projectName));
  }

  async deleteAsset(id: string, projectName?: string) {
    return this.call("DeleteAsset", withProjectName({ Id: id }, projectName));
  }

  private async call(action: string, payload: unknown) {
    const settings = await this.settings();
    if (!settings.volcengineAK || !settings.volcengineSK) {
      throw new Error("缺少 VOLCENGINE_AK / VOLCENGINE_SK，无法调用 Assets API。");
    }
    const body = JSON.stringify(payload);
    const query = new URLSearchParams({
      Action: action,
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
    const run = async () => {
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
        throw new Error(`${action} 调用失败：${message}`);
      }
      return decoded;
    };
    return this.retryOptions ? retryOperation(run, this.retryOptions) : run();
  }

  private async settings(): Promise<RuntimeSettings> {
    return this.runtimeSettings ? await this.runtimeSettings() : {
      port: String(this.config.port),
      host: this.config.host,
      databasePath: this.config.databasePath,
      sqlitePath: this.config.sqlitePath,
      downloadDir: this.config.downloadDir,
      uploadDir: this.config.uploadDir,
      volcengineAK: this.config.volcengineAK,
      volcengineSK: this.config.volcengineSK,
      volcengineRegion: this.config.volcengineRegion,
      volcengineService: this.config.volcengineService,
      arkAPIKey: this.config.arkAPIKey,
      arkVideoModel: this.config.arkVideoModel,
      arkBaseURL: this.config.arkBaseURL,
      imageHostURL: this.config.imageHostURL,
      assetProjectName: this.config.assetProjectName,
      pollIntervalSeconds: String(this.config.pollIntervalMs / 1000),
      pollTimeoutSeconds: String(this.config.pollTimeoutMs / 1000),
      maxPollRetryCount: String(this.config.maxPollRetryCount)
    };
  }
}

function objectAt(source: unknown, path: string[]) {
  const value = path.reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
    return undefined;
  }, source);
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function stringAt(source: unknown, path: string[]) {
  const value = path.reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
    return undefined;
  }, source);
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function responseProjectName(raw: unknown, requested?: string) {
  if (requested) return requested;
  const projectName = stringAt(raw, ["Result", "ProjectName"]);
  return projectName === "default" ? "" : projectName;
}

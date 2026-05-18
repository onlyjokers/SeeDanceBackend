import type { AppConfig } from "./config.js";
import { buildCreateAssetGroupPayload, buildCreateAssetPayload, type AssetType } from "./payloads.js";
import { signVolcengineRequest } from "./volcengineSigner.js";
import type { Asset, AssetGroup } from "../types.js";

const serviceName = "ark";
const apiVersion = "2024-01-01";
const endpoint = "https://open.volcengineapi.com";

export class AssetsClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return Boolean(this.config.volcengineAK && this.config.volcengineSK);
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
      projectName: input.projectName || "default",
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
      projectName: input.projectName || "default",
      raw
    };
    return asset;
  }

  async getAsset(id: string, projectName = "default") {
    const raw = await this.call("GetAsset", { Id: id, ProjectName: projectName });
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
      projectName: stringAt(result, ["ProjectName"]) || projectName,
      createTime: stringAt(result, ["CreateTime"]),
      updateTime: stringAt(result, ["UpdateTime"]),
      raw
    };
    return asset;
  }

  async listAssetGroups(projectName = "default") {
    return this.call("ListAssetGroups", {
      Filter: { GroupType: "AIGC" },
      PageNumber: 1,
      PageSize: 100,
      SortBy: "CreateTime",
      SortOrder: "Desc",
      ProjectName: projectName
    });
  }

  async listAssets(groupIds: string[] = [], projectName = "default") {
    return this.call("ListAssets", {
      Filter: { GroupType: "AIGC", ...(groupIds.length ? { GroupIds: groupIds } : {}) },
      PageNumber: 1,
      PageSize: 100,
      SortBy: "CreateTime",
      SortOrder: "Desc",
      ProjectName: projectName
    });
  }

  async updateAssetGroup(input: { id: string; name: string; description?: string; projectName?: string }) {
    const raw = await this.call("UpdateAssetGroup", {
      Id: input.id,
      Name: input.name,
      Description: input.description ?? "",
      ProjectName: input.projectName || "default"
    });
    return raw;
  }

  async updateAsset(input: { id: string; name: string; projectName?: string }) {
    return this.call("UpdateAsset", {
      Id: input.id,
      Name: input.name,
      ProjectName: input.projectName || "default"
    });
  }

  async deleteAsset(id: string, projectName = "default") {
    return this.call("DeleteAsset", { Id: id, ProjectName: projectName });
  }

  private async call(action: string, payload: unknown) {
    if (!this.isConfigured()) {
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
      region: this.config.volcengineRegion,
      service: serviceName,
      accessKey: this.config.volcengineAK,
      secretKey: this.config.volcengineSK
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
      throw new Error(`${action} 调用失败：${message}`);
    }
    return decoded;
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

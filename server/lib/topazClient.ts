import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { AppConfig } from "./config.js";
import type { RuntimeSettings, TopazTaskMetadata } from "../types.js";
export { assertControlledTopazSourcePath } from "./topazSourcePath.js";

export type TopazTargetPreset = "2k" | "4k" | "8k" | "2x" | "4x" | "8x";
export type TopazProcessMode = "upscale" | "enhance" | "stabilize" | "interpolate";

export interface TopazSourceInfo {
  width?: number;
  height?: number;
  duration?: string;
  bitrate?: string;
  videoCodec?: string;
}

export interface TopazProcessInput {
  taskId: string;
  sourcePath: string;
  settings: RuntimeSettings;
  topaz: TopazTaskMetadata;
}

export interface TopazProcessResult {
  outputPath: string;
  outputSize: number;
  durationMs: number;
  sourceInfo: TopazSourceInfo;
  scale: number;
  targetWidth?: number;
  targetHeight?: number;
  raw: unknown;
}

export interface TopazTargetSpec {
  scale: number;
  width?: number;
  height?: number;
  estimate?: number;
}

export class TopazClient {
  constructor(private readonly config: AppConfig) {}

  async process(input: TopazProcessInput): Promise<TopazProcessResult> {
    const started = Date.now();
    const cliPath = input.settings.topazCLIPath || this.config.topazCLIPath || "topaz-video";
    const workDir = resolve(input.settings.topazWorkDir || this.config.topazWorkDir || "data/topaz");
    const downloadDir = resolve(input.settings.downloadDir || this.config.downloadDir);
    const sourcePath = resolve(input.sourcePath);
    await mkdir(workDir, { recursive: true });
    await mkdir(downloadDir, { recursive: true });

    const sourceInfo = await this.probe(cliPath, sourcePath);
    const targetSpec = targetSpecForTopazTarget(sourceInfo, input.topaz.targetPreset);
    const extension = extname(sourcePath) || ".mp4";
    const outputPath = resolve(downloadDir, `${input.taskId}-topaz${extension}`);
    const processModes = topazProcessModesFor(input.topaz);
    const rawSteps: unknown[] = [];
    let currentInputPath = sourcePath;
    for (const [index, mode] of processModes.entries()) {
      const stepOutputPath = index === processModes.length - 1
        ? outputPath
        : resolve(workDir, `${input.taskId}-topaz-step-${index + 1}${extension}`);
      const args = [
        "process",
        currentInputPath,
        stepOutputPath,
        "--model",
        mode
      ];
      appendModeSpecificArgs(args, mode, input.topaz, targetSpec, input.settings.topazDefaultAIModel || this.config.topazDefaultAIModel || "prob-4");
      appendOutputArgs(args, input.topaz, targetSpec);
      args.push("--json");
      rawSteps.push(await runTopazJSON(cliPath, args, workDir));
      currentInputPath = stepOutputPath;
    }

    const outputSize = (await stat(outputPath)).size;
    return {
      outputPath,
      outputSize,
      durationMs: Date.now() - started,
      sourceInfo,
      scale: targetSpec.scale,
      targetWidth: targetSpec.width,
      targetHeight: targetSpec.height,
      raw: rawSteps.length === 1 ? rawSteps[0] : { steps: rawSteps }
    };
  }

  private async probe(cliPath: string, sourcePath: string): Promise<TopazSourceInfo> {
    const raw = await runTopazJSON(cliPath, ["probe", sourcePath, "--json"], undefined);
    const record = isRecord(raw) ? raw : {};
    return {
      width: numberField(record.width),
      height: numberField(record.height),
      duration: stringField(record.duration),
      bitrate: stringField(record.bitrate),
      videoCodec: stringField(record.video_codec)
    };
  }
}

function topazProcessModesFor(topaz: TopazTaskMetadata): TopazProcessMode[] {
  const modes = topaz.processModes?.length ? topaz.processModes : [topaz.processMode];
  return modes.filter((mode, index) => modes.indexOf(mode) === index) as TopazProcessMode[];
}

export function targetSpecForTopazTarget(source: { width?: number; height?: number }, preset: TopazTargetPreset): TopazTargetSpec {
  if (preset.endsWith("x")) return { scale: Number(preset.slice(0, -1)) };
  const landscapeTargets: Record<Extract<TopazTargetPreset, "2k" | "4k" | "8k">, { width: number; height: number }> = {
    "2k": { width: 2048, height: 1152 },
    "4k": { width: 3840, height: 2160 },
    "8k": { width: 7680, height: 4320 }
  };
  const target = landscapeTargets[preset as "2k" | "4k" | "8k"];
  const vertical = (source.height ?? 0) > (source.width ?? 0);
  return {
    scale: 0,
    width: vertical ? target.height : target.width,
    height: vertical ? target.width : target.height,
    estimate: 8
  };
}

export function resolveTopazAIModel(value: string) {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    proteus: "prob-4",
    "prob-4": "prob-4",
    rhea: "rhea-1",
    "rhea-1": "rhea-1",
    "rhea-xl": "rxl-1",
    "rxl-1": "rxl-1",
    nyx: "nyx-3",
    "nyx-3": "nyx-3",
    iris: "iris-2",
    "iris-2": "iris-2",
    artemis: "ahq-12",
    "ahq-12": "ahq-12",
    gfx: "gcg-5",
    "gcg-5": "gcg-5"
  };
  if (aliases[normalized]) return aliases[normalized];
  return value;
}

export function resolveTopazCodec(value: string, platform: NodeJS.Platform = process.platform) {
  const normalized = value.trim().toLowerCase();
  if ([
    "h264_videotoolbox",
    "hevc_videotoolbox",
    "prores_videotoolbox",
    "libx264",
    "libx265",
    "prores_ks"
  ].includes(normalized)) {
    return "h264_mf";
  }
  if (platform === "win32" && normalized !== "h264_mf") return "h264_mf";
  return normalized || "h264_mf";
}

function appendModeSpecificArgs(args: string[], mode: TopazProcessMode, topaz: TopazTaskMetadata, target: TopazTargetSpec, defaultAIModel: string) {
  if (mode === "upscale" || mode === "enhance") {
    args.push("--ai-model", resolveTopazAIModel(topaz.aiModel || defaultAIModel));
    args.push("--scale", String(target.scale));
    if (target.width !== undefined && target.height !== undefined) {
      args.push("--width", String(target.width), "--height", String(target.height));
    }
    if (target.estimate !== undefined) args.push("--estimate", String(target.estimate));
    appendQualityParams(args, topaz.qualityParams, [
      "preblur",
      "noise",
      "details",
      "halo",
      "blur",
      "compression",
      "prenoise",
      "grain",
      "gsize",
      "kcolor",
      "blend",
      "device",
      "vram",
      "instances"
    ]);
    return;
  }
  if (mode === "stabilize") {
    appendQualityParams(args, topaz.qualityParams, [
      "smoothness",
      "stabilize-full",
      "ws",
      "csx",
      "csy",
      "dof",
      "roll",
      "reduce",
      "device",
      "vram",
      "instances"
    ]);
    return;
  }
  appendQualityParams(args, topaz.qualityParams, [
    "fps",
    "slowmo",
    "rdt",
    "device",
    "vram",
    "instances"
  ]);
}

function appendOutputArgs(args: string[], topaz: TopazTaskMetadata, target: TopazTargetSpec) {
  const codec = resolveTopazCodec(topaz.codec || "h264_mf");
  args.push("--codec", codec);
  const bitrate = topaz.bitrate || defaultTopazBitrate(codec, target);
  if (bitrate) args.push("--bitrate", bitrate);
  if (topaz.crf !== undefined && codec !== "h264_mf") args.push("--crf", String(topaz.crf));
  if (codec === "h264_mf") args.push("--audio-bitrate", "192k");
}

function defaultTopazBitrate(codec: string, target: TopazTargetSpec) {
  if (codec !== "h264_mf") return "";
  if ((target.width ?? 0) >= 7680 || (target.height ?? 0) >= 7680) return "80M";
  if ((target.width ?? 0) >= 3840 || (target.height ?? 0) >= 3840) return "35M";
  return "20M";
}

function appendQualityParams(args: string[], params: TopazTaskMetadata["qualityParams"], allowedKeys: string[]) {
  const allowed = new Set(allowedKeys);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!allowed.has(key) || value === undefined || value === "") continue;
    if (typeof value === "boolean") {
      args.push(value ? `--${key}` : `--no-${key}`);
    } else {
      args.push(`--${key}`, String(value));
    }
  }
}

async function runTopazJSON(command: string, args: string[], cwd?: string): Promise<unknown> {
  const { stdout, stderr } = await runCommand(command, args, cwd);
  const trimmed = stdout.trim();
  if (!trimmed) return { stderr };
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed) && typeof parsed.error === "string") throw new Error(compactTopazError(parsed.error));
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Topaz JSON 输出解析失败：${trimmed.slice(0, 300)}`);
    }
    throw error;
  }
}

export async function checkTopazCLIAvailable(command: string) {
  try {
    await runCommand(command || "topaz-video", ["--help"], undefined, 1500);
    return { available: true, status: "Topaz CLI 可用" };
  } catch (error) {
    return {
      available: false,
      status: `Topaz CLI 不可用：${errorMessage(error)}`
    };
  }
}

function runCommand(command: string, args: string[], cwd?: string, timeoutMs = 0) {
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Topaz CLI 探测超时 ${timeoutMs}ms`));
      }, timeoutMs)
      : undefined;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`Topaz CLI 退出码 ${code}：${compactTopazError(stderr || stdout)}`));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringField(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

export function topazSourceFileName(path: string) {
  return basename(path);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function compactTopazError(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  const invalidModel = normalized.match(/Invalid value ([^ ]+) for model/i);
  if (invalidModel) return `Topaz model id is invalid: ${invalidModel[1]}`;
  const missingInput = normalized.match(/Input file not found: ([^"}]+)/i);
  if (missingInput) return `Topaz input file not found: ${missingInput[1].trim()}`;
  if (/not found/i.test(normalized) && /topaz|ffmpeg|tool|command/i.test(normalized)) return "Topaz tool not found";
  if (/encoder.*(unknown|not found|unavailable|invalid)/i.test(normalized)) return "Topaz encoder unavailable";
  return normalized.slice(0, 500);
}

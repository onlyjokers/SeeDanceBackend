import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, win32 } from "node:path";
import type { AppConfig } from "./config.js";
import type { RuntimeSettings, TopazTaskMetadata } from "../types.js";

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
  raw: unknown;
}

export class TopazClient {
  constructor(private readonly config: AppConfig) {}

  async process(input: TopazProcessInput): Promise<TopazProcessResult> {
    const started = Date.now();
    const cliPath = input.settings.topazCLIPath || this.config.topazCLIPath || "topaz-video";
    const workDir = input.settings.topazWorkDir || this.config.topazWorkDir || "data/topaz";
    await mkdir(workDir, { recursive: true });
    await mkdir(input.settings.downloadDir || this.config.downloadDir, { recursive: true });

    const sourceInfo = await this.probe(cliPath, input.sourcePath);
    const scale = scaleForTopazTarget(sourceInfo, input.topaz.targetPreset);
    const extension = extname(input.sourcePath) || ".mp4";
    const outputPath = resolve(input.settings.downloadDir || this.config.downloadDir, `${input.taskId}-topaz${extension}`);
    const processModes = topazProcessModesFor(input.topaz);
    const rawSteps: unknown[] = [];
    let currentInputPath = input.sourcePath;
    for (const [index, mode] of processModes.entries()) {
      const stepOutputPath = index === processModes.length - 1
        ? outputPath
        : resolve(workDir, `${input.taskId}-topaz-step-${index + 1}${extension}`);
      const args = [
        "process",
        currentInputPath,
        stepOutputPath,
        "--model",
        mode,
        "--ai-model",
        resolveTopazAIModel(input.topaz.aiModel || input.settings.topazDefaultAIModel || this.config.topazDefaultAIModel || "prob-4"),
        "--scale",
        String(scale),
        "--codec",
        input.topaz.codec || "h264_videotoolbox"
      ];
      if (input.topaz.bitrate) args.push("--bitrate", input.topaz.bitrate);
      if (input.topaz.qv !== undefined) args.push("--qv", String(input.topaz.qv));
      if (input.topaz.crf !== undefined) args.push("--crf", String(input.topaz.crf));
      for (const [key, value] of Object.entries(input.topaz.qualityParams ?? {})) {
        if (value === undefined || value === "") continue;
        args.push(`--${key}`, String(value));
      }
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
      scale,
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

export function scaleForTopazTarget(source: { width?: number; height?: number }, preset: TopazTargetPreset) {
  if (preset.endsWith("x")) return Number(preset.slice(0, -1));
  const targetLongEdge = preset === "2k" ? 2048 : preset === "4k" ? 3840 : 7680;
  const sourceLongEdge = Math.max(source.width ?? 0, source.height ?? 0);
  if (!sourceLongEdge) return 2;
  if (sourceLongEdge >= targetLongEdge) return 1;
  if (sourceLongEdge * 2 >= targetLongEdge) return 2;
  if (sourceLongEdge * 4 >= targetLongEdge) return 4;
  return 8;
}

export function assertControlledTopazSourcePath(path: string, roots: { uploadDir: string; downloadDir: string }) {
  const pathTools = usesWindowsPath(path) || usesWindowsPath(roots.uploadDir) || usesWindowsPath(roots.downloadDir)
    ? {
      resolve: win32.resolve,
      relative: win32.relative,
      isAbsolute: win32.isAbsolute
    }
    : { resolve, relative, isAbsolute };
  const absolute = pathTools.resolve(path);
  const uploadRoot = pathTools.resolve(roots.uploadDir);
  const downloadRoot = pathTools.resolve(roots.downloadDir);
  if (isInside(absolute, uploadRoot) || isInside(absolute, downloadRoot)) return absolute;
  throw new Error("源视频必须来自本地上传目录或已生成下载目录。");
}

function isInside(path: string, root: string) {
  const pathTools = usesWindowsPath(path) || usesWindowsPath(root)
    ? {
      relative: win32.relative,
      isAbsolute: win32.isAbsolute,
      normalize: (value: string) => value.replace(/\\/g, "/").toLowerCase()
    }
    : {
      relative,
      isAbsolute,
      normalize: (value: string) => value
    };
  const normalizedPath = pathTools.normalize(path);
  const normalizedRoot = pathTools.normalize(root);
  const child = pathTools.relative(normalizedRoot, normalizedPath);
  return child === "" || (!child.startsWith("..") && !pathTools.isAbsolute(child));
}

function usesWindowsPath(value: string) {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\");
}

export function resolveTopazAIModel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "proteus") return "prob-4";
  return value;
}

async function runTopazJSON(command: string, args: string[], cwd?: string): Promise<unknown> {
  const { stdout, stderr } = await runCommand(command, args, cwd);
  const trimmed = stdout.trim();
  if (!trimmed) return { stderr };
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed) && typeof parsed.error === "string") throw new Error(parsed.error);
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
      else reject(new Error(`Topaz CLI 退出码 ${code}：${stderr || stdout}`));
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

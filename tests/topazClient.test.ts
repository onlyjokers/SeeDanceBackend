import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../server/lib/config.js";
import type { RuntimeSettings } from "../server/types.js";
import { assertControlledTopazSourcePath, checkTopazCLIAvailable, compactTopazError, resolveTopazAIModel, resolveTopazCodec, targetSpecForTopazTarget, TopazClient } from "../server/lib/topazClient.js";

describe("Topaz client helpers", () => {
  it("maps UI model aliases to valid Topaz model ids", () => {
    expect(resolveTopazAIModel("proteus")).toBe("prob-4");
    expect(resolveTopazAIModel("rhea")).toBe("rhea-1");
    expect(resolveTopazAIModel("rhea-xl")).toBe("rxl-1");
    expect(resolveTopazAIModel("nyx")).toBe("nyx-3");
    expect(resolveTopazAIModel("iris")).toBe("iris-2");
    expect(resolveTopazAIModel("iris-2")).toBe("iris-2");
    expect(resolveTopazAIModel("artemis")).toBe("ahq-12");
    expect(resolveTopazAIModel("gfx")).toBe("gcg-5");
    expect(resolveTopazAIModel("prob-4")).toBe("prob-4");
  });

  it("normalizes Windows-unsafe codec aliases", () => {
    expect(resolveTopazCodec("h264_videotoolbox", "win32")).toBe("h264_mf");
    expect(resolveTopazCodec("hevc_videotoolbox", "win32")).toBe("h264_mf");
    expect(resolveTopazCodec("prores_videotoolbox", "win32")).toBe("h264_mf");
    expect(resolveTopazCodec("libx264", "win32")).toBe("h264_mf");
    expect(resolveTopazCodec("h264_videotoolbox", "darwin")).toBe("h264_videotoolbox");
  });

  it("compacts noisy Topaz CLI errors for UI display", () => {
    expect(compactTopazError("ffmpeg banner ... Invalid value rhea for model ... more logs")).toBe("Topaz model id is invalid: rhea");
    expect(compactTopazError('{"error": "Input file not found: data\\\\downloads\\\\missing.mp4"}')).toBe("Topaz input file not found: data\\\\downloads\\\\missing.mp4");
  });

  it("uses scale for multiplier presets and exact dimensions for 2K/4K/8K presets", () => {
    expect(targetSpecForTopazTarget({ width: 1280, height: 720 }, "2x")).toEqual({ scale: 2 });
    expect(targetSpecForTopazTarget({ width: 1280, height: 720 }, "4x")).toEqual({ scale: 4 });
    expect(targetSpecForTopazTarget({ width: 720, height: 1280 }, "4k")).toEqual({ scale: 0, width: 2160, height: 3840, estimate: 8 });
    expect(targetSpecForTopazTarget({ width: 1920, height: 1080 }, "4k")).toEqual({ scale: 0, width: 3840, height: 2160, estimate: 8 });
    expect(targetSpecForTopazTarget({ width: 1920, height: 1080 }, "8k")).toEqual({ scale: 0, width: 7680, height: 4320, estimate: 8 });
  });

  it("allows only upload or generated download paths as Topaz source files", () => {
    expect(() => assertControlledTopazSourcePath("/tmp/app/data/uploads/source.mp4", {
      uploadDir: "/tmp/app/data/uploads",
      downloadDir: "/tmp/app/data/downloads"
    })).not.toThrow();
    expect(() => assertControlledTopazSourcePath("/tmp/app/data/downloads/generated.mp4", {
      uploadDir: "/tmp/app/data/uploads",
      downloadDir: "/tmp/app/data/downloads"
    })).not.toThrow();
    expect(() => assertControlledTopazSourcePath("/tmp/app/secrets/source.mp4", {
      uploadDir: "/tmp/app/data/uploads",
      downloadDir: "/tmp/app/data/downloads"
    })).toThrow("源视频必须来自本地上传目录或已生成下载目录");
  });

  it("allows controlled Windows upload and download paths", () => {
    expect(() => assertControlledTopazSourcePath("D:\\SeeDance\\SeeDanceTest\\data\\uploads\\source.mp4", {
      uploadDir: "D:\\SeeDance\\SeeDanceTest\\data\\uploads",
      downloadDir: "D:\\SeeDance\\SeeDanceTest\\data\\downloads"
    })).not.toThrow();
    expect(() => assertControlledTopazSourcePath("D:\\SeeDance\\SeeDanceTest\\data\\downloads\\generated.mp4", {
      uploadDir: "D:\\SeeDance\\SeeDanceTest\\data\\uploads",
      downloadDir: "D:\\SeeDance\\SeeDanceTest\\data\\downloads"
    })).not.toThrow();
    expect(() => assertControlledTopazSourcePath("D:\\SeeDance\\SeeDanceTest\\secrets\\source.mp4", {
      uploadDir: "D:\\SeeDance\\SeeDanceTest\\data\\uploads",
      downloadDir: "D:\\SeeDance\\SeeDanceTest\\data\\downloads"
    })).toThrow("源视频必须来自本地上传目录或已生成下载目录");
  });

  it("reports unavailable Topaz CLI paths without throwing", async () => {
    const result = await checkTopazCLIAvailable("/definitely/missing/topaz-video");
    expect(result.available).toBe(false);
    expect(result.status).toContain("Topaz CLI 不可用");
  });

  it("runs selected process modes as a Topaz pipeline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-topaz-client-"));
    const cliPath = join(dir, "fake-topaz-video.mjs");
    const callsPath = join(dir, "calls.jsonl");
    const sourcePath = join(dir, "source.mp4");
    const downloadDir = join(dir, "downloads");
    const workDir = join(dir, "work");
    await writeFile(sourcePath, "source");
    await writeFile(cliPath, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "probe" && args.at(-1) === "--json") {
  console.log(JSON.stringify({ width: 1280, height: 720, duration: "5", bitrate: "2000k", video_codec: "h264" }));
  process.exit(0);
}
if (args[0] === "process" && args.at(-1) === "--json") {
  writeFileSync(args[2], "video");
  console.log(JSON.stringify({ ok: true, output: args[2] }));
  process.exit(0);
}
process.exit(1);
`);
    await chmod(cliPath, 0o755);
    const client = new TopazClient({
      port: 8787,
      host: "127.0.0.1",
      databasePath: join(dir, "db.json"),
      sqlitePath: join(dir, "db.sqlite"),
      downloadDir,
      uploadDir: join(dir, "uploads"),
      volcengineAK: "",
      volcengineSK: "",
      volcengineRegion: "cn-beijing",
      volcengineService: "ark",
      arkAPIKey: "",
      arkVideoModel: "ep",
      arkBaseURL: "https://ark.cn-beijing.volces.com",
      imageHostURL: "https://uguu.se/upload.php",
      assetProjectName: "",
      pollIntervalMs: 1000,
      pollTimeoutMs: 1000,
      maxPollRetryCount: 1,
      maxConcurrentVideoTasks: 1,
      tokenPricePerThousand: 0.049085,
      topazEnabled: true,
      topazCLIPath: cliPath,
      topazWorkDir: workDir,
      topazDefaultAIModel: "proteus",
      corsOrigin: ""
    } satisfies AppConfig);

    const result = await client.process({
      taskId: "task-1",
      sourcePath,
      settings: {
        port: "8787",
        host: "127.0.0.1",
        databasePath: join(dir, "db.json"),
        sqlitePath: join(dir, "db.sqlite"),
        downloadDir,
        uploadDir: join(dir, "uploads"),
        volcengineAK: "",
        volcengineSK: "",
        volcengineRegion: "cn-beijing",
        volcengineService: "ark",
        arkAPIKey: "",
        arkVideoModel: "ep",
        arkBaseURL: "https://ark.cn-beijing.volces.com",
        imageHostURL: "https://uguu.se/upload.php",
        assetProjectName: "",
        pollIntervalSeconds: "1",
        pollTimeoutSeconds: "1",
        maxPollRetryCount: "1",
        maxConcurrentVideoTasks: "1",
        maxConcurrentTopazTasks: "1",
        topazEnabled: "true",
        topazCLIPath: cliPath,
        topazWorkDir: workDir,
        topazDefaultAIModel: "proteus",
        tokenPricePerThousand: "0.049085"
      },
      topaz: {
        processMode: "enhance",
        processModes: ["stabilize", "upscale"],
        aiModel: "proteus",
        targetPreset: "2x",
        codec: "h264_videotoolbox",
        qv: 82
      }
    });

    const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    const probeCall = calls.find((args) => args[0] === "probe");
    expect(probeCall).toEqual([ "probe", sourcePath, "--json" ]);
    const processCalls = calls.filter((args) => args[0] === "process");
    expect(processCalls).toHaveLength(2);
    expect(processCalls.map((args) => args[args.indexOf("--model") + 1])).toEqual(["stabilize", "upscale"]);
    expect(processCalls[0]).not.toContain("--ai-model");
    expect(processCalls[0]).not.toContain("--scale");
    expect(processCalls[1][processCalls[1].indexOf("--ai-model") + 1]).toBe("prob-4");
    expect(processCalls[1][processCalls[1].indexOf("--scale") + 1]).toBe("2");
    expect(processCalls[0][2]).toContain("task-1-topaz-step-1");
    expect(processCalls[1][1]).toContain("task-1-topaz-step-1");
    expect(processCalls.every((args) => args.at(-1) === "--json")).toBe(true);
    expect(result.outputPath).toContain("task-1-topaz.mp4");
  });

  it("passes exact target dimensions for 4K presets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-topaz-exact-"));
    const cliPath = join(dir, "fake-topaz-video.mjs");
    const callsPath = join(dir, "calls.jsonl");
    const sourcePath = join(dir, "source.mp4");
    await writeFile(sourcePath, "source");
    await writeFile(cliPath, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "probe") {
  console.log(JSON.stringify({ width: 720, height: 1280 }));
  process.exit(0);
}
if (args[0] === "process") {
  writeFileSync(args[2], "video");
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}
process.exit(1);
`);
    await chmod(cliPath, 0o755);
    const client = new TopazClient(testConfig(dir, cliPath));

    await client.process({
      taskId: "exact-task",
      sourcePath,
      settings: testSettings(dir, cliPath),
      topaz: {
        processMode: "upscale",
        aiModel: "rhea",
        targetPreset: "4k",
        codec: "h264_mf"
      }
    });

    const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    const processCall = calls.find((args) => args[0] === "process")!;
    expect(processCall[processCall.indexOf("--ai-model") + 1]).toBe("rhea-1");
    expect(processCall[processCall.indexOf("--scale") + 1]).toBe("0");
    expect(processCall[processCall.indexOf("--width") + 1]).toBe("2160");
    expect(processCall[processCall.indexOf("--height") + 1]).toBe("3840");
    expect(processCall[processCall.indexOf("--estimate") + 1]).toBe("8");
  });

  it("passes absolute source and work paths to the Topaz CLI when config paths are relative", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seendance-topaz-relative-"));
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const cliPath = join(dir, "fake-topaz-video.mjs");
      const callsPath = join(dir, "calls.jsonl");
      const relativeSourcePath = join("data", "downloads", "source.mp4");
      await mkdir(join(dir, "data", "downloads"), { recursive: true });
      await writeFile(relativeSourcePath, "source");
      await writeFile(cliPath, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ cwd: process.cwd(), args, inputExists: existsSync(args[1]) }) + "\\n");
if (args[0] === "probe" && args.at(-1) === "--json" && existsSync(args[1])) {
  console.log(JSON.stringify({ width: 1280, height: 720 }));
  process.exit(0);
}
if (args[0] === "process" && args.at(-1) === "--json" && existsSync(args[1])) {
  writeFileSync(args[2], "video");
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}
process.exit(1);
`);
      await chmod(cliPath, 0o755);
      const client = new TopazClient({
        port: 8787,
        host: "127.0.0.1",
        databasePath: "data/db.json",
        sqlitePath: "data/db.sqlite",
        downloadDir: "data/downloads",
        uploadDir: "data/uploads",
        volcengineAK: "",
        volcengineSK: "",
        volcengineRegion: "cn-beijing",
        volcengineService: "ark",
        arkAPIKey: "",
        arkVideoModel: "ep",
        arkBaseURL: "https://ark.cn-beijing.volces.com",
        imageHostURL: "https://uguu.se/upload.php",
        assetProjectName: "",
        pollIntervalMs: 1000,
        pollTimeoutMs: 1000,
        maxPollRetryCount: 1,
        maxConcurrentVideoTasks: 1,
        tokenPricePerThousand: 0.049085,
        topazEnabled: true,
        topazCLIPath: cliPath,
        topazWorkDir: "data/topaz",
        topazDefaultAIModel: "prob-4",
        corsOrigin: ""
      } satisfies AppConfig);

      await client.process({
        taskId: "relative-task",
        sourcePath: relativeSourcePath,
        settings: {
          port: "8787",
          host: "127.0.0.1",
          databasePath: "data/db.json",
          sqlitePath: "data/db.sqlite",
          downloadDir: "data/downloads",
          uploadDir: "data/uploads",
          volcengineAK: "",
          volcengineSK: "",
          volcengineRegion: "cn-beijing",
          volcengineService: "ark",
          arkAPIKey: "",
          arkVideoModel: "ep",
          arkBaseURL: "https://ark.cn-beijing.volces.com",
          imageHostURL: "https://uguu.se/upload.php",
          assetProjectName: "",
          pollIntervalSeconds: "1",
          pollTimeoutSeconds: "1",
          maxPollRetryCount: "1",
          maxConcurrentVideoTasks: "1",
          maxConcurrentTopazTasks: "1",
          topazEnabled: "true",
          topazCLIPath: cliPath,
          topazWorkDir: "data/topaz",
          topazDefaultAIModel: "prob-4",
          tokenPricePerThousand: "0.049085"
        },
        topaz: {
          processMode: "upscale",
          aiModel: "prob-4",
          targetPreset: "2x",
          codec: "h264_videotoolbox",
          qv: 82
        }
      });

      const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { cwd: string; args: string[]; inputExists: boolean });
      const probeCall = calls.find((call) => call.args[0] === "probe");
      const processCall = calls.find((call) => call.args[0] === "process");
      expect(isAbsolute(probeCall?.args[1] ?? "")).toBe(true);
      expect(isAbsolute(processCall?.args[1] ?? "")).toBe(true);
      expect(probeCall?.inputExists).toBe(true);
      expect(processCall?.inputExists).toBe(true);
      expect(isAbsolute(processCall?.args[2] ?? "")).toBe(true);
      expect(isAbsolute(processCall?.cwd ?? "")).toBe(true);
      expect(processCall?.cwd.replace(/\\/g, "/")).toMatch(/\/data\/topaz$/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

function testConfig(dir: string, cliPath: string): AppConfig {
  return {
    port: 8787,
    host: "127.0.0.1",
    databasePath: join(dir, "db.json"),
    sqlitePath: join(dir, "db.sqlite"),
    downloadDir: join(dir, "downloads"),
    uploadDir: join(dir, "uploads"),
    volcengineAK: "",
    volcengineSK: "",
    volcengineRegion: "cn-beijing",
    volcengineService: "ark",
    arkAPIKey: "",
    arkVideoModel: "ep",
    arkBaseURL: "https://ark.cn-beijing.volces.com",
    imageHostURL: "https://uguu.se/upload.php",
    assetProjectName: "",
    pollIntervalMs: 1000,
    pollTimeoutMs: 1000,
    maxPollRetryCount: 1,
    maxConcurrentVideoTasks: 1,
    tokenPricePerThousand: 0.049085,
    topazEnabled: true,
    topazCLIPath: cliPath,
    topazWorkDir: join(dir, "work"),
    topazDefaultAIModel: "prob-4",
    corsOrigin: ""
  };
}

function testSettings(dir: string, cliPath: string): RuntimeSettings {
  return {
    port: "8787",
    host: "127.0.0.1",
    databasePath: join(dir, "db.json"),
    sqlitePath: join(dir, "db.sqlite"),
    downloadDir: join(dir, "downloads"),
    uploadDir: join(dir, "uploads"),
    volcengineAK: "",
    volcengineSK: "",
    volcengineRegion: "cn-beijing",
    volcengineService: "ark",
    arkAPIKey: "",
    arkVideoModel: "ep",
    arkBaseURL: "https://ark.cn-beijing.volces.com",
    imageHostURL: "https://uguu.se/upload.php",
    assetProjectName: "",
    pollIntervalSeconds: "1",
    pollTimeoutSeconds: "1",
    maxPollRetryCount: "1",
    maxConcurrentVideoTasks: "1",
    maxConcurrentTopazTasks: "1",
    topazEnabled: "true",
    topazCLIPath: cliPath,
    topazWorkDir: join(dir, "work"),
    topazDefaultAIModel: "prob-4",
    tokenPricePerThousand: "0.049085"
  };
}

import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../server/lib/config.js";
import { scaleForTopazTarget, assertControlledTopazSourcePath, checkTopazCLIAvailable, TopazClient } from "../server/lib/topazClient.js";

describe("Topaz client helpers", () => {
  it("maps multiplier presets directly to Topaz scale", () => {
    expect(scaleForTopazTarget({ width: 1280, height: 720 }, "2x")).toBe(2);
    expect(scaleForTopazTarget({ width: 1280, height: 720 }, "4x")).toBe(4);
    expect(scaleForTopazTarget({ width: 1280, height: 720 }, "8x")).toBe(8);
  });

  it("maps 2K/4K/8K presets to the smallest supported scale that reaches the target long edge", () => {
    expect(scaleForTopazTarget({ width: 1280, height: 720 }, "2k")).toBe(2);
    expect(scaleForTopazTarget({ width: 1280, height: 720 }, "4k")).toBe(4);
    expect(scaleForTopazTarget({ width: 1920, height: 1080 }, "4k")).toBe(2);
    expect(scaleForTopazTarget({ width: 3840, height: 2160 }, "4k")).toBe(1);
    expect(scaleForTopazTarget({ width: 1920, height: 1080 }, "8k")).toBe(4);
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
    expect(processCalls.map((args) => args[args.indexOf("--ai-model") + 1])).toEqual(["prob-4", "prob-4"]);
    expect(processCalls[0][2]).toContain("task-1-topaz-step-1");
    expect(processCalls[1][1]).toContain("task-1-topaz-step-1");
    expect(processCalls.every((args) => args.at(-1) === "--json")).toBe(true);
    expect(result.outputPath).toContain("task-1-topaz.mp4");
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

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { LocalComputeUnavailableError, StrangeOrchestratorClient, mapOrchestratorStatusToVideoTaskStatus } from "../server/lib/strangeOrchestratorClient.js";

describe("StrangeOrchestratorClient", () => {
  it("creates jobs using the configured local compute manager URL", async () => {
    const received: unknown[] = [];
    const server = createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/jobs") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push(JSON.parse(body) as unknown);
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ jobId: "orch-1", status: "queued" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");
    try {
      const client = new StrangeOrchestratorClient({ baseURL: `http://127.0.0.1:${address.port}` });
      const result = await client.createJob({
        source: "SeeDanceTest",
        externalId: "task-1",
        preset: "topaz.upscale.proteus_4k",
        priority: "normal",
        input: { videoPath: "D:/input/source.mp4" },
        output: { directory: "D:/output" }
      });

      expect(result).toEqual({ jobId: "orch-1", status: "queued" });
      expect(received[0]).toEqual({
        source: "SeeDanceTest",
        externalId: "task-1",
        preset: "topaz.upscale.proteus_4k",
        priority: "normal",
        input: { videoPath: "D:/input/source.mp4" },
        output: { directory: "D:/output" }
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("maps orchestrator states to existing video task states", () => {
    expect(mapOrchestratorStatusToVideoTaskStatus("queued")).toBe("running");
    expect(mapOrchestratorStatusToVideoTaskStatus("admitted")).toBe("running");
    expect(mapOrchestratorStatusToVideoTaskStatus("running")).toBe("running");
    expect(mapOrchestratorStatusToVideoTaskStatus("blocked_resource")).toBe("running");
    expect(mapOrchestratorStatusToVideoTaskStatus("succeeded")).toBe("succeeded");
    expect(mapOrchestratorStatusToVideoTaskStatus("failed")).toBe("failed");
    expect(mapOrchestratorStatusToVideoTaskStatus("cancelled")).toBe("cancelled");
  });

  it("raises a clear local compute manager unavailable error when the service is unreachable", async () => {
    const client = new StrangeOrchestratorClient({ baseURL: "http://127.0.0.1:9" });

    await expect(client.getResources()).rejects.toMatchObject({
      name: "LocalComputeUnavailableError",
      message: "Local compute manager unavailable"
    } satisfies Partial<LocalComputeUnavailableError>);
  });
});

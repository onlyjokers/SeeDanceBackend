import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";

export interface StaticRouteResponse {
  status: number;
  body: string;
  contentType: string;
}

export function createStaticRouter(distDir: string) {
  return async (pathname: string): Promise<StaticRouteResponse> => {
    if (!shouldServeClientShell(pathname)) {
      return { status: 404, body: "", contentType: "text/plain" };
    }
    const indexPath = join(distDir, "index.html");
    if (!existsSync(indexPath)) {
      return { status: 404, body: "", contentType: "text/plain" };
    }
    return {
      status: 200,
      body: await readFile(indexPath, "utf8"),
      contentType: "text/html; charset=utf-8"
    };
  };
}

export function mountStaticClient(app: express.Express, distDir: string) {
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) return false;

  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, asyncHandler(async (_req, res) => {
    res.type("html").send(await readFile(indexPath, "utf8"));
  }));
  return true;
}

export function shouldServeClientShell(pathname: string) {
  return pathname === "/" || pathname === "/executor" || pathname === "/STSManager" || pathname === "/manager";
}

function asyncHandler(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

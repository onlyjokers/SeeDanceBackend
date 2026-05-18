import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { VideoTask } from "../types.js";

export interface FolderOpener {
  open(path: string): Promise<void>;
}

export async function openDownloadFolder(downloadDir: string, opener: FolderOpener = systemFolderOpener) {
  await mkdir(downloadDir, { recursive: true });
  const absolutePath = resolve(downloadDir);
  await opener.open(absolutePath);
  return absolutePath;
}

export function getDownloadPathForTask(task: VideoTask) {
  if (!task.downloadPath) throw new Error("这个视频任务还没有本地下载文件。");
  return resolve(task.downloadPath);
}

export function getPreviewUrlForTask(task: VideoTask) {
  return task.downloadPath ? `/api/video-tasks/${task.id}/download` : task.videoUrl;
}

const systemFolderOpener: FolderOpener = {
  open(path) {
    const { command, args } = openCommand(path);
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, { stdio: "ignore" });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`打开下载目录失败，命令退出码：${code}`));
      });
    });
  }
};

function openCommand(path: string) {
  if (process.platform === "darwin") return { command: "open", args: [path] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", path] };
  return { command: "xdg-open", args: [path] };
}

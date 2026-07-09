import { isAbsolute, relative, resolve, win32 } from "node:path";

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

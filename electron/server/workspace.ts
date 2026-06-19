import path from "node:path";
import type { AgentSettings } from "../../src/shared/types";
import { getWebSettings } from "./settings";

export function getWorkspaceRoot(settings: AgentSettings) {
  const configured = settings.workspacePath || getWebSettings().workspacePath || process.cwd();
  return path.resolve(configured);
}

function normalizePathForCompare(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isUnderRoot(target: string, root: string) {
  const normalizedRoot = normalizePathForCompare(root);
  const normalizedTarget = normalizePathForCompare(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

export function getAllowedFileRoots(settings: AgentSettings) {
  const primary = getWorkspaceRoot(settings);
  const extras = (settings.fileAccessRoots ?? getWebSettings().fileAccessRoots ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  const roots: string[] = [];
  for (const candidate of [primary, ...extras]) {
    if (!roots.some((existing) => isUnderRoot(candidate, existing))) {
      roots.push(candidate);
    }
  }
  return roots;
}

export function isPathInsideWorkspace(inputPath: string, settings: AgentSettings) {
  const target = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(getWorkspaceRoot(settings), inputPath);
  return getAllowedFileRoots(settings).some((root) => isUnderRoot(target, root));
}

export function workspaceBoundaryError(inputPath: string, settings: AgentSettings) {
  const roots = getAllowedFileRoots(settings);
  return [
    "[NO_RETRY] file_read/file_write refused: path is outside allowed file roots.",
    `Path: ${inputPath}`,
    `Allowed roots: ${roots.join("; ")}`,
    "Do not call file_read or file_write again for this path or any path outside allowed roots in this conversation turn.",
    "Use shell_command for read-only inspection, or ask the user to add the parent folder in Settings → workspacePath / fileAccessRoots.",
  ].join(" ");
}

export function resolveWorkspacePath(inputPath: string, settings: AgentSettings) {
  const roots = getAllowedFileRoots(settings);
  const primary = roots[0] ?? getWorkspaceRoot(settings);
  const target = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(primary, inputPath);
  const matchedRoot = roots
    .filter((root) => isUnderRoot(target, root))
    .sort((a, b) => b.length - a.length)[0];

  if (!matchedRoot) {
    throw new Error(workspaceBoundaryError(inputPath, settings));
  }
  return { root: matchedRoot, target };
}

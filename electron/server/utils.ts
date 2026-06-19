import path from "node:path";
import { isMemoryKind, type MemoryKind } from "../memory";

export function getStringArg(args: Record<string, unknown>, key: string, aliases: string[] = []) {
  for (const name of [key, ...aliases]) {
    const value = args[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  throw new Error(`Missing required argument: ${key}`);
}

export function getOptionalNumberArg(args: Record<string, unknown>, key: string, fallback: number) {
  const value = args[key];
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) ? num : fallback;
}

export function getOptionalStringArg(args: Record<string, unknown>, key: string, fallback = "") {
  const value = args[key];
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function parseToolArgs(args: unknown): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === "string") return JSON.parse(args || "{}") as Record<string, unknown>;
  if (typeof args === "object") return args as Record<string, unknown>;
  return {};
}

export function parseMemoryKind(value: unknown): MemoryKind | undefined {
  return isMemoryKind(value) ? value : undefined;
}

export function parseMemoryKinds(value: unknown): MemoryKind[] | undefined {
  if (Array.isArray(value)) {
    const kinds = value.filter(isMemoryKind);
    return kinds.length ? kinds : undefined;
  }
  if (typeof value !== "string") return undefined;
  const kinds = value
    .split(",")
    .map((item) => item.trim())
    .filter(isMemoryKind);
  return kinds.length ? kinds : undefined;
}

export function resolveDataPath(root: string, inputPath: string) {
  const target = path.resolve(root, inputPath);
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path is outside data directory: ${inputPath}`);
  }
  return target;
}

export function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return named[lower] ?? `&${entity};`;
  });
}

export function stripHtml(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

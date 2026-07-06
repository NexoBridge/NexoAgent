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

const TOOL_ARGS_PREVIEW_LIMIT = 240;

export class ToolArgsParseError extends Error {
  rawArgs: string;
  preview: string;

  constructor(message: string, rawArgs: string) {
    super(message);
    this.name = "ToolArgsParseError";
    this.rawArgs = rawArgs;
    this.preview = previewToolArgs(rawArgs);
  }
}

function previewToolArgs(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > TOOL_ARGS_PREVIEW_LIMIT
    ? `${compact.slice(0, TOOL_ARGS_PREVIEW_LIMIT)}...`
    : compact;
}

function normalizeJsonCandidate(value: string) {
  let text = value.trim();
  const fenced = text.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1]?.trim() ?? text;
  return text;
}

function extractFirstObjectLiteral(value: string) {
  const start = value.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }

  return "";
}

function repairCommonJsonArgMistakes(value: string) {
  return value
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, content: string) =>
      JSON.stringify(content.replace(/\\'/g, "'")),
    )
    .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, "$1\"$2\":")
    .replace(/([{,]\s*"[^"]+")\s*(?=(?:"|[{\[]|-?\d|true\b|false\b|null\b))/g, "$1:")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonObjectCandidate(candidate: string) {
  const parsed = JSON.parse(candidate) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error("Tool arguments must be a JSON object.");
}

export function parseToolArgs(args: unknown): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === "object" && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args === "string") {
    const normalized = normalizeJsonCandidate(args);
    if (!normalized) return {};

    const extracted = extractFirstObjectLiteral(normalized);
    const maybeWrapped = !normalized.startsWith("{") && normalized.includes(":")
      ? `{${normalized}}`
      : "";
    const candidates = [
      normalized,
      extracted,
      maybeWrapped,
      repairCommonJsonArgMistakes(normalized),
      extracted ? repairCommonJsonArgMistakes(extracted) : "",
      maybeWrapped ? repairCommonJsonArgMistakes(maybeWrapped) : "",
    ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);

    let lastError = "";
    for (const candidate of candidates) {
      try {
        return parseJsonObjectCandidate(candidate);
      } catch (error) {
        lastError = toErrorMessage(error);
      }
    }

    throw new ToolArgsParseError(`Invalid tool arguments JSON: ${lastError || "Unable to parse arguments."}`, args);
  }
  return {};
}

export function safeParseToolArgs(args: unknown): { args: Record<string, unknown>; error?: ToolArgsParseError } {
  try {
    return { args: parseToolArgs(args) };
  } catch (error) {
    if (error instanceof ToolArgsParseError) return { args: {}, error };
    return { args: {}, error: new ToolArgsParseError(toErrorMessage(error), String(args ?? "")) };
  }
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

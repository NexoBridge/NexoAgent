import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolOutputStats, ToolRawOutputRef } from "../../src/shared/types";
import { UPLOADS_DIR } from "./config";

const DEFAULT_INLINE_CHARS = 12_000;
const SCRIPT_INLINE_CHARS = 8_000;
const DEFAULT_PREVIEW_CHARS = 4_000;
const RAW_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const RAW_SAMPLE_CHARS = 24_000;
const GENERATED_UPLOADS_DIR = path.join(UPLOADS_DIR, "generated");

export interface BoundedToolOutput {
  modelOutput: string;
  displayOutput: string;
  outputSummary?: string;
  outputPreview?: string;
  rawOutput?: ToolRawOutputRef;
  outputStats: ToolOutputStats;
}

interface NormalizeToolOutputOptions {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
}

function byteLength(text: string) {
  return Buffer.byteLength(text, "utf8");
}

function truncateMiddle(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  const half = Math.max(1, Math.floor((maxChars - 80) / 2));
  return [
    text.slice(0, half).trimEnd(),
    "",
    `...[omitted ${Math.max(0, text.length - half * 2)} characters]...`,
    "",
    text.slice(-half).trimStart(),
  ].join("\n");
}

function parseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function objectKeys(value: unknown, max = 12) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).slice(0, max);
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : undefined;
}

function summarizeBrowserAction(parsed: unknown) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const value = parsed as Record<string, unknown>;
  const lines: string[] = [];
  const script = value.script && typeof value.script === "object" && !Array.isArray(value.script)
    ? value.script as Record<string, unknown>
    : null;
  const cache = script?.cache && typeof script.cache === "object" && !Array.isArray(script.cache)
    ? script.cache as Record<string, unknown>
    : null;

  if (typeof value.ok === "boolean") lines.push(`ok: ${value.ok}`);
  if (typeof value.action === "string") lines.push(`action: ${value.action}`);
  if (typeof value.url === "string") lines.push(`url: ${value.url}`);
  if (typeof value.title === "string") lines.push(`title: ${value.title}`);
  if (typeof value.error === "string") lines.push(`error: ${value.error}`);
  if (typeof value.warning === "string") lines.push(`warning: ${value.warning}`);
  const historyCount = countArray(value.history);
  const elementCount = countArray(value.elements);
  if (historyCount !== undefined) lines.push(`history entries: ${historyCount}`);
  if (elementCount !== undefined) lines.push(`snapshot elements: ${elementCount}`);
  if (script) {
    if (typeof script.durationMs === "number") lines.push(`script duration: ${script.durationMs}ms`);
    if (script.timedOut === true) lines.push("script timed out: true");
    const result = script.result && typeof script.result === "object" && !Array.isArray(script.result)
      ? script.result as Record<string, unknown>
      : null;
    if (result) {
      if (typeof result.type === "string") lines.push(`script result type: ${result.type}`);
      if (result.truncated === true) lines.push("script result truncated: true");
    }
    const error = script.error && typeof script.error === "object" && !Array.isArray(script.error)
      ? script.error as Record<string, unknown>
      : null;
    if (error) {
      lines.push(`script error: ${[error.name, error.message].filter(Boolean).join(": ")}`);
    }
  }
  if (cache) {
    const automatic = cache.automatic && typeof cache.automatic === "object" && !Array.isArray(cache.automatic)
      ? cache.automatic as Record<string, unknown>
      : null;
    const writes = Array.isArray(cache.writes) ? cache.writes : [];
    const deletedKeys = Array.isArray(cache.deletedKeys) ? cache.deletedKeys : [];
    if (automatic?.key) lines.push(`scriptCache automatic key: ${String(automatic.key)}`);
    if (writes.length) {
      const keys = writes
        .map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).key ?? "") : "")
        .filter(Boolean)
        .slice(0, 6);
      lines.push(`scriptCache writes: ${writes.length}${keys.length ? ` (${keys.join(", ")})` : ""}`);
    }
    if (deletedKeys.length) lines.push(`scriptCache deleted keys: ${deletedKeys.slice(0, 6).join(", ")}`);
    if (typeof cache.cleared === "number") lines.push(`scriptCache cleared: ${cache.cleared}`);
  }

  return lines;
}

function summarizeParsedOutput(toolName: string, args: Record<string, unknown>, parsed: unknown) {
  if (toolName === "browser_action") {
    const browserLines = summarizeBrowserAction(parsed);
    if (browserLines.length) return browserLines;
  }

  const lines: string[] = [];
  if (Array.isArray(parsed)) {
    lines.push(`array items: ${parsed.length}`);
    const sample = parsed.slice(0, 3).map((item, index) => {
      if (item && typeof item === "object") {
        return `item ${index + 1} keys: ${objectKeys(item).join(", ") || "(none)"}`;
      }
      return `item ${index + 1}: ${String(item).slice(0, 120)}`;
    });
    lines.push(...sample);
  } else if (parsed && typeof parsed === "object") {
    lines.push(`object keys: ${objectKeys(parsed).join(", ") || "(none)"}`);
  } else if (parsed !== null) {
    lines.push(`value type: ${typeof parsed}`);
  }

  const action = args.action;
  if (typeof action === "string") lines.unshift(`action: ${action}`);
  return lines;
}

async function saveRawOutput(
  toolName: string,
  output: string,
  originalBytes: number,
  parsed: unknown | null,
) {
  const storeComplete = originalBytes <= RAW_STORAGE_LIMIT_BYTES;
  const storedText = storeComplete ? output : truncateMiddle(output, RAW_SAMPLE_CHARS);
  const mimeType = storeComplete && parsed !== null ? "application/json" : "text/plain";
  const extension = mimeType === "application/json" ? "json" : "txt";
  const safeToolName = toolName.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "tool";
  const filename = `tool-output-${safeToolName}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const buffer = Buffer.from(storedText, "utf8");
  await fs.mkdir(GENERATED_UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(GENERATED_UPLOADS_DIR, filename), buffer);
  return {
    url: `/uploads/generated/${filename}`,
    name: filename,
    mimeType,
    size: buffer.byteLength,
    originalBytes,
    storedBytes: buffer.byteLength,
    truncated: !storeComplete,
  } satisfies ToolRawOutputRef;
}

function buildOversizedModelOutput(params: {
  toolName: string;
  summary: string;
  preview: string;
  rawOutput?: ToolRawOutputRef;
  stats: ToolOutputStats;
}) {
  const { toolName, summary, preview, rawOutput, stats } = params;
  return [
    `[bounded tool output] ${toolName} returned ${stats.originalChars} characters (${stats.originalBytes} bytes), which exceeded the inline budget.`,
    rawOutput
      ? `Raw output reference: ${rawOutput.url} (${rawOutput.truncated ? "sample" : "complete"}, ${rawOutput.storedBytes} stored bytes).`
      : "Raw output could not be stored; only this bounded preview is available.",
    "Summary:",
    summary || "(no structured summary available)",
    "Preview:",
    preview,
    "Do not assume the full raw output is in the model context. Retrieve the raw reference only if the full payload is necessary.",
  ].join("\n");
}

export async function normalizeToolOutputForModel(options: NormalizeToolOutputOptions): Promise<BoundedToolOutput> {
  const output = options.output;
  const inlineLimit = options.toolName === "browser_action" && options.args.action === "script"
    ? SCRIPT_INLINE_CHARS
    : DEFAULT_INLINE_CHARS;
  const originalBytes = byteLength(output);
  const baseStats: ToolOutputStats = {
    originalChars: output.length,
    originalBytes,
    inlineChars: Math.min(output.length, inlineLimit),
    previewChars: Math.min(output.length, DEFAULT_PREVIEW_CHARS),
    truncated: false,
    reason: "inline",
  };

  if (output.length <= inlineLimit && originalBytes <= RAW_STORAGE_LIMIT_BYTES) {
    return {
      modelOutput: output,
      displayOutput: output,
      outputPreview: output.length > DEFAULT_PREVIEW_CHARS ? truncateMiddle(output, DEFAULT_PREVIEW_CHARS) : output,
      outputStats: baseStats,
    };
  }

  const parsed = parseJson(output);
  const summaryLines = summarizeParsedOutput(options.toolName, options.args, parsed);
  const preview = truncateMiddle(output, DEFAULT_PREVIEW_CHARS);
  const stats: ToolOutputStats = {
    ...baseStats,
    previewChars: preview.length,
    truncated: true,
    reason: originalBytes > RAW_STORAGE_LIMIT_BYTES ? "raw-storage-limit" : "oversized",
  };

  let rawOutput: ToolRawOutputRef | undefined;
  let storageError = "";
  try {
    rawOutput = await saveRawOutput(options.toolName, output, originalBytes, parsed);
    stats.storedBytes = rawOutput.storedBytes;
  } catch (error) {
    storageError = error instanceof Error ? error.message : String(error);
  }

  const summary = [
    ...summaryLines,
    storageError ? `raw storage error: ${storageError}` : "",
  ].filter(Boolean).join("\n");
  const modelOutput = buildOversizedModelOutput({
    toolName: options.toolName,
    summary,
    preview,
    rawOutput,
    stats,
  });

  return {
    modelOutput,
    displayOutput: modelOutput,
    outputSummary: summary,
    outputPreview: preview,
    rawOutput,
    outputStats: stats,
  };
}

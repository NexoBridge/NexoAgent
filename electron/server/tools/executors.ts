import { isMemoryKind, recallMemory, storeScriptMemory, type MemoryKind } from "../../memory";
import { browserManager } from "../browser-manager";
import { resolveMemoryEmbeddingSettings } from "../memory-embedding";
import { createScheduledTask } from "../task-store";
import type { ToolExecutionContext } from "../types";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import { invokeModel } from "./model-call";
import { runShellCommand } from "./shell-command";

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;

function readObjectArg<T extends Record<string, unknown>>(args: Record<string, unknown>, key: string): T | undefined {
  const value = args[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as T
    : undefined;
}

function readBrowserTargetString(value: string): Record<string, unknown> | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/^e\d+$/i.test(text)) return { ref: text };
  if (/^(\/|\.\/|\()?\//.test(text)) return { xpath: text };
  if (/^(#|\.|\[)|[>~+]|:nth-|:has\(|:contains\(|\[[^\]]+\]/.test(text)) return { selector: text };
  return { query: text };
}

function readBrowserTargetArg(args: Record<string, unknown>): Record<string, unknown> | undefined {
  const rawTarget = args.target;
  const target = typeof rawTarget === "string"
    ? readBrowserTargetString(rawTarget)
    : readObjectArg<Record<string, unknown>>(args, "target");
  const legacy: Record<string, unknown> = {};
  for (const key of ["ref", "query", "role", "text", "selector", "xpath", "placeholder", "ariaLabel", "nearText", "x", "y", "bounds", "relativePosition"]) {
    if (hasOwnValue(args, key)) legacy[key] = args[key];
  }
  return Object.keys(target ?? {}).length || Object.keys(legacy).length
    ? { ...(target ?? {}), ...legacy }
    : undefined;
}

function readArrayArg<T>(args: Record<string, unknown>, key: string): T[] | undefined {
  const value = args[key];
  return Array.isArray(value) ? value as T[] : undefined;
}

function readMemoryKinds(value: unknown): MemoryKind[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const kinds = raw.map((item) => String(item).trim()).filter(isMemoryKind);
  return kinds.length ? kinds : undefined;
}

async function resolveToolEmbeddingSettings(ctx: ToolExecutionContext) {
  return resolveMemoryEmbeddingSettings({
    providerId: ctx.settings.providerId,
    providerName: ctx.settings.providerName,
    apiKey: ctx.apiKey,
    apiBase: ctx.apiBase,
    model: ctx.settings.model,
    temperature: ctx.settings.temperature,
  });
}

function readMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return { note: value.trim() };
  }
}

function formatBrowserResult(result: Awaited<ReturnType<typeof browserManager.executeAction>>) {
  return JSON.stringify(result, null, 2);
}

function hasOwnValue(args: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined;
}

function getOptionalBooleanArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return undefined;
}

function rejectRemovedBrowserActionArgs(args: Record<string, unknown>) {
  const removedRunFields = ["steps", "goal", "onFailure", "waitMs", "durationMs"].filter((key) => hasOwnValue(args, key));
  if (removedRunFields.length) {
    throw new Error(
      `browser_action no longer accepts ${removedRunFields.join(", ")}. Call one browser_action per browser operation instead.`,
    );
  }
}

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  invoke_model: async (args, ctx) => invokeModel(args, ctx),
  shell_command: async (args, ctx) => runShellCommand(args, ctx),
  create_scheduled_task: async (args) => {
    const task = await createScheduledTask(args);
    return [
      `Created scheduled task "${task.name}".`,
      `id: ${task.id}`,
      `cron: ${task.cron}`,
      `enabled: ${task.enabled ? "true" : "false"}`,
      `runOnce: ${task.runOnce ? "true" : "false"}`,
      task.runAt ? `runAt: ${task.runAt}` : "",
      `prompt: ${task.prompt}`,
    ].filter(Boolean).join("\n");
  },
  browser_action: async (args) => {
    rejectRemovedBrowserActionArgs(args);
    const limit = args.limit === undefined ? undefined : getOptionalNumberArg(args, "limit", 5);
    const minConfidence = args.minConfidence === undefined ? undefined : getOptionalNumberArg(args, "minConfidence", 0.82);
    const result = await browserManager.executeAction({
      action: getStringArg(args, "action") as Parameters<typeof browserManager.executeAction>[0]["action"],
      url: getOptionalStringArg(args, "url"),
      text: getOptionalStringArg(args, "text"),
      script: getOptionalStringArg(args, "script"),
      args: readArrayArg(args, "args"),
      scriptCacheKey: getOptionalStringArg(args, "scriptCacheKey") || getOptionalStringArg(args, "cacheKey"),
      scriptCacheTtlMs: args.scriptCacheTtlMs === undefined && args.cacheTtlMs === undefined
        ? undefined
        : getOptionalNumberArg(args, args.scriptCacheTtlMs === undefined ? "cacheTtlMs" : "scriptCacheTtlMs", 30 * 60 * 1000),
      includeState: getOptionalBooleanArg(args, "includeState"),
      includeElements: getOptionalBooleanArg(args, "includeElements"),
      includeText: getOptionalBooleanArg(args, "includeText"),
      includeHistory: getOptionalBooleanArg(args, "includeHistory"),
      target: readBrowserTargetArg(args),
      strategy: getOptionalStringArg(args, "strategy") as Parameters<typeof browserManager.executeAction>[0]["strategy"],
      key: getOptionalStringArg(args, "key"),
      submit: Boolean(args.submit),
      direction: getOptionalStringArg(args, "direction", "down") as "up" | "down" | "left" | "right",
      amount: getOptionalNumberArg(args, "amount", 720),
      deltaX: args.deltaX === undefined ? undefined : getOptionalNumberArg(args, "deltaX", 0),
      deltaY: args.deltaY === undefined ? undefined : getOptionalNumberArg(args, "deltaY", 0),
      timeoutMs: args.timeoutMs === undefined ? undefined : getOptionalNumberArg(args, "timeoutMs", 15_000),
      limit,
      minConfidence,
    });
    return formatBrowserResult(result);
  },
  recall_memory: async (args, ctx) => {
    const query = getStringArg(args, "query", ["q"]);
    const kinds = readMemoryKinds(args.kinds ?? args.kind);
    const dayKey = getOptionalStringArg(args, "dayKey") || getOptionalStringArg(args, "day_key");
    const k = getOptionalNumberArg(args, "k", 6);
    const embeddingSettings = await resolveToolEmbeddingSettings(ctx);
    const result = await recallMemory(query, embeddingSettings, undefined, k, kinds, dayKey || undefined);
    return result || "No relevant memory found.";
  },
  store_script_memory: async (args, ctx) => {
    const key = getStringArg(args, "key");
    const content = getStringArg(args, "content");
    const scope = getOptionalStringArg(args, "scope");
    const dayKey = getOptionalStringArg(args, "dayKey") || getOptionalStringArg(args, "day_key");
    const metadata = readMetadata(args.metadata);
    const embeddingSettings = await resolveToolEmbeddingSettings(ctx);
    const id = await storeScriptMemory(key, content, {
      scope: scope || undefined,
      metadata,
      dayKey: dayKey || undefined,
      embeddingSettings,
    });

    return id
      ? `Stored script memory '${key}' with id ${id}.`
      : `No script memory stored for '${key}' because the content was empty.`;
  },
};

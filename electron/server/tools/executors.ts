import { isMemoryKind, recallMemory, storeScriptMemory, type MemoryKind } from "../../memory";
import { browserManager } from "../browser-manager";
import { resolveMemoryEmbeddingSettings } from "../memory-embedding";
import type { ToolExecutionContext } from "../types";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import { invokeModel } from "./model-call";
import { runShellCommand } from "./shell-command";

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;

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

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  invoke_model: async (args, ctx) => invokeModel(args, ctx),
  shell_command: async (args, ctx) => runShellCommand(args, ctx),
  browser_action: async (args) => {
    const limit = args.limit === undefined ? undefined : getOptionalNumberArg(args, "limit", 5);
    const minConfidence = args.minConfidence === undefined ? undefined : getOptionalNumberArg(args, "minConfidence", 0.82);
    const result = await browserManager.executeAction({
      action: getStringArg(args, "action") as Parameters<typeof browserManager.executeAction>[0]["action"],
      url: getOptionalStringArg(args, "url"),
      ref: getOptionalStringArg(args, "ref"),
      query: getOptionalStringArg(args, "query"),
      role: getOptionalStringArg(args, "role"),
      text: getOptionalStringArg(args, "text"),
      submit: Boolean(args.submit),
      direction: getOptionalStringArg(args, "direction", "down") as "up" | "down" | "left" | "right",
      amount: getOptionalNumberArg(args, "amount", 720),
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

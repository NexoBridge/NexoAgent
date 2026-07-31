import type { AgentSettings } from "./types";

/** 表单中表示「已保存密钥」的占位符，不会作为真实密钥提交。 */
export const SAVED_API_KEY_MASK = "***";
export const AI_REQUEST_TIMEOUT_DISABLED_MS = 0;
export const AI_REQUEST_TIMEOUT_MAX_MS = 2_147_483_647;
export const DEFAULT_PLANNER_EXECUTOR_QUALITY_THRESHOLD = 0.72;

export const DEFAULT_PLANNER_EXECUTOR_ROUTING_SETTINGS: Pick<
  AgentSettings,
  | "plannerExecutorRoutingEnabled"
  | "executorProfileId"
> = {
  plannerExecutorRoutingEnabled: false,
  executorProfileId: "",
};

export function normalizeAiRequestTimeoutMs(value: unknown) {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(num) || num <= 0) return AI_REQUEST_TIMEOUT_DISABLED_MS;
  return Math.max(1, Math.min(AI_REQUEST_TIMEOUT_MAX_MS, Math.floor(num)));
}

function normalizeProfileId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePlannerExecutorRoutingSettings<T extends Partial<AgentSettings>>(settings: T): T {
  return {
    ...settings,
    plannerExecutorRoutingEnabled: settings.plannerExecutorRoutingEnabled === true,
    executorProfileId: normalizeProfileId(settings.executorProfileId),
  };
}

export function maskApiKeyForDisplay(settings: AgentSettings): AgentSettings {
  if (!settings.hasApiKey) return settings;
  return { ...settings, apiKey: SAVED_API_KEY_MASK };
}

export function sanitizeApiKeyForSave(settings: AgentSettings): AgentSettings {
  const apiKey = settings.apiKey?.trim() ?? "";
  if (!apiKey || apiKey === SAVED_API_KEY_MASK) {
    return { ...settings, apiKey: "" };
  }
  return { ...settings, apiKey };
}

export function isPreservedApiKeyInput(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return !trimmed || trimmed === SAVED_API_KEY_MASK;
}

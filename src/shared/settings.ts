import type { AgentSettings, WebSafeModeSettings } from "./types";

/** 表单中表示「已保存密钥」的占位符，不会作为真实密钥提交。 */
export const SAVED_API_KEY_MASK = "***";
export const AI_REQUEST_TIMEOUT_DISABLED_MS = 0;
export const AI_REQUEST_TIMEOUT_MAX_MS = 2_147_483_647;
export const DEFAULT_PLANNER_EXECUTOR_QUALITY_THRESHOLD = 0.72;
export const DEFAULT_WEB_SAFE_MODE_RETRY_LIMIT = 5;

export const DEFAULT_WEB_SAFE_MODE_SETTINGS: WebSafeModeSettings = {
  enabled: false,
  accountName: "",
  passwordVerifier: "",
  passwordSalt: "",
  retryLimit: DEFAULT_WEB_SAFE_MODE_RETRY_LIMIT,
  failedAttempts: 0,
};

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

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(num)));
}

function normalizeNonNegativeInteger(value: unknown) {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
}

export function normalizeWebSafeModeSettings(value: unknown): WebSafeModeSettings {
  const input = value && typeof value === "object"
    ? value as Partial<WebSafeModeSettings>
    : {};
  const passwordVerifier = typeof input.passwordVerifier === "string" ? input.passwordVerifier.trim() : "";
  const passwordSalt = typeof input.passwordSalt === "string" ? input.passwordSalt.trim() : "";
  const hasPassword = Boolean(passwordVerifier && passwordSalt) || input.hasPassword === true;
  const lockedAt = typeof input.lockedAt === "string" && input.lockedAt.trim()
    ? input.lockedAt.trim()
    : undefined;

  return {
    enabled: input.enabled === true,
    accountName: typeof input.accountName === "string" ? input.accountName.trim() : "",
    passwordVerifier,
    passwordSalt,
    retryLimit: normalizePositiveInteger(input.retryLimit, DEFAULT_WEB_SAFE_MODE_RETRY_LIMIT, 100),
    failedAttempts: normalizeNonNegativeInteger(input.failedAttempts),
    ...(lockedAt ? { lockedAt } : {}),
    hasPassword,
  };
}

export function normalizeAgentWebSafeModeSettings<T extends Partial<AgentSettings>>(settings: T): T {
  return {
    ...settings,
    webSafeMode: normalizeWebSafeModeSettings(settings.webSafeMode),
  };
}

export function hasConfiguredWebSafeModeCredentials(webSafeMode: WebSafeModeSettings) {
  const normalized = normalizeWebSafeModeSettings(webSafeMode);
  return Boolean(normalized.accountName && normalized.passwordVerifier && normalized.passwordSalt);
}

export function sanitizeWebSafeModeForDesktop(webSafeMode: WebSafeModeSettings): WebSafeModeSettings {
  const normalized = normalizeWebSafeModeSettings(webSafeMode);
  return {
    ...normalized,
    passwordVerifier: "",
    passwordSalt: "",
    hasPassword: hasConfiguredWebSafeModeCredentials(normalized),
  };
}

export function sanitizeWebSafeModeForBrowser(webSafeMode: WebSafeModeSettings): WebSafeModeSettings {
  const desktopSafe = sanitizeWebSafeModeForDesktop(webSafeMode);
  return {
    ...desktopSafe,
    accountName: "",
    failedAttempts: 0,
    lockedAt: undefined,
  };
}

export function sanitizeSettingsForClient(settings: AgentSettings, surface: "desktop" | "web"): AgentSettings {
  return {
    ...settings,
    webSafeMode: surface === "desktop"
      ? sanitizeWebSafeModeForDesktop(settings.webSafeMode)
      : sanitizeWebSafeModeForBrowser(settings.webSafeMode),
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

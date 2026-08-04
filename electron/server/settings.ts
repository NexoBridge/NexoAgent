import type { AgentSettings, AgentSettingsSaveInput, WebSafeModeSettings } from "../../src/shared/types";
import {
  DEFAULT_WEB_SAFE_MODE_SETTINGS,
  DEFAULT_PLANNER_EXECUTOR_ROUTING_SETTINGS,
  isPreservedApiKeyInput,
  normalizeAgentWebSafeModeSettings,
  normalizeAiRequestTimeoutMs,
  normalizePlannerExecutorRoutingSettings,
} from "../../src/shared/settings";
import {
  normalizeProviderApiBase,
  getDefaultServiceProviderName,
  getProviderDefaultApiBase,
  normalizeProviderId,
  normalizeServiceProviderName,
} from "../../src/shared/providers";
import { applyWebSafeModeSettingsUpdate } from "./web-safe-mode-auth";

let webSettings: Partial<AgentSettings> = {};

function normalizeSettingsShape<T extends Partial<AgentSettings>>(settings: T): T {
  const providerId = normalizeProviderId(settings.providerId);
  const apiBase = normalizeProviderApiBase(
    settings.apiBase?.trim() || getProviderDefaultApiBase(providerId),
    providerId,
    settings.providerName,
  );
  return normalizeAgentWebSafeModeSettings(normalizePlannerExecutorRoutingSettings({
    ...settings,
    providerId,
    providerName: normalizeServiceProviderName(settings.providerName, apiBase, providerId) || getDefaultServiceProviderName(providerId),
    apiBase,
    aiRequestTimeoutMs: normalizeAiRequestTimeoutMs(settings.aiRequestTimeoutMs),
  }));
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  providerId: "openai-compatible",
  providerName: getDefaultServiceProviderName("openai-compatible"),
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  hasApiKey: false,
  model: "gpt-4o-mini",
  temperature: 0.4,
  contextWindowTokens: 128_000,
  reservedOutputTokens: 8_192,
  autoCompactTokenLimit: 96_000,
  compactionTargetRatio: 0.6,
  contextWindowSource: "default",
  contextWindowSourceDetail: "runtime-default",
  maxContextTurns: 12,
  enableContextCompaction: true,
  shellCommandTimeoutMs: 0,
  aiRequestTimeoutMs: 0,
  planningMode: "balanced",
  ...DEFAULT_PLANNER_EXECUTOR_ROUTING_SETTINGS,
  thinkingEnabled: true,
  thinkingEffort: "high",
  circuitBreakerEnabled: true,
  circuitBreakerConsecutiveFailureLimit: 3,
  circuitBreakerRepeatedToolCallLimit: 10,
  circuitBreakerTokenBudget: 0,
  enableMemory: true,
  enableKnowledge: true,
  workspacePath: "",
  fileAccessRoots: [],
  webHost: "0.0.0.0",
  webPort: 9898,
  webPassword: "",
  webSafeMode: DEFAULT_WEB_SAFE_MODE_SETTINGS,
  channels: { web: true, desktop: true, feishu: false, dingtalk: false, wechat: false, wecom: false },
};

export function getWebSettings() {
  return webSettings;
}

export function mergeWebSettings(overrides: Partial<AgentSettingsSaveInput>) {
  const { apiKey, hasApiKey, webSafeMode, webSafeModePassword, ...rest } = overrides;
  const current = buildRuntimeSettings();
  const nextWebSafeMode = applyWebSafeModeSettingsUpdate(
    current.webSafeMode,
    webSafeMode,
    webSafeModePassword,
  );
  webSettings = normalizeSettingsShape({
    ...DEFAULT_AGENT_SETTINGS,
    ...webSettings,
    ...rest,
    webSafeMode: nextWebSafeMode,
  });
  if (hasApiKey !== undefined) {
    webSettings.hasApiKey = hasApiKey;
  }
  if (!isPreservedApiKeyInput(apiKey)) {
    webSettings.apiKey = apiKey!.trim();
    webSettings.hasApiKey = Boolean(webSettings.apiKey);
  }
}

export function setWebSafeModeState(webSafeMode: WebSafeModeSettings) {
  webSettings = normalizeSettingsShape({
    ...DEFAULT_AGENT_SETTINGS,
    ...webSettings,
    webSafeMode,
  });
}

/** Apply settings to the in-process backend cache (disk + HTTP routes share this). */
export function applyAgentSettings(overrides: Partial<AgentSettings>) {
  const { apiKey, hasApiKey, ...rest } = overrides;
  webSettings = normalizeSettingsShape({ ...DEFAULT_AGENT_SETTINGS, ...webSettings, ...rest });
  if (hasApiKey !== undefined) {
    webSettings.hasApiKey = hasApiKey;
  }
  if (!isPreservedApiKeyInput(apiKey)) {
    webSettings.apiKey = apiKey!.trim();
    webSettings.hasApiKey = Boolean(webSettings.apiKey);
  }
}

export function buildRuntimeSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return normalizeSettingsShape({ ...DEFAULT_AGENT_SETTINGS, ...webSettings, ...overrides }) as AgentSettings;
}

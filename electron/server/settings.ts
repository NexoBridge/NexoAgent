import type { AgentSettings } from "../../src/shared/types";
import { isPreservedApiKeyInput } from "../../src/shared/settings";
import { getProviderName } from "../../src/shared/providers";

let webSettings: Partial<AgentSettings> = {};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  providerId: "openai-compatible",
  providerName: getProviderName("openai-compatible"),
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  hasApiKey: false,
  model: "gpt-4o-mini",
  temperature: 0.4,
  maxContextTurns: 12,
  enableContextCompaction: true,
  contextCompactionThreshold: 24,
  maxSteps: 20,
  shellCommandTimeoutMs: 300_000,
  planningMode: "balanced",
  enableMemory: true,
  enableKnowledge: true,
  workspacePath: "",
  fileAccessRoots: [],
  webHost: "0.0.0.0",
  webPort: 9898,
  webPassword: "",
  channels: { web: true, desktop: true, feishu: false, dingtalk: false, wechat: false, wecom: false },
};

export function getWebSettings() {
  return webSettings;
}

export function mergeWebSettings(overrides: Partial<AgentSettings>) {
  const { apiKey, hasApiKey, ...rest } = overrides;
  webSettings = { ...DEFAULT_AGENT_SETTINGS, ...webSettings, ...rest };
  if (hasApiKey !== undefined) {
    webSettings.hasApiKey = hasApiKey;
  }
  if (!isPreservedApiKeyInput(apiKey)) {
    webSettings.apiKey = apiKey!.trim();
    webSettings.hasApiKey = Boolean(webSettings.apiKey);
  }
}

/** Apply settings to the in-process backend cache (disk + HTTP routes share this). */
export function applyAgentSettings(overrides: Partial<AgentSettings>) {
  mergeWebSettings(overrides);
}

export function buildRuntimeSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return { ...DEFAULT_AGENT_SETTINGS, ...webSettings, ...overrides } as AgentSettings;
}

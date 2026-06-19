import type { AgentSettings } from "./types";

/** 表单中表示「已保存密钥」的占位符，不会作为真实密钥提交。 */
export const SAVED_API_KEY_MASK = "***";

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

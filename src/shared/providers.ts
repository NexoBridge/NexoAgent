import type { ProviderId } from "./types";

export const PROVIDER_DEFAULTS: Record<ProviderId, { name: string; apiBase: string }> = {
  "openai-compatible": {
    name: "OpenAI 兼容协议",
    apiBase: "https://api.openai.com/v1",
  },
  "anthropic-compatible": {
    name: "Anthropic 兼容协议",
    apiBase: "https://api.anthropic.com/v1",
  },
};

export const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = Object.entries(PROVIDER_DEFAULTS).map(
  ([value, config]) => ({
    value: value as ProviderId,
    label: config.name,
  })
);

export function getProviderDefaultApiBase(providerId: ProviderId = "openai-compatible") {
  return PROVIDER_DEFAULTS[providerId]?.apiBase ?? PROVIDER_DEFAULTS["openai-compatible"].apiBase;
}

export function getProviderName(providerId: ProviderId = "openai-compatible") {
  return PROVIDER_DEFAULTS[providerId]?.name ?? PROVIDER_DEFAULTS["openai-compatible"].name;
}

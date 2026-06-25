import {
  getDefaultServiceProviderName,
  normalizeServiceProviderName,
} from "../../src/shared/providers";
import type { AgentSettings } from "../../src/shared/types";
import { findStoredModelProfileByCapability } from "./model-profiles";

export type MemoryEmbeddingSettings = Partial<Pick<
  AgentSettings,
  "providerId" | "providerName" | "apiBase" | "apiKey" | "model" | "temperature"
>>;

export async function resolveMemoryEmbeddingSettings(
  fallback: MemoryEmbeddingSettings = {},
): Promise<MemoryEmbeddingSettings> {
  const profile = await findStoredModelProfileByCapability("embedding");
  if (profile) {
    return {
      providerId: profile.providerId,
      providerName: profile.providerName
        || normalizeServiceProviderName("", profile.apiBase, profile.providerId)
        || getDefaultServiceProviderName(profile.providerId),
      apiBase: profile.apiBase,
      apiKey: profile.apiKey || "",
      model: profile.model,
      temperature: profile.temperature ?? fallback.temperature ?? 0,
    };
  }

  const providerName = normalizeServiceProviderName(
    fallback.providerName,
    fallback.apiBase || "",
    fallback.providerId,
  ) || (fallback.providerId ? getDefaultServiceProviderName(fallback.providerId) : undefined);

  return {
    ...fallback,
    providerName,
  };
}

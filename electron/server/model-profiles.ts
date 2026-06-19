import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getProviderDefaultApiBase, getProviderName } from "../../src/shared/providers";
import { MODEL_CAPABILITIES, type DiscoveredModel, type ModelCapability, type ModelProfile, type ProviderId } from "../../src/shared/types";
import { DATA_DIR, MODEL_PROFILES_FILE } from "./config";

interface StoredModelProfile extends Omit<ModelProfile, "hasApiKey"> {
  hasApiKey?: boolean;
}

const CAPABILITY_KEYWORDS: Array<[ModelCapability, RegExp]> = [
  ["image_generation", /\b(dall|dalle|gpt-image|flux|sdxl|stable-diffusion|midjourney|mj|image-gen|image-generation)\b/i],
  ["image_editing", /\b(edit|edits|inpaint|outpaint|paint|image-edit|gpt-image)\b/i],
  ["vision", /\b(vision|vl|omni|gpt-4o|gpt-4\.1|qwen-vl|glm-4v|gemini|claude-3|internvl|llava)\b/i],
  ["speech_to_text", /\b(whisper|asr|transcribe|speech-to-text|stt)\b/i],
  ["text_to_speech", /\b(tts|speech|voice|audio)\b/i],
  ["embedding", /\b(embed|embedding|text-embedding|bge|gte)\b/i],
];

function normalizeProviderId(value: unknown): ProviderId {
  return value === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
}

function uniqueCapabilities(items: ModelCapability[]) {
  return MODEL_CAPABILITIES.filter((capability) => items.includes(capability));
}

export function inferModelCapabilities(modelId: string, metadata: Record<string, unknown> = {}): ModelCapability[] {
  const capabilities = new Set<ModelCapability>();
  const haystack = [
    modelId,
    metadata.owned_by,
    metadata.owner,
    metadata.type,
    metadata.modality,
    metadata.modalities,
    metadata.capabilities,
    metadata.object,
  ].map((item) => Array.isArray(item) ? item.join(" ") : typeof item === "string" ? item : "").join(" ");

  for (const [capability, pattern] of CAPABILITY_KEYWORDS) {
    if (pattern.test(haystack)) capabilities.add(capability);
  }
  if (!capabilities.has("embedding") && !capabilities.has("speech_to_text") && !capabilities.has("text_to_speech")) {
    capabilities.add("chat");
  }
  if (capabilities.has("chat") || capabilities.has("vision")) capabilities.add("orchestration");
  return uniqueCapabilities([...capabilities]);
}

function normalizeCapabilities(value: unknown, fallback: ModelCapability[] = ["chat", "orchestration"]) {
  const allowed = new Set<ModelCapability>(MODEL_CAPABILITIES);
  const items = Array.isArray(value) ? value : [];
  const capabilities = items.filter((item): item is ModelCapability => allowed.has(item as ModelCapability));
  const normalized = capabilities.length ? capabilities : fallback;
  return uniqueCapabilities(normalized);
}

function normalizeProfile(profile: Partial<ModelProfile> & Pick<ModelProfile, "name" | "apiBase" | "model">, existing?: StoredModelProfile): StoredModelProfile {
  const providerId = normalizeProviderId(profile.providerId ?? existing?.providerId);
  const apiBase = (profile.apiBase?.trim() || existing?.apiBase?.trim() || getProviderDefaultApiBase(providerId)).replace(/\/+$/, "");
  const nextApiKey = profile.apiKey?.trim() ? profile.apiKey.trim() : existing?.apiKey?.trim() ?? "";
  const inferredCapabilities = normalizeCapabilities(
    profile.capabilities,
    existing?.capabilities?.length ? existing.capabilities : inferModelCapabilities(profile.model)
  );
  const wantsPrimary = profile.isPrimary ?? existing?.isPrimary ?? false;
  const capabilities = wantsPrimary && !inferredCapabilities.includes("orchestration")
    ? uniqueCapabilities([...inferredCapabilities, "orchestration"])
    : inferredCapabilities;
  return {
    id: profile.id || existing?.id || randomUUID(),
    name: profile.name.trim(),
    providerId,
    apiBase,
    apiKey: nextApiKey,
    model: profile.model.trim(),
    capabilities,
    isPrimary: wantsPrimary,
    temperature: profile.temperature ?? existing?.temperature ?? 0,
    description: profile.description?.trim() || existing?.description || "",
    enabled: profile.enabled ?? existing?.enabled ?? true,
  };
}

async function readStoredProfiles(): Promise<StoredModelProfile[]> {
  try {
    const raw = await fs.readFile(MODEL_PROFILES_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStoredProfiles(profiles: StoredModelProfile[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MODEL_PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf8");
}

function toPublicProfile(profile: StoredModelProfile): ModelProfile {
  return {
    ...profile,
    apiKey: "",
    hasApiKey: Boolean(profile.apiKey?.trim()),
  };
}

export async function listModelProfiles(): Promise<ModelProfile[]> {
  const profiles = await readStoredProfiles();
  return profiles.map(toPublicProfile);
}

export async function getStoredModelProfile(id: string): Promise<StoredModelProfile | null> {
  const profiles = await readStoredProfiles();
  return profiles.find((profile) => profile.id === id) ?? null;
}

export async function getPrimaryModelProfile(): Promise<StoredModelProfile | null> {
  const profiles = await readStoredProfiles();
  return profiles
    .filter((profile) => profile.enabled && profile.isPrimary && profile.capabilities?.includes("orchestration"))
    .sort(compareProfilesForCapability("orchestration"))[0] ?? null;
}

export async function findStoredModelProfile(query: string): Promise<StoredModelProfile | null> {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const profiles = await readStoredProfiles();
  return profiles.find((profile) => profile.enabled && (profile.id === query || profile.name.trim().toLowerCase() === needle)) ?? null;
}

function compareProfilesForCapability(capability: ModelCapability) {
  return (a: StoredModelProfile, b: StoredModelProfile) => {
    const primaryWeight = capability === "orchestration"
      ? Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary))
      : Number(Boolean(a.isPrimary)) - Number(Boolean(b.isPrimary));
    if (primaryWeight !== 0) return primaryWeight;
    const nameWeight = a.name.localeCompare(b.name);
    if (nameWeight !== 0) return nameWeight;
    const modelWeight = a.model.localeCompare(b.model);
    if (modelWeight !== 0) return modelWeight;
    return a.id.localeCompare(b.id);
  };
}

export async function findStoredModelProfileByCapability(capability: ModelCapability): Promise<StoredModelProfile | null> {
  const profiles = await readStoredProfiles();
  return profiles
    .filter((profile) => profile.enabled && profile.capabilities?.includes(capability))
    .sort(compareProfilesForCapability(capability))[0] ?? null;
}

export async function getEnabledModelCapabilitySummary(): Promise<Record<ModelCapability, string[]>> {
  const summary = Object.fromEntries(MODEL_CAPABILITIES.map((capability) => [capability, [] as string[]])) as unknown as Record<ModelCapability, string[]>;
  const profiles = await readStoredProfiles();
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const capabilities = normalizeCapabilities(profile.capabilities, inferModelCapabilities(profile.model));
    for (const capability of capabilities) {
      summary[capability].push(profile.isPrimary ? `${profile.name} (${profile.model}, primary)` : `${profile.name} (${profile.model})`);
    }
  }
  for (const capability of MODEL_CAPABILITIES) {
    summary[capability].sort((a, b) => a.localeCompare(b));
  }
  return summary;
}

export async function saveModelProfile(profile: Partial<ModelProfile> & Pick<ModelProfile, "name" | "apiBase" | "model">): Promise<ModelProfile> {
  const profiles = await readStoredProfiles();
  const existingIndex = profile.id ? profiles.findIndex((item) => item.id === profile.id) : -1;
  const existing = existingIndex >= 0 ? profiles[existingIndex] : undefined;
  const normalized = normalizeProfile(profile, existing);

  if (normalized.enabled && normalized.isPrimary) {
    for (const item of profiles) {
      if (item.id !== normalized.id) item.isPrimary = false;
    }
  }

  if (existingIndex >= 0) {
    profiles[existingIndex] = normalized;
  } else {
    profiles.push(normalized);
  }

  await writeStoredProfiles(profiles);
  return toPublicProfile(normalized);
}

export async function getStoredModelProfileApiKey(id: string): Promise<string> {
  const profile = await getStoredModelProfile(id);
  return profile?.apiKey?.trim() ?? "";
}

export async function deleteModelProfile(id: string) {
  const profiles = await readStoredProfiles();
  const next = profiles.filter((profile) => profile.id !== id);
  await writeStoredProfiles(next);
}

interface OpenAIModelListResponse {
  data?: Array<{ id?: string; owned_by?: string; [key: string]: unknown }>;
  error?: { message?: string };
}

interface AnthropicModelListResponse {
  data?: Array<{
    id?: string;
    display_name?: string;
    created_at?: string;
    type?: string;
    [key: string]: unknown;
  }>;
  error?: { message?: string };
}

function toDiscoveredModels(items: Array<{ id?: string; owned_by?: string; display_name?: string; [key: string]: unknown }>) {
  return items
    .filter((item): item is { id: string; owned_by?: string; display_name?: string; [key: string]: unknown } => Boolean(item.id))
    .map((item) => ({
      id: item.id,
      label: item.display_name || item.id,
      ownedBy: item.owned_by,
      capabilities: inferModelCapabilities(item.id, item),
      metadata: item,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function discoverModels(apiBase: string, apiKey: string, providerId: ProviderId = "openai-compatible"): Promise<DiscoveredModel[]> {
  const normalizedProvider = normalizeProviderId(providerId);
  const base = (apiBase.trim() || getProviderDefaultApiBase(normalizedProvider)).replace(/\/+$/, "");
  if (!base) throw new Error("API Base is required.");
  if (!/^https?:\/\//i.test(base)) throw new Error("API Base must start with http:// or https://.");
  if (!apiKey.trim()) throw new Error("API Key is required.");

  if (normalizedProvider === "anthropic-compatible") {
    const response = await fetch(`${base}/models`, {
      headers: {
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
    });
    const data = await response.json().catch(() => ({})) as AnthropicModelListResponse;
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Failed to fetch ${getProviderName(normalizedProvider)} models: ${response.status}`);
    }
    return toDiscoveredModels(data.data ?? []);
  }

  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  });
  const data = await response.json().catch(() => ({})) as OpenAIModelListResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Failed to fetch ${getProviderName(normalizedProvider)} models: ${response.status}`);
  }

  return toDiscoveredModels(data.data ?? []);
}

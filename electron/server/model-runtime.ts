import type {
  AgentSettings,
  ChatMessage,
  ModelCapability,
  PlannerExecutorModelRole,
  ProviderId,
  ThinkingEffort,
} from "../../src/shared/types";
import { isModelCapability } from "../../src/shared/types";
import {
  buildOpenAICompatibleAuthHeaders,
  normalizeProviderApiBase,
  providerConnectionAllowsEmptyApiKey,
  resolveProviderSdkApiKey,
} from "../../src/shared/providers";
import { normalizeAiRequestTimeoutMs } from "../../src/shared/settings";
import { withAiRequestRetries } from "./ai-retry";
import { getRunAbortSignal } from "./run-control";
import {
  ensureCapabilityModelProfile,
  findStoredModelProfile,
  findStoredModelProfileByCapability,
  getStoredModelProfile,
  getPrimaryModelProfile,
  inferModelCapabilities,
  resolveProviderModelConnection,
  type StoredModelProfile,
} from "./model-profiles";
import { resolveStoredModelContextBudget } from "./model-context";
import { normalizeChatCompletionMessages } from "./model-message-normalization";
import type { ToolExecutionContext } from "./types";
import { getOptionalStringArg, getStringArg } from "./utils";

const MISSING_PRIMARY_MODEL_MESSAGE = "No primary model is configured. Go to Settings > Models, create a model, add an API key, and mark it as Primary.";

export interface ModelRuntimeConfig {
  profileId?: string;
  name: string;
  providerId: ProviderId;
  providerName?: string;
  apiBase: string;
  apiKey: string;
  model: string;
  capabilities?: ModelCapability[];
  temperature: number;
  thinkingEnabled?: boolean;
  thinkingEffort?: ThinkingEffort;
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  autoCompactTokenLimit?: number;
  compactionTargetRatio?: number;
  contextWindowSource?: string;
  contextWindowSourceDetail?: string;
  contextWindowResolvedAt?: string;
  aiRequestTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface ThinkingRequestConfig {
  enabled: boolean;
  effort: ThinkingEffort;
  openAIReasoningEffort?: "none" | "high" | "xhigh";
  anthropicThinkingType: "enabled" | "disabled";
  anthropicEffort?: ThinkingEffort;
}

export interface ChatContentTextPart {
  type: "text";
  text: string;
}

export interface ChatContentImagePart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "original" | "auto";
  };
}

export type ChatContentPart = ChatContentTextPart | ChatContentImagePart;

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
  error?: { message?: string };
}

interface AnthropicMessageContentText {
  type: "text";
  text: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicMessageContentText[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message?: string };
}

function normalizeThinkingEffort(value: unknown): ThinkingEffort {
  return value === "max" ? "max" : "high";
}

function supportsOpenAINoneReasoning(model: string) {
  return /\bgpt-5(?:[.-]|\b)/i.test(model);
}

export function resolveThinkingRequestConfig(
  settings: Partial<AgentSettings> | undefined,
  model = "",
  overrides?: { thinkingEnabled?: boolean; thinkingEffort?: ThinkingEffort },
): ThinkingRequestConfig {
  const enabled = overrides?.thinkingEnabled ?? settings?.thinkingEnabled === true;
  const effort = normalizeThinkingEffort(overrides?.thinkingEffort ?? settings?.thinkingEffort);

  return {
    enabled,
    effort,
    openAIReasoningEffort: enabled
      ? (effort === "max" ? "xhigh" : "high")
      : (supportsOpenAINoneReasoning(model) ? "none" : undefined),
    anthropicThinkingType: enabled ? "enabled" : "disabled",
    anthropicEffort: enabled ? effort : undefined,
  };
}

function toRuntimeConfig(
  name: string,
  providerId: ProviderId,
  providerName: string | undefined,
  apiBase: string,
  apiKey: string,
  model: string,
  temperature: number,
  contextBudget: Partial<ModelRuntimeConfig> = {},
  thinkingConfig: Pick<ModelRuntimeConfig, "thinkingEnabled" | "thinkingEffort"> = {},
  aiRequestTimeoutMs = 0,
  abortSignal?: AbortSignal,
  capabilities?: ModelCapability[],
  profileId?: string,
): ModelRuntimeConfig {
  const normalizedModel = model.trim();
  const mergedCapabilities = [...new Set([...(capabilities ?? []), ...inferModelCapabilities(normalizedModel)])];
  return {
    profileId,
    name,
    providerId,
    providerName,
    apiBase: normalizeProviderApiBase(apiBase, providerId),
    apiKey: apiKey.trim(),
    model: normalizedModel,
    capabilities: mergedCapabilities,
    temperature,
    thinkingEnabled: thinkingConfig.thinkingEnabled,
    thinkingEffort: thinkingConfig.thinkingEffort,
    contextWindowTokens: contextBudget.contextWindowTokens,
    reservedOutputTokens: contextBudget.reservedOutputTokens,
    autoCompactTokenLimit: contextBudget.autoCompactTokenLimit,
    compactionTargetRatio: contextBudget.compactionTargetRatio,
    contextWindowSource: contextBudget.contextWindowSource,
    contextWindowSourceDetail: contextBudget.contextWindowSourceDetail,
    contextWindowResolvedAt: contextBudget.contextWindowResolvedAt,
    aiRequestTimeoutMs: normalizeAiRequestTimeoutMs(aiRequestTimeoutMs),
    abortSignal,
  };
}

function buildOpenAIRequestHeaders(
  config: Pick<ModelRuntimeConfig, "providerId" | "providerName" | "apiBase" | "apiKey">,
  contentType = "application/json",
) {
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...buildOpenAICompatibleAuthHeaders(config.apiKey, {
      providerId: config.providerId,
      providerName: config.providerName,
      apiBase: config.apiBase,
    }),
  };
}

async function fetchAiRequest(input: RequestInfo | URL, init: RequestInit, timeoutMs?: number, abortSignal?: AbortSignal) {
  const normalizedTimeout = normalizeAiRequestTimeoutMs(timeoutMs);
  if (!normalizedTimeout && !abortSignal) return fetch(input, init);

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (abortSignal?.aborted) {
    abort();
  } else {
    abortSignal?.addEventListener("abort", abort, { once: true });
  }
  const timer = normalizedTimeout
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, normalizedTimeout)
    : undefined;
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timedOut ? `AI request timed out after ${normalizedTimeout}ms.` : "AI request interrupted by user.");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    abortSignal?.removeEventListener("abort", abort);
  }
}

export function modelConfigAllowsEmptyApiKey(
  config: Pick<ModelRuntimeConfig, "providerId" | "providerName" | "apiBase">,
) {
  return providerConnectionAllowsEmptyApiKey({
    providerId: config.providerId,
    providerName: config.providerName,
    apiBase: config.apiBase,
  });
}

function roleDisplayName(role: PlannerExecutorModelRole) {
  switch (role) {
    case "planner":
      return "planner";
    case "executor":
      return "executor";
    case "verifier":
      return "verifier";
    default:
      return "primary";
  }
}

function configHasChatCapability(config: Pick<ModelRuntimeConfig, "capabilities">) {
  return Boolean(config.capabilities?.includes("chat") || config.capabilities?.includes("orchestration"));
}

function validateRoleConfig(role: PlannerExecutorModelRole, config: ModelRuntimeConfig) {
  const roleName = roleDisplayName(role);
  if (!config.model.trim()) {
    return `${roleName} profile "${config.name}" does not have a model id.`;
  }
  if (!configHasChatCapability(config)) {
    return `${roleName} profile "${config.name}" must include the chat or orchestration capability.`;
  }
  if (!config.apiKey.trim() && !modelConfigAllowsEmptyApiKey(config)) {
    return `${roleName} profile "${config.name}" does not have an API key.`;
  }
  return "";
}

async function toRuntimeConfigFromStoredProfile(
  profile: StoredModelProfile,
  settings: Partial<AgentSettings>,
  requestId?: string,
): Promise<ModelRuntimeConfig> {
  const budget = await resolveStoredModelContextBudget({ profile, settings });
  return toRuntimeConfig(
    profile.name,
    profile.providerId,
    profile.providerName,
    profile.apiBase,
    profile.apiKey,
    profile.model,
    profile.temperature ?? settings.temperature ?? 0,
    budget,
    { thinkingEnabled: profile.thinkingEnabled, thinkingEffort: profile.thinkingEffort },
    settings.aiRequestTimeoutMs,
    requestId ? getRunAbortSignal(requestId) : undefined,
    profile.capabilities,
    profile.id,
  );
}

export interface PlannerExecutorRoleConfigs {
  enabled: boolean;
  primary: ModelRuntimeConfig;
  planner: ModelRuntimeConfig;
  executor?: ModelRuntimeConfig;
  verifier?: ModelRuntimeConfig;
  executorSelectionReason?: string;
  executorCostConfidence?: "known" | "unknown";
  usingPrimaryAsExecutor?: boolean;
  errors: string[];
}

export async function resolvePlannerExecutorRoleConfigs(
  settings: AgentSettings,
  primaryConfig: ModelRuntimeConfig,
  requestId?: string,
): Promise<PlannerExecutorRoleConfigs> {
  if (!settings.plannerExecutorRoutingEnabled) {
    return {
      enabled: false,
      primary: primaryConfig,
      planner: primaryConfig,
      executor: primaryConfig,
      verifier: primaryConfig,
      errors: [],
    };
  }

  const errors: string[] = [];
  const primaryValidationError = validateRoleConfig("primary", primaryConfig);
  if (primaryValidationError) {
    errors.push(`Unable to use the primary model for planning and checking: ${primaryValidationError}`);
  }

  const selectedExecutorProfileId = settings.executorProfileId?.trim() ?? "";
  let executorProfile: StoredModelProfile | null = null;
  if (!selectedExecutorProfileId) {
    errors.push("Planner/executor routing is enabled, but no executor model profile is selected in Settings.");
  } else if (selectedExecutorProfileId === primaryConfig.profileId) {
    errors.push("The executor model profile must be different from the primary model profile.");
  } else {
    executorProfile = await getStoredModelProfile(selectedExecutorProfileId);
    if (!executorProfile) {
      errors.push("The selected executor model profile was not found.");
    } else if (!executorProfile.enabled) {
      errors.push(`The selected executor model profile "${executorProfile.name}" is disabled.`);
    }
  }

  const executorConfig = executorProfile && executorProfile.enabled
    ? await toRuntimeConfigFromStoredProfile(executorProfile, settings, requestId)
    : undefined;
  const executorValidationError = executorConfig ? validateRoleConfig("executor", executorConfig) : "";
  if (executorValidationError) {
    errors.push(`Unable to use the selected executor model: ${executorValidationError}`);
  }

  return {
    enabled: true,
    primary: primaryConfig,
    planner: primaryConfig,
    executor: executorValidationError ? undefined : executorConfig,
    verifier: primaryConfig,
    executorSelectionReason: executorProfile ? "configured_executor_profile" : "missing_configured_executor_profile",
    executorCostConfidence: "unknown",
    usingPrimaryAsExecutor: false,
    errors,
  };
}

export async function resolvePrimaryModelConfig(settings: AgentSettings, storedApiKey = ""): Promise<ModelRuntimeConfig> {
  const primary = await getPrimaryModelProfile();
  if (primary) {
    const budget = await resolveStoredModelContextBudget({ profile: primary, settings });
    return toRuntimeConfig(
      primary.name,
      primary.providerId,
      primary.providerName,
      primary.apiBase,
      primary.apiKey,
      primary.model,
      primary.temperature ?? settings.temperature,
      budget,
      { thinkingEnabled: primary.thinkingEnabled, thinkingEffort: primary.thinkingEffort },
      settings.aiRequestTimeoutMs,
      undefined,
      primary.capabilities,
      primary.id,
    );
  }
  const apiKey = settings.apiKey || storedApiKey || "";
  const model = settings.model?.trim() || "";
  if (!model) {
    throw new Error(MISSING_PRIMARY_MODEL_MESSAGE);
  }
  const budget = await resolveStoredModelContextBudget({ settings });
  return toRuntimeConfig("default", settings.providerId, settings.providerName, settings.apiBase, apiKey, model, settings.temperature, budget, {
    thinkingEnabled: settings.thinkingEnabled,
    thinkingEffort: settings.thinkingEffort,
  }, settings.aiRequestTimeoutMs);
}

export async function resolveModelConfigFromArgs(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  options: { capability?: ModelCapability; allowDefault?: boolean } = {},
): Promise<ModelRuntimeConfig> {
  const profileQuery = getOptionalStringArg(args, "profile");
  const rawCapability = options.capability ?? (getOptionalStringArg(args, "capability") as ModelCapability | "");
  const capability = rawCapability && isModelCapability(rawCapability) ? rawCapability : "";
  if (rawCapability && !capability) {
    throw new Error(`Unknown model capability: ${rawCapability}`);
  }

  if (profileQuery && profileQuery !== "default") {
    const profile = await findStoredModelProfile(profileQuery);
    if (!profile) {
      throw new Error(`Unknown model profile: ${profileQuery}`);
    }
    const budget = await resolveStoredModelContextBudget({ profile, settings: ctx.settings });
    return toRuntimeConfig(
      profile.name,
      profile.providerId,
      profile.providerName,
      profile.apiBase,
      profile.apiKey,
      profile.model,
      profile.temperature ?? ctx.settings.temperature,
      budget,
      { thinkingEnabled: profile.thinkingEnabled, thinkingEffort: profile.thinkingEffort },
      ctx.settings.aiRequestTimeoutMs,
      getRunAbortSignal(ctx.requestId),
      profile.capabilities,
      profile.id,
    );
  }

  if (capability) {
    const scopedCapabilities: ModelCapability[] = ["orchestration", "chat"];
    const scope = scopedCapabilities.includes(capability)
      ? { providerId: ctx.settings.providerId, apiBase: ctx.apiBase }
      : undefined;
    const profile = await findStoredModelProfileByCapability(capability, scope)
      ?? (capability === "chat" ? await findStoredModelProfileByCapability("orchestration") : null);
    if (profile) {
      const budget = await resolveStoredModelContextBudget({ profile, settings: ctx.settings });
      return toRuntimeConfig(
        profile.name,
        profile.providerId,
        profile.providerName,
        profile.apiBase,
        profile.apiKey,
        profile.model,
        profile.temperature ?? ctx.settings.temperature,
        budget,
        { thinkingEnabled: profile.thinkingEnabled, thinkingEffort: profile.thinkingEffort },
        ctx.settings.aiRequestTimeoutMs,
        getRunAbortSignal(ctx.requestId),
        profile.capabilities,
        profile.id,
      );
    }
    if (options.allowDefault === false) {
      throw new Error(`No enabled model profile is configured for capability "${capability}". Configure a specialist model in Settings > Models.`);
    }
  }

  if ((!profileQuery || profileQuery === "default") && ctx.defaultModelProfileId) {
    const profile = await findStoredModelProfile(ctx.defaultModelProfileId);
    if (!profile) {
      throw new Error(`Default ${ctx.defaultModelRole || "model"} profile is unavailable: ${ctx.defaultModelProfileId}`);
    }
    const budget = await resolveStoredModelContextBudget({ profile, settings: ctx.settings });
    return toRuntimeConfig(
      profile.name,
      profile.providerId,
      profile.providerName,
      profile.apiBase,
      profile.apiKey,
      profile.model,
      profile.temperature ?? ctx.settings.temperature,
      budget,
      { thinkingEnabled: profile.thinkingEnabled, thinkingEffort: profile.thinkingEffort },
      ctx.settings.aiRequestTimeoutMs,
      getRunAbortSignal(ctx.requestId),
      profile.capabilities,
      profile.id,
    );
  }

  if (!profileQuery || profileQuery === "default" || options.allowDefault !== false) {
    const budget = await resolveStoredModelContextBudget({ settings: ctx.settings });
    return toRuntimeConfig("default", ctx.settings.providerId, ctx.settings.providerName, ctx.apiBase, ctx.apiKey, ctx.settings.model, ctx.settings.temperature, budget, {
      thinkingEnabled: ctx.settings.thinkingEnabled,
      thinkingEffort: ctx.settings.thinkingEffort,
    }, ctx.settings.aiRequestTimeoutMs, getRunAbortSignal(ctx.requestId));
  }

  throw new Error(`Unable to resolve model profile: ${profileQuery}`);
}

export async function resolveCapabilityModelConfig(
  capability: ModelCapability,
  settings: Partial<AgentSettings>,
  connection?: { apiKey?: string; apiBase?: string },
): Promise<ModelRuntimeConfig | null> {
  const providerId = settings.providerId;
  const resolvedConnection = await resolveProviderModelConnection({
    providerId,
    providerName: settings.providerName,
    apiBase: connection?.apiBase || settings.apiBase,
    apiKey: connection?.apiKey || settings.apiKey,
  });

  const profile = await ensureCapabilityModelProfile(capability, resolvedConnection);
  if (!profile) {
    return null;
  }

  const budget = await resolveStoredModelContextBudget({ profile, settings });
  return toRuntimeConfig(
    profile.name,
    profile.providerId,
    profile.providerName,
    profile.apiBase,
    profile.apiKey,
    profile.model,
    profile.temperature ?? settings.temperature ?? 0,
    budget,
    { thinkingEnabled: profile.thinkingEnabled, thinkingEffort: profile.thinkingEffort },
    settings.aiRequestTimeoutMs,
    undefined,
    profile.capabilities,
    profile.id,
  );
}

function normalizeChatContent(content: string | ChatContentPart[]) {
  return typeof content === "string" ? content : content;
}

function imageUrlToAnthropicSource(url: string) {
  const dataUrlMatch = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    return {
      type: "base64",
      media_type: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }
  if (/^https?:\/\//i.test(url)) {
    return {
      type: "url",
      url,
    };
  }
  throw new Error("Anthropic image inputs must be data URLs or HTTP(S) URLs.");
}

function toAnthropicContent(content: string | ChatContentPart[]) {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image",
      source: imageUrlToAnthropicSource(part.image_url.url),
    };
  });
}

async function callAnthropicMessages(
  config: ModelRuntimeConfig,
  messages: ChatCompletionMessage[],
  options: { temperature?: number; maxTokens?: number; thinking?: ThinkingRequestConfig } = {},
) {
  const normalizedMessages = normalizeChatCompletionMessages(messages);
  const system = normalizedMessages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : "")
    .filter(Boolean)
    .join("\n\n");
  const anthropicMessages = normalizedMessages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: toAnthropicContent(message.content),
    }));

  return withAiRequestRetries(async () => {
    const response = await fetchAiRequest(`${config.apiBase}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? config.temperature,
        ...(options.thinking
          ? {
              thinking: {
                type: options.thinking.anthropicThinkingType,
              },
            }
          : {}),
        ...(options.thinking?.enabled && options.thinking.anthropicEffort
          ? {
              output_config: {
                effort: options.thinking.anthropicEffort,
              },
            }
          : {}),
        ...(system ? { system } : {}),
        messages: anthropicMessages,
      }),
    }, config.aiRequestTimeoutMs, config.abortSignal);

    const data = await response.json().catch(() => ({})) as AnthropicMessageResponse;
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Anthropic model call failed: ${response.status}`);
    }

    const content = (data.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    if (!content) {
      throw new Error("Anthropic model call returned empty content.");
    }

    return {
      content,
      usage: {
        prompt_tokens: data.usage?.input_tokens,
        completion_tokens: data.usage?.output_tokens,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    };
  });
}

export async function callChatCompletion(
  config: ModelRuntimeConfig,
  messages: ChatCompletionMessage[],
  options: { temperature?: number; maxTokens?: number; thinking?: ThinkingRequestConfig } = {},
) {
  const normalizedMessages = normalizeChatCompletionMessages(messages);
  if (config.providerId === "anthropic-compatible") {
    return callAnthropicMessages(config, normalizedMessages, options);
  }

  return withAiRequestRetries(async () => {
    const response = await fetchAiRequest(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: buildOpenAIRequestHeaders(config),
      body: JSON.stringify({
        model: config.model,
        temperature: options.temperature ?? config.temperature,
        max_tokens: options.maxTokens ?? 1024,
        ...(options.thinking?.openAIReasoningEffort
          ? { reasoning_effort: options.thinking.openAIReasoningEffort }
          : {}),
        messages: normalizedMessages.map((message) => ({
          role: message.role,
          content: normalizeChatContent(message.content),
        })),
      }),
    }, config.aiRequestTimeoutMs, config.abortSignal);

    const data = await response.json().catch(() => ({})) as OpenAIChatResponse;
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Model call failed: ${response.status}`);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Model call returned empty content.");
    }

    return {
      content,
      usage: data.usage,
    };
  });
}

export async function callImageGeneration(
  config: ModelRuntimeConfig,
  args: {
    prompt: string;
    n?: number;
    size?: string;
    quality?: string;
    background?: string;
    outputFormat?: string;
  },
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI image generation endpoints. Configure an OpenAI-compatible image model for image_generation.");
  }

  const body: Record<string, unknown> = {
    model: config.model,
    prompt: args.prompt,
    n: Math.max(1, Math.min(10, args.n ?? 1)),
  };
  if (args.size) body.size = args.size;
  if (args.quality) body.quality = args.quality;
  if (args.background) body.background = args.background;
  if (args.outputFormat) body.output_format = args.outputFormat;
  if (!/^(gpt-image|chatgpt-image)/i.test(config.model)) {
    body.response_format = "b64_json";
  }

  return withAiRequestRetries(async () => {
    const response = await fetchAiRequest(`${config.apiBase}/images/generations`, {
      method: "POST",
      headers: buildOpenAIRequestHeaders(config),
      body: JSON.stringify(body),
    }, config.aiRequestTimeoutMs, config.abortSignal);
    const data = await response.json().catch(() => ({})) as OpenAIImageResponse;
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Image generation failed: ${response.status}`);
    }
    return data;
  });
}

export async function callImageEdit(
  config: ModelRuntimeConfig,
  args: {
    prompt: string;
    images: Array<{ buffer: Buffer; filename: string; mimeType: string }>;
    n?: number;
    size?: string;
    quality?: string;
    background?: string;
    inputFidelity?: "low" | "high";
    outputFormat?: string;
  },
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI image editing endpoints. Configure an OpenAI-compatible image editing model for image_editing.");
  }

  return withAiRequestRetries(async () => {
    const form = new FormData();
    form.append("model", config.model);
    form.append("prompt", args.prompt);
    form.append("n", String(Math.max(1, Math.min(10, args.n ?? 1))));
    for (const image of args.images) {
      form.append("image", new Blob([toBlobPart(image.buffer)], { type: image.mimeType || "application/octet-stream" }), image.filename);
    }
    if (args.size) form.append("size", args.size);
    if (args.quality) form.append("quality", args.quality);
    if (args.background) form.append("background", args.background);
    if (args.inputFidelity) form.append("input_fidelity", args.inputFidelity);
    if (args.outputFormat) form.append("output_format", args.outputFormat);
    if (!/^(gpt-image|chatgpt-image)/i.test(config.model)) {
      form.append("response_format", "b64_json");
    }

    const response = await fetchAiRequest(`${config.apiBase}/images/edits`, {
      method: "POST",
      headers: buildOpenAIRequestHeaders(config, ""),
      body: form,
    }, config.aiRequestTimeoutMs, config.abortSignal);
    const data = await response.json().catch(() => ({})) as OpenAIImageResponse;
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Image edit failed: ${response.status}`);
    }
    return data;
  });
}

export async function callSpeechToText(
  config: ModelRuntimeConfig,
  args: {
    file: Buffer;
    filename: string;
    mimeType: string;
    prompt?: string;
    modelOverride?: string;
  },
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI speech-to-text endpoints. Configure an OpenAI-compatible audio model for speech_to_text.");
  }

  return withAiRequestRetries(async () => {
    const form = new FormData();
    const blob = new Blob([toBlobPart(args.file)], { type: args.mimeType || "application/octet-stream" });
    form.append("file", blob, args.filename);
    form.append("model", args.modelOverride || config.model);
    form.append("response_format", "text");
    if (args.prompt) form.append("prompt", args.prompt);

    const response = await fetchAiRequest(`${config.apiBase}/audio/transcriptions`, {
      method: "POST",
      headers: buildOpenAIRequestHeaders(config, ""),
      body: form,
    }, config.aiRequestTimeoutMs, config.abortSignal);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `Speech-to-text failed: ${response.status}`);
    }
    return text.trim();
  });
}

export async function callTextToSpeech(
  config: ModelRuntimeConfig,
  args: {
    input: string;
    voice?: string;
    instructions?: string;
    modelOverride?: string;
  },
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI text-to-speech endpoints. Configure an OpenAI-compatible audio model for text_to_speech.");
  }

  return withAiRequestRetries(async () => {
    const response = await fetchAiRequest(`${config.apiBase}/audio/speech`, {
      method: "POST",
      headers: buildOpenAIRequestHeaders(config),
      body: JSON.stringify({
        model: args.modelOverride || config.model,
        input: args.input,
        voice: args.voice || "alloy",
        instructions: args.instructions,
      }),
    }, config.aiRequestTimeoutMs, config.abortSignal);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw new Error(buffer.toString("utf8") || `Text-to-speech failed: ${response.status}`);
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
    return { buffer, mimeType };
  });
}

export function toBlobPart(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

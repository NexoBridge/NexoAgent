import React, { useEffect, useMemo, useState } from "react";
import {
  AutoComplete,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useChatStore } from "../../store/chat";
import {
  MODEL_CAPABILITIES,
  type AgentSettings,
  type DiscoveredModel,
  type ModelCapability,
  type ModelProfile,
  type ProviderId,
  type ThinkingEffort,
} from "../../shared/types";
import { apiDelete, apiGet, apiPost } from "../../services/api";
import "./index.scss";
import { sanitizeApiKeyForSave, SAVED_API_KEY_MASK } from "../../shared/settings";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import { useI18n } from "../../i18n";
import {
  getDefaultServiceProviderName,
  providerConnectionAllowsEmptyApiKey,
  getProviderDefaultApiBase,
  getProviderOptions,
  getProviderProtocolName,
  getServiceProviderDefaultApiBase,
  getServiceProviderDisplayName,
  getServiceProviderOptions,
  normalizeProviderId,
  normalizeServiceProviderName,
} from "../../shared/providers";

const { Text, Paragraph, Title } = Typography;

const CAPABILITY_COLORS: Record<ModelCapability, string> = {
  orchestration: "blue",
  chat: "green",
  vision: "cyan",
  image_generation: "purple",
  image_editing: "magenta",
  speech_to_text: "orange",
  text_to_speech: "gold",
  embedding: "geekblue",
};

const tokenCountFormatter = new Intl.NumberFormat("en-US");

function formatTokenCount(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? tokenCountFormatter.format(value) : "-";
}

function buildCapabilityLabels(lang: "zh" | "en"): Record<ModelCapability, string> {
  if (lang === "zh") {
    return {
      orchestration: "\u4e3b\u63a7",
      chat: "\u5bf9\u8bdd",
      vision: "\u89c6\u89c9",
      image_generation: "\u56fe\u50cf\u751f\u6210",
      image_editing: "\u56fe\u50cf\u7f16\u8f91",
      speech_to_text: "\u8bed\u97f3\u8bc6\u522b",
      text_to_speech: "\u8bed\u97f3\u5408\u6210",
      embedding: "Embedding",
    };
  }

  return {
    orchestration: "Orchestration",
    chat: "Chat",
    vision: "Vision",
    image_generation: "Image Generation",
    image_editing: "Image Editing",
    speech_to_text: "Speech to Text",
    text_to_speech: "Text to Speech",
    embedding: "Embedding",
  };
}

function profileCanRunAsExecutor(profile: ModelProfile) {
  return Boolean(
    profile.enabled
    && !profile.isPrimary
    && (profile.capabilities?.includes("chat") || profile.capabilities?.includes("orchestration")),
  );
}

function buildUi(lang: "zh" | "en") {
  return {
    pageTitle: lang === "zh" ? "\u8bbe\u7f6e" : "Settings",
    pageSubtitle: lang === "zh"
      ? "\u5728\u8fd9\u91cc\u7edf\u4e00\u7ba1\u7406\u5de5\u4f5c\u533a\u3001\u8bb0\u5fc6\u80fd\u529b\u548c\u6a21\u578b\u914d\u7f6e\u3002"
      : "Manage workspace behavior, memory features, and model profiles from one place.",
    createModel: lang === "zh" ? "\u65b0\u5efa\u6a21\u578b" : "New Model",
    generalSection: lang === "zh" ? "\u901a\u7528\u8bbe\u7f6e" : "General Settings",
    modelSection: lang === "zh" ? "\u6a21\u578b\u5217\u8868" : "Model Profiles",
    workspacePath: lang === "zh" ? "\u5de5\u4f5c\u533a\u8def\u5f84" : "Workspace Path",
    workspacePathTip: lang === "zh"
      ? "Agent \u9ed8\u8ba4\u4f7f\u7528\u7684\u5de5\u4f5c\u76ee\u5f55\u6839\u8def\u5f84\uff0c\u7559\u7a7a\u5219\u4f7f\u7528\u5f53\u524d\u9879\u76ee\u76ee\u5f55\u3002"
      : "Default workspace root for the agent. Leave empty to use the current project directory.",
    fileAccessRoots: lang === "zh" ? "\u989d\u5916\u6587\u4ef6\u8bbf\u95ee\u76ee\u5f55" : "Extra File Access Roots",
    fileAccessRootsTip: lang === "zh"
      ? "\u5141\u8bb8 Agent \u8bfb\u5199\u7684\u5176\u4ed6\u7edd\u5bf9\u8def\u5f84\uff0c\u4f8b\u5982 D:\\company\\shared\u3002"
      : "Additional absolute directories the agent can read and write, for example D:\\company\\shared.",
    enableMemory: lang === "zh" ? "\u542f\u7528\u8bb0\u5fc6" : "Enable Memory",
    enableKnowledge: lang === "zh" ? "\u542f\u7528\u77e5\u8bc6\u5e93" : "Enable Knowledge Base",
    temperature: "Temperature",
    enableContextCompaction: lang === "zh" ? "\u542f\u7528\u4e0a\u4e0b\u6587\u81ea\u52a8\u538b\u7f29" : "Enable Context Auto-compaction",
    aiRequestTimeout: lang === "zh" ? "AI \u8bf7\u6c42\u8d85\u65f6\uff08\u79d2\uff09" : "AI Request Timeout (s)",
    aiRequestTimeoutTip: lang === "zh"
      ? "\u586b 0 \u8868\u793a\u4e0d\u7531\u7cfb\u7edf\u81ea\u52a8\u8d85\u65f6\uff0c\u53ea\u80fd\u624b\u52a8\u505c\u6b62\uff1b\u586b\u6b63\u6570\u5219\u6309\u8be5\u65f6\u95f4\u4e2d\u65ad AI \u8bf7\u6c42\u3002"
      : "Use 0 to disable automatic app timeouts; positive values abort AI requests after this many seconds.",
    planningMode: lang === "zh" ? "\u89c4\u5212\u6a21\u5f0f" : "Planning Mode",
    planningFast: lang === "zh" ? "\u5feb\u901f" : "Fast",
    planningBalanced: lang === "zh" ? "\u5e73\u8861" : "Balanced",
    planningDeep: lang === "zh" ? "\u6df1\u5ea6" : "Deep",
    plannerExecutorRouting: lang === "zh" ? "\u5927\u6a21\u578b\u89c4\u5212\uff0c\u5c0f\u6a21\u578b\u6267\u884c" : "Big Model Plans, Small Model Runs",
    plannerExecutorRoutingTip: lang === "zh"
      ? "\u5f00\u542f\u540e\uff0c\u5927\u6a21\u578b\u8d1f\u8d23\u9636\u6bb5\u6027\u89c4\u5212\u548c\u7edf\u7b79\uff0c\u8bbe\u7f6e\u4e2d\u9009\u62e9\u7684\u5c0f\u6a21\u578b\u8d1f\u8d23\u6570\u636e\u5206\u6790\u548c\u6267\u884c\u3002"
      : "When this is on, the big model handles staged planning and orchestration, while the small model selected in Settings handles data analysis and execution.",
    executorModel: lang === "zh" ? "\u5c0f\u6a21\u578b\u6267\u884c\u5668" : "Small Model Executor",
    executorModelTip: lang === "zh"
      ? "\u53ea\u4f1a\u4f7f\u7528\u8fd9\u91cc\u9009\u4e2d\u7684\u6a21\u578b\uff0c\u4e0d\u4f1a\u81ea\u52a8\u731c\u6d4b\u5176\u4ed6 Profile\u3002"
      : "Only the selected profile is used as executor; other profiles are not auto-picked.",
    executorModelPlaceholder: lang === "zh" ? "\u9009\u62e9\u4e00\u4e2a\u5df2\u542f\u7528\u7684 Chat \u6a21\u578b" : "Select an enabled chat model",
    executorModelRequired: lang === "zh" ? "\u5f00\u542f\u540e\u8bf7\u9009\u62e9\u5c0f\u6a21\u578b\u6267\u884c\u5668" : "Select a small model executor when routing is enabled.",
    noExecutorProfiles: lang === "zh" ? "\u6ca1\u6709\u53ef\u7528\u7684\u6267\u884c\u6a21\u578b" : "No executor model profiles available",
    saveApplied: lang === "zh" ? "\u8bbe\u7f6e\u5df2\u4fdd\u5b58\uff0c\u4e0b\u4e00\u6761\u6d88\u606f\u4f1a\u7acb\u5373\u751f\u6548\u3002" : "Settings saved. The next message will use the updated configuration.",
    modelEmpty: lang === "zh" ? "\u8fd8\u6ca1\u6709\u6a21\u578b\u914d\u7f6e" : "No model profiles yet.",
    savedApiKey: lang === "zh" ? "\u5df2\u4fdd\u5b58 API Key" : "Saved API key",
    primary: lang === "zh" ? "\u4e3b\u6a21\u578b" : "Primary",
    contextManual: lang === "zh" ? "\u624b\u52a8" : "Manual",
    contextProvider: lang === "zh" ? "\u63d0\u4f9b\u5546" : "Provider",
    contextLookup: lang === "zh" ? "\u67e5\u8be2" : "Lookup",
    contextCache: lang === "zh" ? "\u7f13\u5b58" : "Cache",
    contextHint: lang === "zh" ? "\u63d0\u793a" : "Hint",
    contextDictionary: lang === "zh" ? "\u5b57\u5178" : "Dictionary",
    contextDefault: lang === "zh" ? "\u9ed8\u8ba4" : "Default",
    contextWindow: lang === "zh" ? "\u7a97\u53e3" : "Window",
    reservedOutput: lang === "zh" ? "\u9884\u7559\u8f93\u51fa" : "Reserve",
    compactLimit: lang === "zh" ? "\u538b\u7f29\u9608\u503c" : "Compact",
    thinking: lang === "zh" ? "\u6df1\u5ea6\u601d\u8003" : "Thinking",
    thinkingOn: lang === "zh" ? "\u5f00\u542f" : "On",
    thinkingOff: lang === "zh" ? "\u5173\u95ed" : "Off",
    thinkingEffort: lang === "zh" ? "\u601d\u8003\u5f3a\u5ea6" : "Reasoning Effort",
    thinkingHigh: lang === "zh" ? "\u9ad8" : "High",
    thinkingMax: lang === "zh" ? "\u6700\u5927" : "Max",
    description: lang === "zh" ? "\u8bf4\u660e" : "Description",
    modalCreateTitle: lang === "zh" ? "\u65b0\u5efa\u6a21\u578b" : "Create Model",
    modalEditTitle: lang === "zh" ? "\u7f16\u8f91\u6a21\u578b" : "Edit Model",
    name: lang === "zh" ? "\u540d\u79f0" : "Name",
    nameRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u540d\u79f0" : "Please enter a name.",
    protocol: lang === "zh" ? "\u534f\u8bae" : "Protocol",
    protocolRequired: lang === "zh" ? "\u8bf7\u9009\u62e9\u534f\u8bae" : "Please select a protocol.",
    serviceProvider: lang === "zh" ? "API \u670d\u52a1\u5546" : "API Service Provider",
    serviceProviderPlaceholder: lang === "zh" ? "\u8bf7\u9009\u62e9 API \u670d\u52a1\u5546" : "Select an API service provider",
    apiBase: "API Base",
    apiKey: "API Key",
    apiKeyKeep: lang === "zh" ? "API Key\uff08\u7559\u7a7a\u5219\u4fdd\u7559\u539f\u503c\uff09" : "API Key (leave empty to keep current value)",
    replaceApiKey: lang === "zh" ? "\u66ff\u6362 API Key" : "Replace API key",
    model: lang === "zh" ? "\u6a21\u578b" : "Model",
    modelRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u6a21\u578b\u540d" : "Please enter a model.",
    fetchModels: lang === "zh" ? "\u91cd\u65b0\u83b7\u53d6" : "Refresh",
    fetchingModels: lang === "zh" ? "\u6b63\u5728\u83b7\u53d6\u6a21\u578b..." : "Loading models...",
    selectModel: lang === "zh" ? "\u53ef\u624b\u52a8\u8f93\u5165\u6a21\u578b\u540d\uff0c\u6216\u5148\u83b7\u53d6\u5217\u8868" : "Enter a model name or fetch models",
    capabilities: lang === "zh" ? "\u80fd\u529b" : "Capabilities",
    capabilitiesRequired: lang === "zh" ? "\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u80fd\u529b" : "Select at least one capability.",
    primaryModel: lang === "zh" ? "\u8bbe\u4e3a\u4e3b\u6a21\u578b" : "Set as Primary",
    enabledField: lang === "zh" ? "\u542f\u7528" : "Enabled",
    discoveredFrom: (provider: string) => lang === "zh"
      ? `\u4ece ${provider} \u53d1\u73b0`
      : `Discovered from ${provider}`,
    discoverSuccess: (count: number) => lang === "zh"
      ? `\u5df2\u53d1\u73b0 ${count} \u4e2a\u6a21\u578b`
      : `Discovered ${count} models.`,
    discoverFailed: lang === "zh" ? "\u83b7\u53d6\u6a21\u578b\u5931\u8d25" : "Failed to fetch models.",
    profileSaved: lang === "zh" ? "\u6a21\u578b\u914d\u7f6e\u5df2\u4fdd\u5b58" : "Model profile saved.",
    profileDeleted: lang === "zh" ? "\u6a21\u578b\u914d\u7f6e\u5df2\u5220\u9664" : "Model profile deleted.",
    deleteTitle: (name: string) => lang === "zh"
      ? `\u5220\u9664\u6a21\u578b\u201c${name}\u201d\uff1f`
      : `Delete model "${name}"?`,
    primaryAction: lang === "zh" ? "\u8bbe\u4e3a\u4e3b\u6a21\u578b" : "Set as primary",
    unsetPrimaryAction: lang === "zh" ? "\u53d6\u6d88\u4e3b\u6a21\u578b" : "Unset primary",
    refreshContext: lang === "zh" ? "\u91cd\u65b0\u63a2\u6d4b\u4e0a\u4e0b\u6587" : "Refresh Context Budget",
    refreshContextLoading: lang === "zh" ? "\u5237\u65b0\u4e2d..." : "Refreshing...",
    refreshContextManual: lang === "zh"
      ? "\u5f53\u524d\u6a21\u578b\u6b63\u5728\u4f7f\u7528\u624b\u52a8\u4e0a\u4e0b\u6587\u9884\u7b97\uff0c\u8bf7\u5148\u6e05\u9664\u624b\u52a8\u8986\u76d6\u518d\u91cd\u65b0\u63a2\u6d4b\u3002"
      : "This profile is using a manual context budget. Clear the manual override before re-detecting.",
    refreshContextSuccess: (source: string) => lang === "zh"
      ? `\u4e0a\u4e0b\u6587\u9884\u7b97\u5df2\u4ece ${source} \u5237\u65b0\u3002`
      : `Context budget refreshed from ${source}.`,
    refreshContextFailed: lang === "zh" ? "\u4e0a\u4e0b\u6587\u9884\u7b97\u5237\u65b0\u5931\u8d25" : "Context refresh failed.",
    actionsLabel: lang === "zh" ? "\u64cd\u4f5c" : "Actions",
    actionsTooltip: lang === "zh" ? "\u7ba1\u7406\u8fd9\u4e2a\u6a21\u578b\u7684\u72b6\u6001\u548c\u914d\u7f6e" : "Manage this model",
    thinkingHelpTitle: lang === "zh" ? "\u6df1\u5ea6\u601d\u8003" : "Thinking",
    thinkingHelpText: lang === "zh"
      ? "\u9ed8\u8ba4\u5f00\u542f\uff0c\u7528\u4e8e\u63a7\u5236\u8fd9\u4e2a\u6a21\u578b\u7684\u601d\u8003\u6a21\u5f0f\u548c\u601d\u8003\u5f3a\u5ea6\u3002"
      : "Enabled by default. Controls this model's reasoning mode and effort.",
    unknownProvider: lang === "zh" ? "\u672a\u77e5" : "Unknown",
  };
}

function getContextSourceMeta(
  profile: Pick<ModelProfile, "contextWindowSource" | "contextWindowSourceDetail">,
  ui: ReturnType<typeof buildUi>,
) {
  const source = profile.contextWindowSource;
  const detail = (profile.contextWindowSourceDetail || "").toLowerCase();

  if (source === "user" || source === "profile") return { label: ui.contextManual, color: "gold" };
  if (source === "provider") return { label: ui.contextProvider, color: "blue" };
  if (source === "lookup") return { label: ui.contextLookup, color: "purple" };
  if (source === "cache") return { label: ui.contextCache, color: "cyan" };
  if (source === "dictionary" && detail.startsWith("model-name token hint")) return { label: ui.contextHint, color: "orange" };
  if (source === "dictionary") return { label: ui.contextDictionary, color: "green" };
  return { label: ui.contextDefault, color: "default" };
}

function getServiceProviderLabel(
  profile: Pick<ModelProfile, "providerName" | "apiBase" | "providerId">,
  lang: "zh" | "en",
  fallback: string,
) {
  const normalized = normalizeServiceProviderName(profile.providerName, profile.apiBase, profile.providerId);
  if (!normalized) return fallback;
  return getServiceProviderDisplayName(normalized, lang, profile.providerId);
}

const ApiKeyField: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
  hasApiKey: boolean;
  placeholder: string;
  replaceText: string;
}> = ({ value, onChange, hasApiKey, placeholder, replaceText }) => {
  const [editing, setEditing] = useState(!hasApiKey);

  useEffect(() => {
    setEditing(!hasApiKey);
  }, [hasApiKey]);

  const masked = hasApiKey && !editing;
  const displayValue = masked ? SAVED_API_KEY_MASK : (value ?? "");

  return (
    <div>
      <Input
        className="settings-page__input"
        value={displayValue}
        readOnly={masked}
        placeholder={masked ? undefined : placeholder}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {masked ? (
        <Button
          type="link"
          size="small"
          className="settings-page__api-key-replace"
          onClick={() => {
            setEditing(true);
            onChange?.("");
          }}
        >
          {replaceText}
        </Button>
      ) : null}
    </div>
  );
};

export const Settings: React.FC = () => {
  const { settings, loadSettings, saveSettings, modelProfiles: profiles, loadModelProfiles } = useChatStore();
  const { lang, t } = useI18n();
  const ui = useMemo(() => buildUi(lang), [lang]);
  const capabilityLabels = useMemo(() => buildCapabilityLabels(lang), [lang]);
  const providerOptions = useMemo(() => getProviderOptions(lang), [lang]);
  const [form] = Form.useForm<AgentSettings>();
  const [messageApi, ctx] = message.useMessage();
  const [formKey, setFormKey] = useState(0);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [profileForm] = Form.useForm<ModelProfile>();
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [refreshingContextProfileId, setRefreshingContextProfileId] = useState("");
  const watchedProviderId = Form.useWatch("providerId", profileForm) as ProviderId | undefined;
  const watchedProviderName = Form.useWatch("providerName", profileForm) as string | undefined;
  const watchedApiBase = Form.useWatch("apiBase", profileForm) as string | undefined;
  const watchedApiKey = Form.useWatch("apiKey", profileForm) as string | undefined;
  const routingEnabled = Form.useWatch("plannerExecutorRoutingEnabled", form) === true;

  const normalizedWatchedProviderId = normalizeProviderId(watchedProviderId);
  const allowsEmptyProfileApiKey = providerConnectionAllowsEmptyApiKey({
    providerId: normalizedWatchedProviderId,
    providerName: watchedProviderName,
    apiBase: String(watchedApiBase ?? ""),
  });
  const thinkingEffortOptions = useMemo(
    () => [
      { value: "high" as ThinkingEffort, label: ui.thinkingHigh },
      { value: "max" as ThinkingEffort, label: ui.thinkingMax },
    ],
    [ui],
  );
  const capabilityOptions = useMemo(
    () => MODEL_CAPABILITIES.map((value) => ({ value, label: capabilityLabels[value] })),
    [capabilityLabels],
  );
  const executorProfileOptions = useMemo(
    () => profiles
      .filter(profileCanRunAsExecutor)
      .map((profile) => ({
        value: profile.id,
        label: `${profile.name} / ${profile.model}`,
      })),
    [profiles],
  );
  const serviceProviderOptions = useMemo(() => {
    const baseOptions = getServiceProviderOptions(normalizedWatchedProviderId, lang);
    const currentName = normalizeServiceProviderName(
      watchedProviderName,
      String(watchedApiBase ?? ""),
      normalizedWatchedProviderId,
    );
    if (!currentName || baseOptions.some((option) => option.value === currentName)) {
      return baseOptions;
    }
    return [
      {
        value: currentName,
        label: getServiceProviderDisplayName(currentName, lang, normalizedWatchedProviderId),
      },
      ...baseOptions,
    ];
  }, [lang, normalizedWatchedProviderId, watchedApiBase, watchedProviderName]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    form.setFieldsValue({
      ...settings,
      fileAccessRoots: settings.fileAccessRoots ?? [],
    });
  }, [settings, form]);

  useEffect(() => {
    void loadModelProfiles().catch((error) => {
      console.warn("[settings] failed to load model profiles:", error);
    });
  }, [loadModelProfiles]);

  const label = (text: string) => <span className="settings-page__label">{text}</span>;

  const onSave = async (values: AgentSettings) => {
    await saveSettings(sanitizeApiKeyForSave({ ...settings, ...values }));
    setFormKey((key) => key + 1);
    void messageApi.success(ui.saveApplied);
  };

  const openCreateProfile = () => {
    const providerId = normalizeProviderId(settings.providerId);
    const apiBase = settings.apiBase?.trim() || getProviderDefaultApiBase(providerId);
    setEditingProfile(null);
    profileForm.resetFields();
    profileForm.setFieldsValue({
      providerId,
      providerName: normalizeServiceProviderName(getDefaultServiceProviderName(providerId), apiBase, providerId),
      apiBase,
      apiKey: "",
      name: "",
      model: "",
      capabilities: ["chat"],
      enabled: true,
      isPrimary: false,
      temperature: settings.temperature ?? 0,
      thinkingEnabled: true,
      thinkingEffort: "high",
      description: "",
    } as Partial<ModelProfile>);
    setDiscoveredModels([]);
    setProfileModalOpen(true);
  };

  const openEditProfile = (profile: ModelProfile) => {
    setEditingProfile(profile);
    profileForm.setFieldsValue({
      ...profile,
      providerId: normalizeProviderId(profile.providerId),
      providerName: normalizeServiceProviderName(profile.providerName, profile.apiBase, profile.providerId),
      apiKey: "",
      capabilities: profile.capabilities?.length ? profile.capabilities : ["chat"],
    });
    setDiscoveredModels([]);
    setProfileModalOpen(true);
  };

  const discoverProfileModels = async () => {
    const values = await profileForm.validateFields(["providerId", "apiBase"]);
    const apiKeyValue = String(profileForm.getFieldValue("apiKey") ?? "");
    setDiscovering(true);
    try {
      const models = await apiPost<DiscoveredModel[]>("/api/model-profiles/discover", {
        providerId: values.providerId,
        apiBase: String(values.apiBase ?? ""),
        apiKey: apiKeyValue === SAVED_API_KEY_MASK ? "" : apiKeyValue,
        profileId: editingProfile?.id,
      });
      setDiscoveredModels(models);
      void messageApi.success(ui.discoverSuccess(models.length));
      if (models.length > 0 && !profileForm.getFieldValue("model")) {
        const first = models[0];
        profileForm.setFieldsValue({
          model: first.id,
          providerName: normalizeServiceProviderName(
            profileForm.getFieldValue("providerName") || first.ownedBy || "",
            String(values.apiBase ?? ""),
            values.providerId,
          ),
          capabilities: first.capabilities.length ? first.capabilities : ["chat"],
          name: profileForm.getFieldValue("name") || first.label,
          description: profileForm.getFieldValue("description") || (first.ownedBy ? ui.discoveredFrom(first.ownedBy) : ui.discoveredFrom("provider")),
        });
      }
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : ui.discoverFailed);
    } finally {
      setDiscovering(false);
    }
  };

  const saveProfile = async () => {
    const values = await profileForm.validateFields();
    const modelId = String(values.model ?? "").trim();
    await apiPost<ModelProfile>("/api/model-profiles", {
      ...editingProfile,
      ...values,
      name: String(values.name ?? "").trim() || modelId,
      model: modelId,
      providerName: normalizeServiceProviderName(values.providerName, String(values.apiBase ?? ""), values.providerId),
      apiBase: String(values.apiBase ?? "").trim(),
      apiKey: values.apiKey === SAVED_API_KEY_MASK ? "" : values.apiKey,
      providerId: normalizeProviderId(values.providerId),
    });
    await loadModelProfiles();
    setProfileModalOpen(false);
    setEditingProfile(null);
    profileForm.resetFields();
    void messageApi.success(ui.profileSaved);
  };

  const deleteProfile = async (id: string) => {
    await apiDelete(`/api/model-profiles/${id}`);
    await loadModelProfiles();
    void messageApi.success(ui.profileDeleted);
  };

  const confirmDeleteProfile = (profile: ModelProfile) => {
    Modal.confirm({
      title: ui.deleteTitle(profile.name),
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteProfile(profile.id);
      },
    });
  };

  const setPrimaryProfile = async (profile: ModelProfile, isPrimary: boolean) => {
    const nextCapabilities = isPrimary && !profile.capabilities?.includes("orchestration")
      ? [...(profile.capabilities ?? []), "orchestration" as ModelCapability]
      : profile.capabilities;
    await apiPost<ModelProfile>("/api/model-profiles", {
      ...profile,
      isPrimary,
      capabilities: nextCapabilities,
      apiKey: "",
    });
    await loadModelProfiles();
  };

  const toggleProfileEnabled = async (profile: ModelProfile, enabled: boolean) => {
    await apiPost<ModelProfile>("/api/model-profiles", {
      ...profile,
      enabled,
      apiKey: "",
    });
    await loadModelProfiles();
  };

  const refreshProfileContext = async (profile: ModelProfile) => {
    if (profile.contextWindowSource === "user" || profile.contextWindowSource === "profile") {
      void messageApi.info(ui.refreshContextManual);
      return;
    }

    setRefreshingContextProfileId(profile.id);
    try {
      const saved = await apiPost<ModelProfile>(`/api/model-profiles/${profile.id}/refresh-context`, {});
      await loadModelProfiles();
      void messageApi.success(ui.refreshContextSuccess(getContextSourceMeta(saved, ui).label));
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : ui.refreshContextFailed);
    } finally {
      setRefreshingContextProfileId("");
    }
  };

  const modelOptions = discoveredModels.map((model) => ({
    value: model.id,
    label: model.ownedBy ? `${model.label} | ${model.ownedBy}` : model.label,
  }));

  const applyDiscoveredModel = (modelId: string) => {
    const model = discoveredModels.find((item) => item.id === modelId);
    if (!model) return;
    profileForm.setFieldsValue({
      model: model.id,
      name: profileForm.getFieldValue("name") || model.label,
      capabilities: model.capabilities.length ? model.capabilities : ["chat"],
      thinkingEnabled: profileForm.getFieldValue("thinkingEnabled") ?? true,
      thinkingEffort: profileForm.getFieldValue("thinkingEffort") || "high",
      description: profileForm.getFieldValue("description") || (model.ownedBy ? ui.discoveredFrom(model.ownedBy) : ui.discoveredFrom("provider")),
    });
  };

  useEffect(() => {
    if (!profileModalOpen || !watchedProviderId) return;
    const apiKeyValue = String(watchedApiKey ?? "");
    const hasTypedKey = Boolean(apiKeyValue.trim()) && apiKeyValue !== SAVED_API_KEY_MASK;
    const hasSavedKey = Boolean(editingProfile?.hasApiKey);
    if (!hasTypedKey && !hasSavedKey && !allowsEmptyProfileApiKey) return;
    const timer = window.setTimeout(() => {
      void discoverProfileModels();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [profileModalOpen, watchedProviderId, watchedApiBase, watchedApiKey, watchedProviderName, editingProfile?.id, editingProfile?.hasApiKey, allowsEmptyProfileApiKey]);

  return (
    <div className="settings-page">
      {ctx}
      <div className="settings-page__header">
        <div>
          <Title level={4} className="settings-page__page-title">
            {ui.pageTitle}
          </Title>
          <Text className="settings-page__subtitle">{ui.pageSubtitle}</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProfile}>
          {ui.createModel}
        </Button>
      </div>

      <Form
        key={formKey}
        form={form}
        layout="vertical"
        onFinish={(values) => void onSave(values as AgentSettings)}
        initialValues={{ ...settings, fileAccessRoots: settings.fileAccessRoots ?? [] }}
      >
        <div className="settings-page__form-grid">
          <div>
            <Form.Item label={label(ui.workspacePath)} name="workspacePath" tooltip={ui.workspacePathTip}>
              <Input className="settings-page__input" placeholder={"D:\\company"} />
            </Form.Item>
            <Form.Item label={label(ui.fileAccessRoots)} name="fileAccessRoots" tooltip={ui.fileAccessRootsTip}>
              <Select mode="tags" open={false} className="settings-page__full-width" placeholder={"D:\\company\\shared"} tokenSeparators={[","]} />
            </Form.Item>
            <Form.Item label={label(ui.enableMemory)} name="enableMemory" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label={label(ui.enableKnowledge)} name="enableKnowledge" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <div>
            <Form.Item label={label(ui.temperature)} name="temperature">
              <InputNumber min={0} max={2} step={0.1} className="settings-page__full-width" />
            </Form.Item>
            <Form.Item label={label(ui.enableContextCompaction)} name="enableContextCompaction" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              label={label(ui.aiRequestTimeout)}
              name="aiRequestTimeoutMs"
              tooltip={ui.aiRequestTimeoutTip}
              getValueProps={(value) => ({ value: Math.round((value ?? 0) / 1000) })}
              normalize={(seconds) => {
                const num = Number(seconds);
                return Number.isFinite(num) && num > 0 ? Math.floor(num * 1000) : 0;
              }}
            >
              <InputNumber min={0} step={60} className="settings-page__full-width" />
            </Form.Item>
            <Form.Item label={label(ui.planningMode)} name="planningMode">
              <Select
                className="settings-page__full-width"
                options={[
                  { value: "fast", label: ui.planningFast },
                  { value: "balanced", label: ui.planningBalanced },
                  { value: "deep", label: ui.planningDeep },
                ]}
              />
            </Form.Item>
          </div>
        </div>

        <div className="settings-page__routing-panel">
          <div className="settings-page__routing-header">
            <div>
              <div className="settings-page__routing-title">{ui.plannerExecutorRouting}</div>
              <Text className="settings-page__text-muted">{ui.plannerExecutorRoutingTip}</Text>
            </div>
            <Form.Item name="plannerExecutorRoutingEnabled" valuePropName="checked" noStyle>
              <Switch />
            </Form.Item>
          </div>
          <div className="settings-page__routing-grid">
            <Form.Item
              label={label(ui.executorModel)}
              name="executorProfileId"
              tooltip={ui.executorModelTip}
              rules={[
                ({ getFieldValue }) => ({
                  validator: (_, value) => {
                    if (getFieldValue("plannerExecutorRoutingEnabled") && !value) {
                      return Promise.reject(new Error(ui.executorModelRequired));
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <Select
                allowClear
                disabled={!routingEnabled}
                className="settings-page__full-width"
                placeholder={ui.executorModelPlaceholder}
                options={executorProfileOptions}
                notFoundContent={ui.noExecutorProfiles}
              />
            </Form.Item>
          </div>
        </div>

        <Divider className="settings-page__divider settings-page__divider--form" />
        <Button htmlType="submit" type="primary" className="settings-page__submit-btn">
          {t("saveSettings")}
        </Button>
      </Form>

      <Divider className="settings-page__divider settings-page__divider--section" />

      <div className="settings-page__section-title">{ui.modelSection}</div>
      <List
        locale={{ emptyText: ui.modelEmpty }}
        dataSource={profiles}
        renderItem={(profile) => {
          const contextMeta = getContextSourceMeta(profile, ui);
          const isRefreshing = refreshingContextProfileId === profile.id;

          return (
            <List.Item
              className="settings-page__profile-item"
              actions={[
                <OverflowMenuButton
                  key="more"
                  color="var(--nexo-accent)"
                  tooltip={ui.actionsTooltip}
                  label={ui.actionsLabel}
                  size="middle"
                  variant="outlined"
                  backgroundColor="var(--nexo-bg-primary)"
                  borderColor="var(--nexo-accent)"
                  items={[
                    {
                      key: "primary",
                      label: profile.isPrimary ? ui.unsetPrimaryAction : ui.primaryAction,
                      disabled: !profile.enabled && !profile.isPrimary,
                    },
                    { key: "toggle", label: profile.enabled ? t("disable") : t("enable") },
                    {
                      key: "refresh-context",
                      label: isRefreshing ? ui.refreshContextLoading : ui.refreshContext,
                      disabled: isRefreshing || profile.contextWindowSource === "user" || profile.contextWindowSource === "profile",
                    },
                    { key: "edit", label: t("edit") },
                    { key: "delete", label: t("delete"), danger: true },
                  ]}
                  onItemClick={(key) => {
                    if (key === "primary") {
                      void setPrimaryProfile(profile, !profile.isPrimary);
                      return;
                    }
                    if (key === "toggle") {
                      void toggleProfileEnabled(profile, !profile.enabled);
                      return;
                    }
                    if (key === "refresh-context") {
                      void refreshProfileContext(profile);
                      return;
                    }
                    if (key === "edit") {
                      openEditProfile(profile);
                      return;
                    }
                    if (key === "delete") {
                      confirmDeleteProfile(profile);
                    }
                  }}
                />,
              ]}
            >
              <List.Item.Meta
                title={(
                  <Space size={8} wrap>
                    <span className="settings-page__profile-name">{profile.name}</span>
                    {profile.isPrimary ? <Tag color="blue">{ui.primary}</Tag> : null}
                    <Tag color={profile.enabled ? "green" : "default"}>{profile.enabled ? t("enabled") : t("disabled")}</Tag>
                    <Tag color="cyan">{getServiceProviderLabel(profile, lang, ui.unknownProvider)}</Tag>
                    <Tag>{getProviderProtocolName(profile.providerId, lang)}</Tag>
                    {profile.hasApiKey ? <Tag color="gold">{ui.savedApiKey}</Tag> : null}
                    <Tag color={contextMeta.color}>{contextMeta.label}</Tag>
                  </Space>
                )}
                description={(
                  <Space direction="vertical" size={6} className="settings-page__profile-meta">
                    <Text className="settings-page__text-secondary">{profile.model}</Text>
                    <Space wrap size={4}>
                      {(profile.capabilities ?? []).map((capability) => (
                        <Tag key={capability} color={CAPABILITY_COLORS[capability]}>
                          {capabilityLabels[capability]}
                        </Tag>
                      ))}
                    </Space>
                    <Text className="settings-page__text-secondary">{profile.apiBase}</Text>
                    <Space wrap size={8}>
                      <Text className="settings-page__text-secondary">{ui.contextWindow} {formatTokenCount(profile.contextWindowTokens)}</Text>
                      <Text className="settings-page__text-secondary">{ui.reservedOutput} {formatTokenCount(profile.reservedOutputTokens)}</Text>
                      <Text className="settings-page__text-secondary">{ui.compactLimit} {formatTokenCount(profile.autoCompactTokenLimit)}</Text>
                    </Space>
                    <Space wrap size={8}>
                      <Text className="settings-page__text-secondary">{ui.thinking} {profile.thinkingEnabled === false ? ui.thinkingOff : ui.thinkingOn}</Text>
                      <Text className="settings-page__text-secondary">{ui.thinkingEffort} {profile.thinkingEffort === "max" ? ui.thinkingMax : ui.thinkingHigh}</Text>
                    </Space>
                    {profile.contextWindowSourceDetail ? (
                      <Text className="settings-page__text-muted">{profile.contextWindowSourceDetail}</Text>
                    ) : null}
                    {profile.description ? <Text className="settings-page__text-secondary">{profile.description}</Text> : null}
                  </Space>
                )}
              />
            </List.Item>
          );
        }}
      />

      <Modal
        title={editingProfile ? ui.modalEditTitle : ui.modalCreateTitle}
        open={profileModalOpen}
        onOk={() => void saveProfile()}
        onCancel={() => {
          setProfileModalOpen(false);
          setEditingProfile(null);
          profileForm.resetFields();
        }}
        okText={t("save")}
        cancelText={t("cancel")}
        width={900}
      >
        <Form form={profileForm} layout="vertical">
          <div className="settings-page__modal-grid">
            <Form.Item name="name" label={ui.name} rules={[{ required: true, message: ui.nameRequired }]} className="settings-page__modal-item">
              <Input />
            </Form.Item>
            <Form.Item name="providerId" label={ui.protocol} rules={[{ required: true, message: ui.protocolRequired }]} className="settings-page__modal-item">
              <Select
                options={providerOptions}
                onChange={(nextProviderId) => {
                  const previousProviderId = normalizeProviderId(profileForm.getFieldValue("providerId"));
                  const currentProviderName = String(profileForm.getFieldValue("providerName") ?? "").trim();
                  const currentApiBase = String(profileForm.getFieldValue("apiBase") ?? "").trim();
                  const previousDefaultApiBase = getProviderDefaultApiBase(previousProviderId);
                  const nextDefaultApiBase = getProviderDefaultApiBase(nextProviderId);
                  const previousServiceDefault = getServiceProviderDefaultApiBase(currentProviderName, previousProviderId);
                  const nextProviderName = !currentProviderName
                    || currentProviderName === normalizeServiceProviderName(currentProviderName, currentApiBase, previousProviderId)
                    || (previousServiceDefault && currentApiBase === previousServiceDefault)
                    ? normalizeServiceProviderName(getDefaultServiceProviderName(nextProviderId), nextDefaultApiBase, nextProviderId)
                    : currentProviderName;
                  profileForm.setFieldsValue({
                    providerName: nextProviderName,
                    model: "",
                    capabilities: ["chat"],
                    apiBase: !currentApiBase || currentApiBase === previousDefaultApiBase ? nextDefaultApiBase : currentApiBase,
                  });
                  setDiscoveredModels([]);
                }}
              />
            </Form.Item>
            <Form.Item
              name="providerName"
              label={ui.serviceProvider}
              className="settings-page__modal-item"
            >
              <Select
                showSearch
                options={serviceProviderOptions}
                placeholder={ui.serviceProviderPlaceholder}
                onChange={(nextProviderName) => {
                  const defaultApiBase = getServiceProviderDefaultApiBase(nextProviderName, normalizedWatchedProviderId);
                  if (!defaultApiBase) return;
                  profileForm.setFieldsValue({
                    providerName: normalizeServiceProviderName(nextProviderName, defaultApiBase, normalizedWatchedProviderId),
                    apiBase: defaultApiBase,
                    model: "",
                  });
                  setDiscoveredModels([]);
                }}
              />
            </Form.Item>
            <Form.Item name="apiBase" label={ui.apiBase} className="settings-page__modal-item">
              <Input
                placeholder={getServiceProviderDefaultApiBase(watchedProviderName, normalizedWatchedProviderId) || (watchedProviderId ? getProviderDefaultApiBase(watchedProviderId) : "https://api.example.com/v1")}
                onBlur={(event) => {
                  const currentProviderName = String(profileForm.getFieldValue("providerName") ?? "").trim();
                  if (!currentProviderName || currentProviderName === "Custom") {
                    profileForm.setFieldsValue({
                      providerName: normalizeServiceProviderName(currentProviderName, event.target.value, normalizedWatchedProviderId),
                    });
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="apiKey" label={editingProfile?.hasApiKey ? ui.apiKeyKeep : ui.apiKey} className="settings-page__modal-item">
              <ApiKeyField
                hasApiKey={Boolean(editingProfile?.hasApiKey)}
                placeholder="sk-..."
                replaceText={ui.replaceApiKey}
              />
            </Form.Item>
            <Form.Item
              name="model"
              label={(
                <Space className="settings-page__model-label-row">
                  <span>{ui.model}</span>
                  <Button type="link" icon={<ReloadOutlined />} loading={discovering} onClick={() => void discoverProfileModels()}>
                    {ui.fetchModels}
                  </Button>
                </Space>
              )}
              rules={[{ required: true, message: ui.modelRequired }]}
              className="settings-page__modal-item"
            >
              <AutoComplete
                options={modelOptions}
                placeholder={discovering ? ui.fetchingModels : ui.selectModel}
                filterOption={(inputValue, option) =>
                  String(option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase())
                  || String(option?.label ?? "").toLowerCase().includes(inputValue.toLowerCase())
                }
                onChange={(value) => {
                  const nextModel = String(value ?? "");
                  const discovered = discoveredModels.find((item) => item.id === nextModel);
                  profileForm.setFieldsValue({
                    model: nextModel,
                    name: profileForm.getFieldValue("name") || (discovered ? undefined : nextModel.trim()),
                  });
                }}
                onSelect={(value) => {
                  applyDiscoveredModel(String(value));
                }}
              />
            </Form.Item>
          </div>
          <div className="settings-page__modal-grid">
            <Form.Item name="capabilities" label={ui.capabilities} rules={[{ required: true, message: ui.capabilitiesRequired }]} className="settings-page__modal-item">
              <Checkbox.Group options={capabilityOptions} className="settings-page__capabilities-grid" />
            </Form.Item>
            <div className="settings-page__modal-stack">
              <Form.Item name="isPrimary" label={ui.primaryModel} valuePropName="checked" className="settings-page__modal-item">
                <Switch />
              </Form.Item>
              <Form.Item name="enabled" label={ui.enabledField} valuePropName="checked" className="settings-page__modal-item">
                <Switch />
              </Form.Item>
              <Form.Item name="temperature" label={ui.temperature} className="settings-page__modal-item settings-page__modal-item--full-row">
                <InputNumber min={0} max={2} step={0.1} className="settings-page__full-width" />
              </Form.Item>
              <div className="settings-page__thinking-panel">
                <div className="settings-page__thinking-header">
                  <div>
                    <div className="settings-page__thinking-title">{ui.thinkingHelpTitle}</div>
                    <div className="settings-page__thinking-desc">
                      {ui.thinkingHelpText}
                    </div>
                  </div>
                  <Form.Item name="thinkingEnabled" valuePropName="checked" noStyle>
                    <Switch />
                  </Form.Item>
                </div>
                <Form.Item noStyle shouldUpdate={(prev, next) => prev.thinkingEnabled !== next.thinkingEnabled}>
                  {({ getFieldValue }) => (
                    <Form.Item name="thinkingEffort" label={ui.thinkingEffort} className="settings-page__thinking-effort-item">
                      <Select
                        disabled={getFieldValue("thinkingEnabled") === false}
                        options={thinkingEffortOptions}
                      />
                    </Form.Item>
                  )}
                </Form.Item>
              </div>
            </div>
          </div>
          <Form.Item name="description" label={ui.description} className="settings-page__modal-item">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

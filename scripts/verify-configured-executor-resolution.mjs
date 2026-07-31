import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-configured-executor-"));
process.env.NEXO_DATA_DIR = tempRoot;

const profilesFile = path.join(tempRoot, "model-profiles.json");

const storedProfiles = [
  {
    id: "primary-profile",
    name: "Primary",
    providerId: "openai-compatible",
    providerName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    apiKey: "primary-key",
    model: "gpt-4o",
    capabilities: ["chat", "orchestration"],
    isPrimary: true,
    temperature: 0,
    thinkingEnabled: true,
    thinkingEffort: "high",
    enabled: true,
  },
  {
    id: "mini-profile",
    name: "Executor Mini",
    providerId: "openai-compatible",
    providerName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    apiKey: "mini-key",
    model: "gpt-4o-mini",
    capabilities: ["chat", "orchestration"],
    temperature: 0,
    thinkingEnabled: true,
    thinkingEffort: "high",
    enabled: true,
  },
  {
    id: "heavy-profile",
    name: "Executor Heavy",
    providerId: "openai-compatible",
    providerName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    apiKey: "heavy-key",
    model: "gpt-4.1",
    capabilities: ["chat", "orchestration"],
    temperature: 0,
    thinkingEnabled: true,
    thinkingEffort: "high",
    enabled: true,
  },
  {
    id: "disabled-profile",
    name: "Disabled Executor",
    providerId: "openai-compatible",
    providerName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    apiKey: "disabled-key",
    model: "gpt-4o-mini",
    capabilities: ["chat", "orchestration"],
    temperature: 0,
    thinkingEnabled: true,
    thinkingEffort: "high",
    enabled: false,
  },
];

fs.writeFileSync(profilesFile, JSON.stringify(storedProfiles, null, 2), "utf8");

const modelRuntimeModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/model-runtime.js")));
const { resolvePlannerExecutorRoleConfigs } = modelRuntimeModule;

const primaryConfig = {
  profileId: "primary-profile",
  name: "Primary",
  providerId: "openai-compatible",
  providerName: "OpenAI",
  apiBase: "https://api.openai.com/v1",
  apiKey: "primary-key",
  model: "gpt-4o",
  capabilities: ["chat", "orchestration"],
  temperature: 0,
  thinkingEnabled: true,
  thinkingEffort: "high",
};

function buildSettings(executorProfileId) {
  return {
    providerId: "openai-compatible",
    providerName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    apiKey: "primary-key",
    hasApiKey: true,
    model: "gpt-4o",
    temperature: 0,
    maxContextTurns: 20,
    enableContextCompaction: false,
    shellCommandTimeoutMs: 0,
    aiRequestTimeoutMs: 0,
    planningMode: "balanced",
    plannerExecutorRoutingEnabled: true,
    executorProfileId,
    thinkingEnabled: true,
    thinkingEffort: "high",
    circuitBreakerEnabled: false,
    circuitBreakerConsecutiveFailureLimit: 0,
    circuitBreakerRepeatedToolCallLimit: 0,
    circuitBreakerTokenBudget: 0,
    enableMemory: false,
    enableKnowledge: false,
    workspacePath: tempRoot,
    webHost: "127.0.0.1",
    webPort: 0,
    webPassword: "",
    channels: {
      web: false,
      desktop: false,
      feishu: false,
      dingtalk: false,
      wechat: false,
      wecom: false,
    },
  };
}

{
  const roleConfigs = await resolvePlannerExecutorRoleConfigs(buildSettings("mini-profile"), primaryConfig);
  assert.equal(roleConfigs.enabled, true);
  assert.equal(roleConfigs.executor?.profileId, "mini-profile");
  assert.equal(roleConfigs.executor?.model, "gpt-4o-mini");
  assert.equal(roleConfigs.executorSelectionReason, "configured_executor_profile");
  assert.equal(roleConfigs.usingPrimaryAsExecutor, false);
  assert.equal(roleConfigs.errors.length, 0);
}

{
  const roleConfigs = await resolvePlannerExecutorRoleConfigs(buildSettings("heavy-profile"), primaryConfig);
  assert.equal(roleConfigs.executor?.profileId, "heavy-profile");
  assert.equal(roleConfigs.executor?.model, "gpt-4.1");
  assert.equal(roleConfigs.executorSelectionReason, "configured_executor_profile");
  assert.equal(roleConfigs.errors.length, 0);
}

{
  const roleConfigs = await resolvePlannerExecutorRoleConfigs(buildSettings(""), primaryConfig);
  assert.equal(roleConfigs.executor, undefined);
  assert.equal(roleConfigs.usingPrimaryAsExecutor, false);
  assert.equal(roleConfigs.executorSelectionReason, "missing_configured_executor_profile");
  assert.match(roleConfigs.errors.join(" "), /no executor model profile is selected/i);
}

{
  const roleConfigs = await resolvePlannerExecutorRoleConfigs(buildSettings("primary-profile"), primaryConfig);
  assert.equal(roleConfigs.executor, undefined);
  assert.match(roleConfigs.errors.join(" "), /different from the primary/i);
}

{
  const roleConfigs = await resolvePlannerExecutorRoleConfigs(buildSettings("disabled-profile"), primaryConfig);
  assert.equal(roleConfigs.executor, undefined);
  assert.match(roleConfigs.errors.join(" "), /disabled/i);
}

console.log("configured executor resolution verification passed");
process.exit(0);

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repoRoot, "dist-electron", "electron", "server");

const tokenBudgetModule = await import(pathToFileURL(path.join(distRoot, "token-budget.js")));
const modelContextModule = await import(pathToFileURL(path.join(distRoot, "model-context.js")));
const settingsModule = await import(pathToFileURL(path.join(distRoot, "settings.js")));
const configModule = await import(pathToFileURL(path.join(distRoot, "config.js")));
const conversationContextModule = await import(pathToFileURL(path.join(distRoot, "conversation-context.js")));

const {
  estimateTokens,
  computePromptBudget,
  truncateTextToTokenBudget,
} = tokenBudgetModule;
const {
  findDictionaryBudget,
  inferBudgetFromModelNameHint,
  resolveStoredModelContextBudget,
  upsertStoredModelContextCacheEntry,
  getStoredModelContextCacheEntry,
} = modelContextModule;
const { DEFAULT_AGENT_SETTINGS } = settingsModule;
const { MODEL_CONTEXT_CACHE_FILE } = configModule;
const { buildBudgetAwareConversationContext } = conversationContextModule;

async function cleanupCache() {
  await fs.rm(MODEL_CONTEXT_CACHE_FILE, { force: true }).catch(() => {});
}

await cleanupCache();

{
  const mixed = "你好hello123";
  const tokens = estimateTokens(mixed);
  assert.ok(tokens >= 4 && tokens <= 8, `unexpected mixed token estimate: ${tokens}`);
}

{
  const budget = computePromptBudget(DEFAULT_AGENT_SETTINGS, {
    contextWindowTokens: 200_000,
    reservedOutputTokens: 10_000,
    autoCompactTokenLimit: 120_000,
    compactionTargetRatio: 0.5,
  }, 2_000);
  assert.equal(budget.contextWindowTokens, 200_000);
  assert.equal(budget.reservedOutputTokens, 10_000);
  assert.equal(budget.autoCompactTokenLimit, 120_000);
  assert.equal(budget.compactionTargetTokens, 94_000);
}

{
  const dictionary = findDictionaryBudget("gpt-4.1");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 1_000_000);
  assert.equal(dictionary?.contextWindowSource, "dictionary");
}

{
  const dictionary = findDictionaryBudget("deepseek-v4-pro");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 1_000_000);
  assert.equal(dictionary?.contextWindowSource, "dictionary");
}

{
  const dictionary = findDictionaryBudget("gpt-5-codex");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 400_000);
}

{
  const futureModel = findDictionaryBudget("gpt-5.6-luna");
  assert.equal(futureModel, null);
  const resolved = await resolveStoredModelContextBudget({
    profile: { providerId: "openai-compatible", model: "gpt-5.6-luna" },
  });
  assert.equal(resolved.contextWindowTokens, 256_000);
  assert.equal(resolved.reservedOutputTokens, 24_576);
  assert.equal(resolved.autoCompactTokenLimit, 180_000);
  assert.equal(resolved.contextWindowSource, "default");
}

{
  const resolved = await resolveStoredModelContextBudget({
    profile: { providerId: "openai-compatible", model: "gpt-5.6-sol" },
    settings: {
      model: "gpt-5.6-sol",
      contextWindowTokens: 400_000,
      reservedOutputTokens: 32_768,
      autoCompactTokenLimit: 280_000,
      contextWindowSource: "default",
    },
  });
  assert.equal(resolved.contextWindowTokens, 256_000);
  assert.equal(resolved.reservedOutputTokens, 24_576);
  assert.equal(resolved.autoCompactTokenLimit, 180_000);
}

{
  const resolved = await resolveStoredModelContextBudget({
    profile: {
      providerId: "openai-compatible",
      model: "gpt-5.6-sol",
      contextWindowTokens: 320_000,
      reservedOutputTokens: 20_000,
      autoCompactTokenLimit: 210_000,
      contextWindowSource: "user",
    },
  });
  assert.equal(resolved.contextWindowTokens, 320_000);
  assert.equal(resolved.reservedOutputTokens, 20_000);
  assert.equal(resolved.autoCompactTokenLimit, 210_000);
  assert.equal(resolved.contextWindowSource, "user");
}

{
  const dictionary = findDictionaryBudget("llama-4-scout");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 10_000_000);
}

{
  const hint = inferBudgetFromModelNameHint("my-proxy-model-256k");
  assert.ok(hint);
  assert.equal(hint?.contextWindowTokens, 256_000);
  assert.equal(hint?.contextWindowSource, "dictionary");
}

{
  const hint = inferBudgetFromModelNameHint("openrouter/custom-1m-preview");
  assert.ok(hint);
  assert.equal(hint?.contextWindowTokens, 1_000_000);
}

{
  await upsertStoredModelContextCacheEntry({
    key: "openai-compatible::custom-model-x",
    model: "custom-model-x",
    providerId: "openai-compatible",
    contextWindowTokens: 65432,
    reservedOutputTokens: 4096,
    contextWindowSource: "provider",
    contextWindowSourceDetail: "test-provider-cache",
    contextWindowResolvedAt: new Date().toISOString(),
  });
  const cached = await getStoredModelContextCacheEntry("openai-compatible", "custom-model-x");
  assert.equal(cached?.contextWindowTokens, 65432);
  const resolved = await resolveStoredModelContextBudget({
    profile: { providerId: "openai-compatible", model: "custom-model-x" },
  });
  assert.equal(resolved.contextWindowTokens, 65432);
}

{
  await upsertStoredModelContextCacheEntry({
    key: "openai-compatible::unknown-fallback",
    model: "unknown-fallback",
    providerId: "openai-compatible",
    contextWindowTokens: 400000,
    reservedOutputTokens: 32768,
    autoCompactTokenLimit: 280000,
    contextWindowSource: "lookup",
    contextWindowSourceDetail: "legacy-model-guessed-budget",
    contextWindowResolvedAt: new Date().toISOString(),
  });
  const cached = await getStoredModelContextCacheEntry("openai-compatible", "unknown-fallback");
  assert.equal(cached, null);
  const rawCache = JSON.parse(await fs.readFile(MODEL_CONTEXT_CACHE_FILE, "utf8").catch(() => "[]"));
  assert.equal(rawCache.some((entry) => entry?.model === "unknown-fallback"), false);
}

{
  await upsertStoredModelContextCacheEntry({
    key: "openai-compatible::gpt-5.6-luna",
    model: "gpt-5.6-luna",
    providerId: "openai-compatible",
    contextWindowTokens: 400000,
    reservedOutputTokens: 32768,
    autoCompactTokenLimit: 280000,
    contextWindowSource: "dictionary",
    contextWindowSourceDetail: "OpenAI GPT-5 family",
    contextWindowResolvedAt: new Date().toISOString(),
  });
  const cached = await getStoredModelContextCacheEntry("openai-compatible", "gpt-5.6-luna");
  assert.equal(cached, null);
  const resolved = await resolveStoredModelContextBudget({
    profile: { providerId: "openai-compatible", model: "gpt-5.6-luna" },
  });
  assert.equal(resolved.contextWindowTokens, 256_000);
}

{
  await upsertStoredModelContextCacheEntry({
    key: "openai-compatible::default-fallback",
    model: "default-fallback",
    providerId: "openai-compatible",
    contextWindowTokens: 256000,
    reservedOutputTokens: 24576,
    contextWindowSource: "default",
    contextWindowSourceDetail: "unknown-model-default-256k",
    contextWindowResolvedAt: new Date().toISOString(),
  });
  const cached = await getStoredModelContextCacheEntry("openai-compatible", "default-fallback");
  assert.equal(cached, null);
  const rawCache = JSON.parse(await fs.readFile(MODEL_CONTEXT_CACHE_FILE, "utf8").catch(() => "[]"));
  assert.equal(rawCache.some((entry) => entry?.model === "default-fallback"), false);
}

{
  const metadataResolved = await resolveStoredModelContextBudget({
    discoveredModel: {
      id: "provider-metadata-model",
      metadata: { context_window: 32000, max_output_tokens: 4096 },
    },
    settings: { providerId: "openai-compatible", model: "provider-metadata-model" },
  });
  assert.equal(metadataResolved.contextWindowTokens, 32000);
  assert.equal(metadataResolved.contextWindowSource, "provider");
}

{
  const hintedResolved = await resolveStoredModelContextBudget({
    profile: { providerId: "openai-compatible", model: "vendor/custom-context-512k" },
  });
  assert.equal(hintedResolved.contextWindowTokens, 512_000);
  assert.equal(hintedResolved.contextWindowSource, "dictionary");
}

{
  const longText = "abc ".repeat(3000);
  const truncated = truncateTextToTokenBudget(longText, 300);
  assert.ok(estimateTokens(truncated) <= 300);
}

{
  const now = new Date().toISOString();
  const message = (index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `short message ${index}`,
    createdAt: now,
  });
  const session = {
    id: "no-message-count-compaction",
    title: "No message count compaction",
    messages: Array.from({ length: 12 }, (_, index) => message(index + 1)),
    createdAt: now,
    updatedAt: now,
  };
  const settings = {
    ...DEFAULT_AGENT_SETTINGS,
    enableContextCompaction: true,
    maxContextTurns: 3,
  };
  const budget = computePromptBudget(settings, {
    contextWindowTokens: 128_000,
    reservedOutputTokens: 8_192,
    autoCompactTokenLimit: 96_000,
    compactionTargetRatio: 0.6,
  }, 2_000);
  const summarizedTranscripts = [];
  const summarize = async (transcript) => {
    summarizedTranscripts.push(transcript);
    return `summary-${summarizedTranscripts.length}`;
  };

  const firstContext = await buildBudgetAwareConversationContext(settings, session, summarize, [], budget);
  assert.equal(firstContext.compacted, false);
  assert.equal(firstContext.recentRawMessages.length, 12);
  assert.equal(session.threadSummary, undefined);
  assert.equal(summarizedTranscripts.length, 0);
}

{
  const now = new Date().toISOString();
  const message = (index) => ({
    id: `large-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `large message ${index}\n${"abc ".repeat(3000)}`,
    createdAt: now,
  });
  const session = {
    id: "token-budget-compaction",
    title: "Token budget compaction",
    messages: Array.from({ length: 6 }, (_, index) => message(index + 1)),
    createdAt: now,
    updatedAt: now,
  };
  const settings = {
    ...DEFAULT_AGENT_SETTINGS,
    enableContextCompaction: true,
    maxContextTurns: 3,
  };
  const budget = computePromptBudget(settings, {
    contextWindowTokens: 8_192,
    reservedOutputTokens: 512,
    autoCompactTokenLimit: 1_200,
    compactionTargetRatio: 0.5,
  }, 256);
  const summarizedTranscripts = [];
  const summarize = async (transcript) => {
    summarizedTranscripts.push(transcript);
    return `summary-${summarizedTranscripts.length}`;
  };

  const firstContext = await buildBudgetAwareConversationContext(settings, session, summarize, [], budget);
  assert.equal(firstContext.compacted, true);
  assert.ok(firstContext.recentRawMessages.length <= 3);
  assert.ok(session.threadSummary?.includes("summary-1"));
  assert.ok((session.threadSummaryMessageCount ?? 0) > 0);
  assert.ok(summarizedTranscripts.length >= 1);

  const summarizedCount = summarizedTranscripts.length;
  const secondContext = await buildBudgetAwareConversationContext(settings, session, summarize, [], budget);
  assert.equal(secondContext.compacted, false);
  assert.equal(summarizedTranscripts.length, summarizedCount);
}

await cleanupCache();
console.log("context management verification passed");

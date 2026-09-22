import assert from "node:assert/strict";
import { isContextWindowArchiveMetadata, normalizeContextWindowTokens } from "../src/shared/context-window";
import { buildBudgetAwareConversationContext, type ContextArchiveChunk } from "../electron/server/conversation-context";
import { computePromptBudget, estimateMessageTokens } from "../electron/server/token-budget";
import type { AgentSettings, ChatMessage } from "../src/shared/types";
import type { Session } from "../electron/server/types";

function message(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-09-22T00:00:00.000Z" };
}

function session(id: string, messages: ChatMessage[], extra: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    messages,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    ...extra,
  };
}

function budget(contextWindowTokens: number) {
  return {
    contextWindowTokens,
    reservedOutputTokens: 0,
    toolSchemaReserveTokens: 0,
    autoCompactTokenLimit: contextWindowTokens,
    compactionTargetTokens: contextWindowTokens,
    maxInputTokens: contextWindowTokens,
  };
}

const settings = { contextWindowTokens: 256_000, autoCompactTokenLimit: 1_000, compactionTargetRatio: 0.2 } as AgentSettings;

const normalizedFromDictionary = computePromptBudget(settings, { contextWindowTokens: 1_000_000, autoCompactTokenLimit: 50 });
assert.equal(normalizedFromDictionary.contextWindowTokens, 256_000);
assert.equal(normalizedFromDictionary.maxInputTokens, 256_000);
assert.equal(computePromptBudget({ ...settings, contextWindowTokens: 500_000 }, { contextWindowTokens: 128_000 }).contextWindowTokens, 500_000);
assert.equal(computePromptBudget(settings, { contextWindowTokens: 500_000 }).contextWindowTokens, 500_000);
assert.equal(normalizeContextWindowTokens(128_000), 256_000);

async function main() {
const small = message("small", "hello");
const under = await buildBudgetAwareConversationContext(session("under", [small]), async () => {
  throw new Error("should not archive");
}, [], budget(10_000));
assert.equal(under.archiveFailed, false);
assert.equal(under.recentRawMessages.length, 1);
assert.equal(under.archivedMessageCount, 0);

const marker = "UNIQUE_ARCHIVE_MARKER_persistent_fact";
const older = message("older", `${marker} ${"alpha ".repeat(80)}`);
const latest = message("latest", "please continue");
const durable: ContextArchiveChunk[] = [];
const original = session("origin", [older, latest]);
const archived = await buildBudgetAwareConversationContext(original, async (chunk) => {
  durable.push(chunk);
  return true;
}, [], budget(estimateMessageTokens(latest) + 8));
assert.equal(archived.archiveFailed, false);
assert.equal(archived.recentRawMessages.length, 1);
assert.equal(archived.recentRawMessages[0]?.id, "latest");
assert.equal(original.messages.length, 2);
assert.ok(durable.some((chunk) => chunk.content.includes(marker)));
assert.equal(durable[0]?.sessionId, "origin");
assert.equal(durable[0]?.startIndex, 0);

const restartedQuery = marker;
const recalled = durable.filter((chunk) => chunk.content.includes(restartedQuery));
assert.equal(recalled.length, 1);
assert.equal(isContextWindowArchiveMetadata({ source: "context_window_archive" }), true);
assert.equal(isContextWindowArchiveMetadata({ source: "extracted_fact" }), false);

const alone = message("alone", `${"beta ".repeat(200)}`);
const aloneSession = session("alone", [alone]);
let aloneWrites = 0;
const overflow = await buildBudgetAwareConversationContext(aloneSession, async () => {
  aloneWrites += 1;
  return true;
}, [], budget(20));
assert.equal(aloneWrites, 0);
assert.equal(overflow.recentRawMessages.length, 1);
assert.ok(overflow.estimatedPromptTokens >= 20);
assert.equal(aloneSession.archivedMessageCount ?? 0, 0);

const failed = session("failed", [older, latest]);
const failedResult = await buildBudgetAwareConversationContext(failed, async () => false, [], budget(estimateMessageTokens(latest) + 8));
assert.equal(failedResult.archiveFailed, true);
assert.equal(failed.archivedMessageCount ?? 0, 0);
assert.equal(failedResult.recentRawMessages.length, 2);

console.log("context window archive checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

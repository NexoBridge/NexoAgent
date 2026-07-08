import type { AgentSettings, ChatMessage } from "../../src/shared/types";
import type { Session } from "./types";
import {
  estimateMessagesTokens,
  estimateSectionTokens,
  estimateTokens,
  truncateTextToTokenBudget,
} from "./token-budget";
import type { computePromptBudget } from "./token-budget";

function normalizePositiveInteger(value: number | undefined, fallback: number, min = 1) {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) ? Math.max(min, normalized) : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, max: number) {
  const normalized = Math.floor(Number(value));
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(max, normalized));
}

function trimForPrompt(text: string, maxChars: number) {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean;
  const half = Math.floor((maxChars - 32) / 2);
  return `${clean.slice(0, half)}\n...[truncated]...\n${clean.slice(-half)}`;
}

function formatMessageForCompaction(message: ChatMessage, index: number) {
  const role = message.role === "assistant" ? "Assistant" : "User";
  const attachmentText = message.attachments?.length
    ? `\nAttachments: ${message.attachments.map((attachment) => `${attachment.name} (${attachment.type}, ${attachment.url})`).join("; ")}`
    : "";
  return `#${index + 1} ${role} at ${message.createdAt}\n${trimForPrompt(message.content, 2400)}${attachmentText}`;
}

export function buildCompactionTranscript(messages: ChatMessage[], maxChars = 28_000) {
  const entries = messages.map(formatMessageForCompaction);
  const selected: string[] = [];
  let used = 0;

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    const nextUsed = used + entry.length + 2;
    if (selected.length > 0 && nextUsed > maxChars) break;
    selected.unshift(entry);
    used = nextUsed;
  }

  if (selected.length < entries.length) {
    selected.unshift(`[${entries.length - selected.length} earlier message(s) were omitted before compaction because the transcript was very large.]`);
  }

  return selected.join("\n\n");
}

export function formatCurrentSessionContextForRecall(session: Session, maxChars = 28_000) {
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const transcript = buildCompactionTranscript(conversationMessages, maxChars);
  return [
    session.threadSummary?.trim()
      ? `Compressed earlier current-session context:\n${session.threadSummary.trim()}`
      : "",
    transcript
      ? `Current-session transcript:\n${transcript}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function fallbackCompactMessages(messages: ChatMessage[]) {
  const transcript = buildCompactionTranscript(messages, 7000);
  return [
    "Automatic summary of earlier conversation:",
    trimForPrompt(transcript, 4000),
  ].join("\n");
}

async function compactOlderMessages(messages: ChatMessage[], summarize: (transcript: string) => Promise<string>) {
  if (messages.length === 0) return "";

  try {
    const transcript = buildCompactionTranscript(messages);
    const content = await summarize(transcript);
    return content || fallbackCompactMessages(messages);
  } catch {
    return fallbackCompactMessages(messages);
  }
}

export async function buildBudgetAwareConversationContext(
  settings: AgentSettings,
  session: Session,
  summarize: (transcript: string) => Promise<string>,
  baseSections: Array<{ key: string; label: string; content: string }>,
  budgetConfig: ReturnType<typeof computePromptBudget>
) {
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const recentWindow = normalizePositiveInteger(settings.maxContextTurns, 12);
  const originalThreadSummary = session.threadSummary?.trim() ?? "";
  const originalSummaryMessageCount = session.threadSummaryMessageCount;
  let threadSummary = originalThreadSummary;
  let summarizedMessageCount = settings.enableContextCompaction
    ? normalizeNonNegativeInteger(session.threadSummaryMessageCount, conversationMessages.length)
    : 0;
  if (settings.enableContextCompaction && threadSummary && session.threadSummaryMessageCount === undefined) {
    summarizedMessageCount = Math.max(0, conversationMessages.length - recentWindow);
  }
  if (!threadSummary) {
    summarizedMessageCount = 0;
  }
  let recentMessages = conversationMessages.slice(summarizedMessageCount);
  let compacted = false;
  let passes = 0;

  const estimateBase = () => baseSections.reduce((sum, section) => sum + estimateSectionTokens(section.label, section.content), 0);
  const estimateSummary = () => estimateSectionTokens("Earlier conversation summary", threadSummary);
  const estimateRecent = () => estimateMessagesTokens(recentMessages);
  const estimateTotal = () => estimateBase() + estimateSummary() + estimateRecent();
  const shouldCompactByTokens = () => estimateTotal() >= budgetConfig.autoCompactTokenLimit;

  while (
    settings.enableContextCompaction
    && shouldCompactByTokens()
    && passes < 4
  ) {
    const targetRawTurns = Math.max(2, Math.min(recentWindow, Math.floor(recentMessages.length / 2)));
    const summaryInput = recentMessages.slice(0, Math.max(0, recentMessages.length - targetRawTurns));
    if (!summaryInput.length) break;

    const nextSummary = await compactOlderMessages(summaryInput, summarize);
    threadSummary = [threadSummary, nextSummary].filter(Boolean).join("\n\n");
    summarizedMessageCount += summaryInput.length;
    compacted = true;
    passes += 1;
    recentMessages = recentMessages.slice(summaryInput.length);

    while (estimateTotal() > budgetConfig.compactionTargetTokens && recentMessages.length > 2) {
      const shifted = recentMessages.shift();
      if (!shifted) break;
      const fragment = await compactOlderMessages([shifted], summarize);
      threadSummary = [threadSummary, fragment].filter(Boolean).join("\n\n");
      summarizedMessageCount += 1;
      compacted = true;
    }

    if (estimateTokens(threadSummary) > Math.max(512, Math.floor(budgetConfig.maxInputTokens * 0.35))) {
      threadSummary = truncateTextToTokenBudget(threadSummary, Math.max(512, Math.floor(budgetConfig.maxInputTokens * 0.3)));
    }
  }

  if (threadSummary && estimateTotal() > budgetConfig.maxInputTokens) {
    threadSummary = truncateTextToTokenBudget(threadSummary, Math.max(384, Math.floor(budgetConfig.compactionTargetTokens * 0.35)));
  }

  session.threadSummary = threadSummary || undefined;
  if (threadSummary) {
    if (settings.enableContextCompaction) {
      session.threadSummaryMessageCount = summarizedMessageCount;
    }
    const summaryChanged = threadSummary !== originalThreadSummary;
    const countChanged = session.threadSummaryMessageCount !== originalSummaryMessageCount;
    if (summaryChanged || countChanged || compacted) {
      session.threadSummaryUpdatedAt = new Date().toISOString();
      session.threadSummaryVersion = (session.threadSummaryVersion ?? 0) + (compacted ? 1 : 0);
    }
  } else if (session.threadSummaryMessageCount !== undefined) {
    session.threadSummaryMessageCount = undefined;
  }

  return {
    compactedSummary: threadSummary,
    estimatedPromptTokens: estimateTotal(),
    compacted,
    recentRawMessages: recentMessages,
  };
}

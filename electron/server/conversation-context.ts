import type { AgentSettings, ChatMessage } from "../../src/shared/types";
import type { Session } from "./types";
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateSectionTokens,
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

function normalizeForPrompt(text: string) {
  return text.replace(/\s+\n/g, "\n").trim();
}

function formatMessageForCompaction(message: ChatMessage, index: number) {
  const role = message.role === "assistant" ? "Assistant" : "User";
  const attachmentText = message.attachments?.length
    ? `\nAttachments: ${message.attachments.map((attachment) => `${attachment.name} (${attachment.type}, ${attachment.url})`).join("; ")}`
    : "";
  return `#${index + 1} ${role} at ${message.createdAt}\n${normalizeForPrompt(message.content)}${attachmentText}`;
}

export function buildCompactionTranscript(messages: ChatMessage[]) {
  return messages.map(formatMessageForCompaction).join("\n\n");
}

export function formatCurrentSessionContextForRecall(session: Session) {
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const transcript = buildCompactionTranscript(conversationMessages);
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
  const transcript = buildCompactionTranscript(messages);
  return [
    "Automatic context compaction summary could not be generated. Full earlier conversation transcript follows:",
    transcript,
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
  const initialSummarizedMessageCount = summarizedMessageCount;

  const estimateBase = () => baseSections.reduce((sum, section) => sum + estimateSectionTokens(section.label, section.content), 0);
  const estimateSummary = () => estimateSectionTokens("Earlier conversation summary", threadSummary);
  const estimateRecent = () => estimateMessagesTokens(recentMessages);
  const estimateTotal = () => estimateBase() + estimateSummary() + estimateRecent();
  const shouldCompactByTokens = () => estimateTotal() >= budgetConfig.autoCompactTokenLimit;
  const originalEstimatedPromptTokens = estimateTotal();

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
    originalEstimatedPromptTokens,
    compacted,
    compactedMessageCount: Math.max(0, summarizedMessageCount - initialSummarizedMessageCount),
    compactionPasses: passes,
    summaryMessageCount: summarizedMessageCount,
    recentRawMessageCount: recentMessages.length,
    latestRawMessageTokens: conversationMessages.length
      ? estimateMessageTokens(conversationMessages[conversationMessages.length - 1])
      : 0,
    latestRawMessageChars: conversationMessages.length
      ? conversationMessages[conversationMessages.length - 1].content.length
      : 0,
    recentRawMessages: recentMessages,
  };
}

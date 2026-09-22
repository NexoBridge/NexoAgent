import type { ChatMessage } from "../../src/shared/types";
import type { Session } from "./types";
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateSectionTokens,
} from "./token-budget";
import type { computePromptBudget } from "./token-budget";

export const CONTEXT_ARCHIVE_CHUNK_TOKENS = 1_500;

export interface ContextArchiveChunk {
  content: string;
  sessionId: string;
  startIndex: number;
  endIndex: number;
  legacyThreadSummary?: boolean;
}

export type ArchiveContextChunk = (chunk: ContextArchiveChunk) => Promise<boolean>;

function normalizeForPrompt(text: string) {
  return text.replace(/\s+\n/g, "\n").trim();
}

function formatMessageForArchive(message: ChatMessage, index: number) {
  const role = message.role === "assistant" ? "Assistant" : "User";
  const attachmentText = message.attachments?.length
    ? `\nAttachments: ${message.attachments.map((attachment) => `${attachment.name} (${attachment.type}, ${attachment.url})`).join("; ")}`
    : "";
  return `#${index + 1} ${role} at ${message.createdAt}\n${normalizeForPrompt(message.content)}${attachmentText}`;
}

export function buildConversationTranscript(messages: ChatMessage[]) {
  return messages.map(formatMessageForArchive).join("\n\n");
}

export function formatCurrentSessionContextForRecall(session: Session) {
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const transcript = buildConversationTranscript(conversationMessages);
  return transcript ? `Current-session transcript:\n${transcript}` : "";
}

function clampCursor(value: number | undefined, length: number) {
  const normalized = Math.floor(Number(value));
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(length, normalized));
}

export async function buildBudgetAwareConversationContext(
  session: Session,
  archiveChunk: ArchiveContextChunk,
  baseSections: Array<{ key: string; label: string; content: string }>,
  budgetConfig: ReturnType<typeof computePromptBudget>,
) {
  const windowTokens = budgetConfig.contextWindowTokens;
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const legacySummary = session.threadSummary?.trim() ?? "";
  const initialCursor = clampCursor(session.archivedMessageCount, conversationMessages.length);
  const estimateBase = () => baseSections.reduce((sum, section) => sum + estimateSectionTokens(section.label, section.content), 0);
  const originalEstimatedPromptTokens = estimateBase()
    + estimateSectionTokens("Earlier conversation summary", legacySummary)
    + estimateMessagesTokens(conversationMessages.slice(initialCursor));

  let archiveFailed = false;
  if (legacySummary) {
    const stored = await archiveChunk({
      content: legacySummary,
      sessionId: session.id,
      startIndex: -1,
      endIndex: -1,
      legacyThreadSummary: true,
    });
    if (!stored) {
      archiveFailed = true;
    } else {
      session.threadSummary = undefined;
      session.threadSummaryMessageCount = undefined;
      session.threadSummaryUpdatedAt = undefined;
      session.threadSummaryVersion = undefined;
    }
  }

  let cursor = initialCursor;
  const liveMessages = () => conversationMessages.slice(cursor);
  const estimateLive = () => estimateBase() + estimateMessagesTokens(liveMessages());
  let archivedThisPass = 0;

  if (!archiveFailed) {
    while (estimateLive() >= windowTokens && liveMessages().length > 1) {
      const available = liveMessages();
      const chunk: ChatMessage[] = [];
      let chunkTokens = 0;
      for (let index = 0; index < available.length - 1; index += 1) {
        const nextTokens = estimateMessageTokens(available[index]);
        if (chunk.length > 0 && chunkTokens + nextTokens > CONTEXT_ARCHIVE_CHUNK_TOKENS) break;
        chunk.push(available[index]);
        chunkTokens += nextTokens;
        const remaining = available.slice(index + 1);
        if (estimateBase() + estimateMessagesTokens(remaining) < windowTokens) break;
      }
      if (!chunk.length) break;

      const startIndex = cursor;
      const endIndex = cursor + chunk.length - 1;
      const stored = await archiveChunk({
        content: buildConversationTranscript(chunk),
        sessionId: session.id,
        startIndex,
        endIndex,
      });
      if (!stored) {
        archiveFailed = true;
        break;
      }
      cursor += chunk.length;
      session.archivedMessageCount = cursor;
      archivedThisPass += chunk.length;
    }
  }

  const recentMessages = liveMessages();
  const latest = conversationMessages.length
    ? conversationMessages[conversationMessages.length - 1]
    : undefined;

  return {
    compactedSummary: "",
    estimatedPromptTokens: estimateLive(),
    originalEstimatedPromptTokens,
    compacted: false,
    archived: archivedThisPass > 0 || Boolean(legacySummary && !archiveFailed && !session.threadSummary),
    archiveFailed,
    archivedMessageCount: cursor,
    compactedMessageCount: archivedThisPass,
    compactionPasses: 0,
    summaryMessageCount: cursor,
    recentRawMessageCount: recentMessages.length,
    latestRawMessageTokens: latest ? estimateMessageTokens(latest) : 0,
    latestRawMessageChars: latest ? latest.content.length : 0,
    recentRawMessages: recentMessages,
  };
}

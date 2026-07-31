import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatCompletionMessage, ChatContentPart } from "./model-runtime";

function contentToText(content: string | ChatContentPart[] | BaseMessage["content"]) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .join("")
    .trim();
}

export function normalizeChatCompletionMessages(messages: ChatCompletionMessage[]) {
  const normalizedMessages: ChatCompletionMessage[] = [];
  let hasLeadingSystem = false;

  for (const message of messages) {
    if (message.role === "system") {
      const text = contentToText(message.content);
      if (!text) continue;
      if (!hasLeadingSystem && normalizedMessages.length === 0) {
        normalizedMessages.push(message);
        hasLeadingSystem = true;
      } else {
        normalizedMessages.push({ role: "user", content: formatLateSystemContext(text) });
      }
      continue;
    }
    normalizedMessages.push(message);
  }

  return normalizedMessages;
}

export function normalizeBaseMessagesForStrictChatTransports(messages: BaseMessage[]) {
  const normalizedMessages: BaseMessage[] = [];
  let hasLeadingSystem = false;

  for (const message of messages) {
    if (message._getType() === "system") {
      const text = contentToText(message.content);
      if (!text) continue;
      if (!hasLeadingSystem && normalizedMessages.length === 0) {
        normalizedMessages.push(message);
        hasLeadingSystem = true;
      } else {
        normalizedMessages.push(new HumanMessage(formatLateSystemContext(text)));
      }
      continue;
    }
    normalizedMessages.push(message);
  }

  return normalizedMessages;
}

function formatLateSystemContext(content: string) {
  // Keep the first system message stable for OpenAI prompt-cache prefix reuse.
  return [
    "Application-provided context originally attached as a system message.",
    "Treat it as instruction/context, but it is placed here to satisfy provider message-order rules.",
    "",
    content,
  ].join("\n");
}

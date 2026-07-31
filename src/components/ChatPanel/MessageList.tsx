import React, { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { useChatStore } from "../../store/chat";
import { useI18n } from "../../i18n";
import "./MessageList.scss";

interface Props {
  onSuggest: (text: string) => void;
  hasInput: boolean;
  emptyState?: React.ReactNode;
  onOpenKnowledgeSource?: (path: string) => void;
}

const STREAM_SCROLL_THROTTLE_MS = 90;

export const MessageList: React.FC<Props> = ({ onSuggest, hasInput, emptyState, onOpenKnowledgeSource }) => {
  const { messages, streaming, toolCalls, messageBlocks, undoableMessageIds, undoAssistantMessage } = useChatStore();
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollAtRef = useRef(0);

  useEffect(() => {
    const scrollToBottom = () => {
      scrollTimerRef.current = null;
      lastScrollAtRef.current = Date.now();
      const container = containerRef.current;
      if (!container) return;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: streaming ? "auto" : "smooth",
      });
    };

    if (!streaming) {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
      scrollToBottom();
      return;
    }

    const elapsed = Date.now() - lastScrollAtRef.current;
    if (elapsed >= STREAM_SCROLL_THROTTLE_MS) {
      scrollToBottom();
      return;
    }

    if (!scrollTimerRef.current) {
      scrollTimerRef.current = setTimeout(scrollToBottom, STREAM_SCROLL_THROTTLE_MS - elapsed);
    }
  }, [messages, streaming, toolCalls, messageBlocks]);

  useEffect(() => () => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
  }, []);

  if (messages.length === 0) {
    if (emptyState) {
      return <div className="message-list">{emptyState}</div>;
    }
    return (
      <div className="message-list message-list__empty">
        <div className="message-list__empty-center">
          <div className="message-list__empty-icon">✦</div>
          <div className="message-list__empty-title">{t("startConversation")}</div>
          <div className="message-list__empty-subtitle">{t("typeMessage")}</div>
        </div>
        {!hasInput ? (
          <div className="message-list__suggestions">
            {[t("suggestion1"), t("suggestion2"), t("suggestion3"), t("suggestion4")].map((text) => (
              <div
                key={text}
                onClick={() => onSuggest(text)}
                className="message-list__suggestion"
              >
                {text}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="message-list message-list__scroll">
      {messages.map((message, index) => {
        const undoable = undoableMessageIds.has(message.id);
        return (
        <MessageBubble
          key={message.id}
          message={message}
          attachments={message.attachments}
          streaming={streaming && index === messages.length - 1 && message.role === "assistant"}
          toolCalls={toolCalls[message.id]}
          blocks={messageBlocks[message.id]}
          undoable={undoable}
          onUndo={undoable ? () => undoAssistantMessage(message.id) : undefined}
          onOpenKnowledgeSource={onOpenKnowledgeSource}
        />)}
      )}
      <div ref={bottomRef} />
    </div>
  );
};

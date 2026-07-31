import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Avatar, Button, Modal, Popconfirm, Tag, Tooltip } from "antd";
import { BookOutlined, DownOutlined, DownloadOutlined, FileOutlined, RightOutlined, RobotOutlined, SoundOutlined, UndoOutlined, UserOutlined } from "@ant-design/icons";
import type { Attachment, ChatMessage, KnowledgeSourceHit, KnowledgeSourceMethod, ModelRoutingMetadata } from "../../shared/types";
import { ToolCallItem } from "./ToolCallSteps";
import type { ToolCallEvent } from "./ToolCallSteps";
import type { MessageBlock } from "../../store/chat";
import { getApiBase } from "../../services/api";
import { useI18n } from "../../i18n";
import "highlight.js/styles/github-dark.css";
import "./MessageBubble.scss";

interface Props {
  message: ChatMessage;
  streaming?: boolean;
  toolCalls?: ToolCallEvent[];
  blocks?: MessageBlock[];
  attachments?: ChatMessage["attachments"];
  undoable?: boolean;
  onUndo?: () => void;
  onOpenKnowledgeSource?: (path: string) => void;
}

const STREAM_CURSOR = "|";
const DSML_TAG_PATTERN = String.raw`(?:\|\|DSML\|\||\uFF5C\uFF5CDSML\uFF5C\uFF5C|锝滐綔DSML锝滐綔|閿濇粣缍擠SML閿濇粣缍攟闁挎繃绮ｇ紞鎿燬ML闁挎繃绮ｇ紞?)`;
const DSML_TOOL_BLOCK_RE = new RegExp(String.raw`<\s*${DSML_TAG_PATTERN}tool_calls\s*>[\s\S]*?<\/\s*${DSML_TAG_PATTERN}tool_calls\s*>`, "g");
const DSML_TOOL_START_RE = new RegExp(String.raw`<\s*${DSML_TAG_PATTERN}tool_calls\s*>`);
const DSML_ANY_TAG_RE = new RegExp(String.raw`<\/?\s*${DSML_TAG_PATTERN}(?:tool_calls|invoke|parameter)\b[^>]*>`, "g");

function stripDsmlArtifacts(content: string) {
  let visibleText = content;
  visibleText = visibleText.replace(DSML_TOOL_BLOCK_RE, "");
  const danglingStart = visibleText.search(DSML_TOOL_START_RE);
  if (danglingStart >= 0) {
    visibleText = visibleText.slice(0, danglingStart);
  }
  return visibleText.replace(DSML_ANY_TAG_RE, "");
}

function buildMarkdownComponents() {
  return {
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="message-bubble__markdown-pre">{children}</pre>
    ),
    code: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      className ? (
        <code className={className}>{children}</code>
      ) : (
        <code className="message-bubble__markdown-inline-code">{children}</code>
      ),
    p: ({ children }: { children?: React.ReactNode }) => <p className="message-bubble__markdown-p">{children}</p>,
  };
}

const MarkdownText: React.FC<{ content: string; streaming?: boolean }> = ({ content, streaming }) => {
  const components = useMemo(() => buildMarkdownComponents(), []);
  return streaming ? (
    <span className="message-bubble__stream-text">
      {content}
      <span className="message-bubble__stream-cursor">{STREAM_CURSOR}</span>
    </span>
  ) : (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
      {content}
    </ReactMarkdown>
  );
};

const NoticeBlock: React.FC<{ content: string; tone?: "info" | "warning" | "error" }> = ({ content, tone = "info" }) => {
  const toneClass = tone === "error" ? "message-bubble__notice--error" : tone === "warning" ? "message-bubble__notice--warning" : "";
  return (
    <div className={`message-bubble__notice ${toneClass}`.trim()}>
      <MarkdownText content={content} />
    </div>
  );
};

function formatKnowledgeMethod(method: KnowledgeSourceMethod, t: ReturnType<typeof useI18n>["t"]) {
  switch (method) {
    case "semantic":
      return t("knowledgeMethodSemantic");
    case "keyword+semantic":
      return t("knowledgeMethodBoth");
    case "keyword":
    default:
      return t("knowledgeMethodKeyword");
  }
}

function formatKnowledgeChunk(source: KnowledgeSourceHit, t: ReturnType<typeof useI18n>["t"]) {
  if (!source.chunkCount) return "";
  return t("knowledgeChunk", {
    index: (source.chunkIndex ?? 0) + 1,
    count: source.chunkCount,
  });
}

const KnowledgeSourcesBlock: React.FC<{
  sources: KnowledgeSourceHit[];
  t: ReturnType<typeof useI18n>["t"];
  onOpenSource?: (path: string) => void;
}> = ({ sources, t, onOpenSource }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="message-bubble__knowledge">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="message-bubble__knowledge-toggle"
      >
        {expanded ? <DownOutlined /> : <RightOutlined />}
        <BookOutlined />
        <span>{t("knowledgeSources")} ({sources.length})</span>
      </button>
      {expanded ? (
        <div className="message-bubble__knowledge-tags">
          {sources.map((source, index) => {
            const chunk = formatKnowledgeChunk(source, t);
            const label = [source.rel, formatKnowledgeMethod(source.method, t), chunk].filter(Boolean).join(" · ");
            return (
              <Tooltip key={`${source.rel}-${source.method}-${index}`} title={source.excerpt || source.rel}>
                <button
                  type="button"
                  onClick={() => onOpenSource?.(source.rel)}
                  className={`message-bubble__knowledge-tag${onOpenSource ? "" : " message-bubble__knowledge-tag--static"}`}
                >
                  {label}
                </button>
              </Tooltip>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

function formatRoutingUsage(step: ModelRoutingMetadata["steps"][number]) {
  const usage = step.usage;
  if (!usage) return "";
  const total = usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0));
  return total ? `${total} tokens` : "";
}

const RoutingTraceBlock: React.FC<{ routing: ModelRoutingMetadata }> = ({ routing }) => {
  const [expanded, setExpanded] = useState(false);
  const roles = routing.steps.map((step) => step.role).filter((role, index, items) => items.indexOf(role) === index);
  return (
    <div className="message-bubble__routing">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="message-bubble__routing-toggle"
      >
        {expanded ? <DownOutlined /> : <RightOutlined />}
        <RobotOutlined />
        <span>{routing.routeClass ?? "route"}</span>
        {routing.executionMode ? <Tag>{routing.executionMode}</Tag> : null}
        {roles.length ? <Tag>{roles.join(" -> ")}</Tag> : null}
        {routing.loopIterations ? <Tag color="blue">loop {routing.loopIterations}</Tag> : null}
        {routing.replanTriggered ? <Tag color="purple">replanned</Tag> : null}
        {routing.checkTriggered ? <Tag color="gold">checked</Tag> : null}
        {typeof routing.qualityScore === "number" ? <Tag color={routing.qualityScore >= (routing.qualityThreshold ?? 0) ? "green" : "orange"}>{routing.qualityScore.toFixed(2)}</Tag> : null}
      </button>
      {expanded ? (
        <div className="message-bubble__routing-steps">
          {routing.steps.map((step, index) => {
            const usage = formatRoutingUsage(step);
            return (
              <div key={`${step.role}-${step.status}-${index}`} className="message-bubble__routing-step">
                <Tag color={step.status === "failed" ? "red" : step.status === "completed" ? "green" : step.status === "skipped" ? "default" : "blue"}>
                  {step.role}
                </Tag>
                <span>{step.status}</span>
                {step.iteration ? <span>loop {step.iteration}</span> : null}
                {step.profileName || step.model ? <span>{[step.profileName, step.model].filter(Boolean).join(" / ")}</span> : null}
                {step.replanReason ? <span>{step.replanReason}</span> : null}
                {step.reason ? <span>{step.reason}</span> : null}
                {usage ? <span>{usage}</span> : null}
              </div>
            );
          })}
          {routing.replanReasons?.length ? (
            <div className="message-bubble__routing-step">
              <Tag color="purple">replan</Tag>
              <span>{routing.replanReasons.join(", ")}</span>
            </div>
          ) : null}
          {routing.checkReasons?.length ? (
            <div className="message-bubble__routing-step">
              <Tag color="orange">check</Tag>
              <span>{routing.checkReasons.join(", ")}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

function extractUploadArtifacts(content: string) {
  const matches = [...content.matchAll(/(?:^|\s)(\/uploads\/[^\s)]+?\.(?:png|jpe?g|webp|gif|mp3|wav|m4a|ogg|webm))/gi)];
  const seen = new Set<string>();
  return matches
    .map((match) => match[1])
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((url) => {
      const lower = url.toLowerCase();
      const type = /\.(png|jpe?g|webp|gif)$/i.test(lower) ? "image" : "audio";
      return { url, type, name: url.split("/").pop() || url };
    });
}

function buildAttachmentHref(apiBase: string, attachment: Pick<Attachment, "url">) {
  return /^https?:\/\//i.test(attachment.url) ? attachment.url : `${apiBase}${attachment.url}`;
}

function buildAttachmentDownloadHref(apiBase: string, attachment: Pick<Attachment, "url" | "name">) {
  if (/^https?:\/\//i.test(attachment.url)) return attachment.url;
  return `${apiBase}/api/uploads/download?url=${encodeURIComponent(attachment.url)}&name=${encodeURIComponent(attachment.name)}`;
}

function AttachmentActions({
  href,
  downloadHref,
  t,
}: {
  href: string;
  downloadHref: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="message-bubble__attachment-actions">
      <a href={href} target="_blank" rel="noreferrer" className="message-bubble__attachment-link">
        {t("openAttachment")}
      </a>
      <a href={downloadHref} download className="message-bubble__attachment-link">
        <DownloadOutlined />
        {t("downloadAttachment")}
      </a>
    </div>
  );
}

function AttachmentCard({
  attachment,
  apiBase,
  t,
  onPreview,
}: {
  attachment: Attachment;
  apiBase: string;
  t: ReturnType<typeof useI18n>["t"];
  onPreview?: (attachment: Attachment) => void;
}) {
  const href = buildAttachmentHref(apiBase, attachment);
  const downloadHref = buildAttachmentDownloadHref(apiBase, attachment);

  if (attachment.type === "image") {
    return (
      <div className="message-bubble__attachment">
        <img
          src={href}
          alt={attachment.name}
          className="message-bubble__attachment-image"
          onClick={() => onPreview?.(attachment)}
        />
        <AttachmentActions href={href} downloadHref={downloadHref} t={t} />
      </div>
    );
  }

  if (attachment.type === "audio") {
    return (
      <div className="message-bubble__attachment-card">
        <div className="message-bubble__attachment-meta">
          <SoundOutlined />
          <a href={href} target="_blank" rel="noreferrer" className="message-bubble__attachment-link">
            {attachment.name}
          </a>
        </div>
        <audio controls src={href} className="message-bubble__attachment-audio" />
        <AttachmentActions href={href} downloadHref={downloadHref} t={t} />
      </div>
    );
  }

  return (
    <div className="message-bubble__attachment-card message-bubble__attachment-card--row">
      <FileOutlined className="message-bubble__attachment-link" />
      <div>
        <a href={href} target="_blank" rel="noreferrer" className="message-bubble__attachment-link">
          {attachment.name}
        </a>
        <AttachmentActions href={href} downloadHref={downloadHref} t={t} />
      </div>
    </div>
  );
}

function getMessageStatusMeta(status: ChatMessage["status"], t: ReturnType<typeof useI18n>["t"]) {
  switch (status) {
    case "undone":
      return { color: "default" as const, label: t("undone") };
    case "failed":
      return { color: "error" as const, label: t("failedExecution") };
    case "interrupted":
      return { color: "warning" as const, label: t("interrupted") };
    case "needs_input":
      return { color: "processing" as const, label: t("needsInput") };
    default:
      return null;
  }
}

const MessageBubbleComponent: React.FC<Props> = ({ message, streaming, toolCalls, blocks, undoable, onUndo, onOpenKnowledgeSource }) => {
  const { t } = useI18n();
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const isUser = message.role === "user";
  const effectiveToolCalls = (toolCalls ?? message.meta?.toolCalls ?? []) as ToolCallEvent[];
  const effectiveBlocks = blocks ?? message.meta?.messageBlocks;
  const toolMap = new Map(effectiveToolCalls.map((toolCall) => [toolCall.id, toolCall]));
  const hasBlocks = !isUser && Boolean(effectiveBlocks?.length);
  const apiBase = getApiBase();
  const safeContent = useMemo(() => (!isUser ? stripDsmlArtifacts(message.content) : message.content), [isUser, message.content]);
  const knowledgeSources = !isUser ? message.meta?.knowledgeSources ?? [] : [];
  const routing = !isUser ? message.meta?.routing : undefined;
  const normalizedAttachments = useMemo(() => {
    const explicit = message.attachments ?? [];
    if (isUser) return explicit;

    const byUrl = new Map(explicit.map((attachment) => [attachment.url, attachment]));
    for (const artifact of extractUploadArtifacts(safeContent)) {
      if (!byUrl.has(artifact.url)) {
        byUrl.set(artifact.url, {
          url: artifact.url,
          name: artifact.name,
          type: artifact.type === "audio" ? "audio" : "image",
          source: "generated",
        });
      }
    }
    return [...byUrl.values()];
  }, [isUser, message.attachments, safeContent]);
  const statusMeta = !isUser ? getMessageStatusMeta(message.status, t) : null;
  const isUndone = message.status === "undone";

  const bubbleClass = [
    "message-bubble__bubble",
    isUser ? "message-bubble__bubble--user" : "",
    isUndone ? "message-bubble__bubble--undone" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={`message-bubble ${isUser ? "message-bubble--user" : "message-bubble--assistant"}`}>
      <Avatar
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        className="message-bubble__avatar"
        size={32}
      />
      <div className="message-bubble__content">
        {normalizedAttachments.map((attachment, index) => (
          <AttachmentCard
            key={`${attachment.url}-${index}`}
            attachment={attachment}
            apiBase={apiBase}
            t={t}
            onPreview={(nextAttachment) => setPreviewAttachment(nextAttachment)}
          />
        ))}
        <div className={bubbleClass}>
          {isUser ? (
            <span className="message-bubble__user-text">{message.content}</span>
          ) : hasBlocks && effectiveBlocks ? (
            <>
              {effectiveBlocks.map((block, index) => {
                const isLast = index === effectiveBlocks.length - 1;
                if (block.type === "text") {
                  return (
                    <MarkdownText
                      key={`text-${index}`}
                      content={stripDsmlArtifacts(block.content)}
                      streaming={streaming && isLast}
                    />
                  );
                }
                if (block.type === "notice") {
                  return (
                    <NoticeBlock
                      key={`notice-${index}`}
                      content={stripDsmlArtifacts(block.content)}
                      tone={block.tone}
                    />
                  );
                }
                const call = toolMap.get(block.id);
                return call ? <ToolCallItem key={block.id} call={call} /> : null;
              })}
              {streaming && effectiveBlocks.length > 0 && effectiveBlocks[effectiveBlocks.length - 1].type === "tool" ? (
                <span className="message-bubble__stream-cursor">{STREAM_CURSOR}</span>
              ) : null}
            </>
          ) : (
            <MarkdownText content={safeContent} streaming={streaming} />
          )}
        </div>
        {knowledgeSources.length ? (
          <KnowledgeSourcesBlock sources={knowledgeSources} t={t} onOpenSource={onOpenKnowledgeSource} />
        ) : null}
        {routing?.enabled ? <RoutingTraceBlock routing={routing} /> : null}
        <Modal
          open={Boolean(previewAttachment)}
          title={previewAttachment?.name ?? ""}
          onCancel={() => setPreviewAttachment(null)}
          footer={null}
          centered
          destroyOnClose
          width="min(92vw, 980px)"
          className="message-bubble__preview-modal"
        >
          {previewAttachment ? (
            <div className="message-bubble__preview">
              <img
                src={buildAttachmentHref(apiBase, previewAttachment)}
                alt={previewAttachment.name}
                className="message-bubble__preview-image"
              />
              <AttachmentActions
                href={buildAttachmentHref(apiBase, previewAttachment)}
                downloadHref={buildAttachmentDownloadHref(apiBase, previewAttachment)}
                t={t}
              />
            </div>
          ) : null}
        </Modal>
        <div className="message-bubble__footer">
          {statusMeta ? <Tag color={statusMeta.color}>{statusMeta.label}</Tag> : null}
          {!isUser && isUndone && message.meta?.undoneMessage ? (
            <span className="message-bubble__undone-note">
              {message.meta.undoneMessage === "This turn was undone and its file changes were restored."
                ? t("undoneMessage")
                : message.meta.undoneMessage}
            </span>
          ) : null}
          {!isUser && !isUndone && undoable && onUndo ? (
            <Popconfirm
              title={t("confirmUndo")}
              description={t("confirmUndoDescription")}
              okText={t("confirm")}
              cancelText={t("cancel")}
              onConfirm={onUndo}
            >
              <Tooltip title={t("undoChanges")}>
                <Button
                  size="small"
                  type="text"
                  icon={<UndoOutlined />}
                  className="message-bubble__undo-btn"
                >
                  {t("undo")}
                </Button>
              </Tooltip>
            </Popconfirm>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleComponent, (prev, next) => (
  prev.message === next.message
  && prev.streaming === next.streaming
  && prev.toolCalls === next.toolCalls
  && prev.blocks === next.blocks
  && prev.attachments === next.attachments
  && prev.undoable === next.undoable
  && prev.onOpenKnowledgeSource === next.onOpenKnowledgeSource
));

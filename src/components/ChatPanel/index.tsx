import React, { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ModelOnboarding } from "./ModelOnboarding";
import { uploadFiles } from "./upload";
import { useChatStore } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import type { Attachment, ConversationSurface } from "../../shared/types";
import "./index.scss";

function hasDraggedFiles(dataTransfer?: DataTransfer | null) {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}

interface ChatPanelProps {
  surface?: ConversationSurface;
  externalFillValue?: { text: string; ts: number } | null;
  onOpenSettings?: () => void;
  onOpenKnowledgeSource?: (path: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ surface = "chat", externalFillValue = null, onOpenSettings, onOpenKnowledgeSource }) => {
  const {
    streaming,
    sendMessage,
    cancelStream,
    settings,
    modelProfiles,
    modelProfilesLoaded,
    loadModelProfiles,
  } = useChatStore();
  const { mode } = useTheme();
  const { t } = useI18n();
  const [fillValue, setFillValue] = useState<{ text: string; ts: number } | null>(null);
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragDepthRef = useRef(0);

  const hasPrimaryOrchestrationModel = modelProfiles.some((profile) => (
    profile.enabled
    && profile.isPrimary
    && Boolean(profile.capabilities?.includes("orchestration"))
  ));
  const waitingForProfileState = surface === "chat" && !modelProfilesLoaded;
  const needsHomepageOnboarding = surface === "chat" && modelProfilesLoaded && !hasPrimaryOrchestrationModel;
  const showHomepageOnboarding = waitingForProfileState || needsHomepageOnboarding;

  useEffect(() => {
    const preventWindowFileDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
    };

    window.addEventListener("dragover", preventWindowFileDrop);
    window.addEventListener("drop", preventWindowFileDrop);
    return () => {
      window.removeEventListener("dragover", preventWindowFileDrop);
      window.removeEventListener("drop", preventWindowFileDrop);
    };
  }, []);

  useEffect(() => {
    if (!externalFillValue?.text) return;
    setFillValue({
      text: inputText.trim()
        ? `${inputText.trimEnd()}\n\n${externalFillValue.text}`
        : externalFillValue.text,
      ts: externalFillValue.ts,
    });
  }, [externalFillValue]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUploadFiles(files: File[]) {
    if (files.length === 0) return;

    setUploading(true);
    try {
      const uploaded = await uploadFiles(files);
      if (uploaded.length > 0) {
        setAttachments((current) => [...current, ...uploaded]);
      }
    } catch (error) {
      console.warn("[chat] attachment upload failed:", error);
    } finally {
      setUploading(false);
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    await handleUploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  return (
    <div
      className={`chat-panel${mode === "light" ? " chat-panel--light" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(event) => { void handleDrop(event); }}
    >
      {showHomepageOnboarding ? (
        <div className="chat-panel__onboarding">
          <ModelOnboarding
            loading={waitingForProfileState}
            settings={settings}
            onSuccess={async () => {
              await loadModelProfiles();
            }}
            onOpenSettings={onOpenSettings}
          />
        </div>
      ) : (
        <>
          <MessageList
            onSuggest={(text) => setFillValue({ text, ts: Date.now() })}
            hasInput={inputText.length > 0}
            onOpenKnowledgeSource={onOpenKnowledgeSource}
          />
          <InputBar
            onSend={(content, messageAttachments) => {
              void sendMessage(content, messageAttachments, { surface });
              setAttachments([]);
            }}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onUploadFiles={handleUploadFiles}
            disabled={streaming || uploading}
            onCancel={streaming ? cancelStream : undefined}
            fillValue={fillValue}
            onValueChange={setInputText}
          />
        </>
      )}

      {dragActive && (
        <div className="chat-panel__drop-overlay">
          <div className="chat-panel__drop-card">
            <div className="chat-panel__drop-title">{t("dropFilesToAttach")}</div>
            <div className="chat-panel__drop-subtitle">{t("uploadFile")}</div>
          </div>
        </div>
      )}
    </div>
  );
};

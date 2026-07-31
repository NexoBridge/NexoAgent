import React, { useEffect, useRef, useState } from "react";
import { Button, Input, Tag, Tooltip } from "antd";
import { CloseOutlined, FileOutlined, PaperClipOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { getApiBase } from "../../services/api";
import { useI18n } from "../../i18n";
import type { Attachment } from "../../shared/types";
import "./InputBar.scss";

interface Props {
  onSend: (content: string, attachments: Attachment[]) => void;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  disabled?: boolean;
  onCancel?: () => void;
  fillValue?: { text: string; ts: number } | null;
  onValueChange?: (v: string) => void;
  blockedMessage?: string;
}

export const InputBar: React.FC<Props> = ({
  onSend,
  attachments,
  onAttachmentsChange,
  onUploadFiles,
  disabled,
  onCancel,
  fillValue,
  onValueChange,
  blockedMessage,
}) => {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (fillValue?.text) {
      setValue(fillValue.text);
      onValueChange?.(fillValue.text);
      ref.current?.focus();
    }
  }, [fillValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (nextValue: string) => {
    setValue(nextValue);
    onValueChange?.(nextValue);
  };

  const submit = () => {
    if (disabled || (!value.trim() && attachments.length === 0)) return;
    onSend(value, attachments);
    setValue("");
    onAttachmentsChange([]);
    onValueChange?.("");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    await onUploadFiles(files);
    event.target.value = "";
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.files ?? []);
    const itemFiles = event.clipboardData.items
      ? Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      : [];
    const files = [...clipboardFiles, ...itemFiles].filter((file, index, all) =>
      all.findIndex((candidate) =>
        candidate.name === file.name
        && candidate.size === file.size
        && candidate.type === file.type) === index,
    );

    if (files.length > 0) {
      void onUploadFiles(files);
    }
  };

  const resolveAttachmentPreviewUrl = (attachment: Attachment) => (
    /^https?:\/\//i.test(attachment.url) ? attachment.url : `${getApiBase()}${attachment.url}`
  );

  return (
    <div className="input-bar">
      {blockedMessage ? (
        <div className="input-bar__blocked">
          {blockedMessage}
        </div>
      ) : null}
      {attachments.length > 0 && (
        <div className="input-bar__attachments">
          {attachments.map((attachment, index) => (
            <Tag
              key={`${attachment.url}-${index}`}
              className="input-bar__attachment-tag"
              closeIcon={<CloseOutlined className="input-bar__attachment-close" />}
              closable
              onClose={() => onAttachmentsChange(attachments.filter((_, currentIndex) => currentIndex !== index))}
            >
              {attachment.type === "image"
                ? (
                  <img
                    src={resolveAttachmentPreviewUrl(attachment)}
                    alt={attachment.name}
                    className="input-bar__attachment-thumb"
                  />
                )
                : <FileOutlined />}
              <span>{attachment.name}</span>
            </Tag>
          ))}
        </div>
      )}

      <div className="input-bar__row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="input-bar__file-input"
          onChange={handleFileChange}
        />
        <Tooltip title={t("attachFile")}>
          <Button
            icon={<PaperClipOutlined />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="input-bar__control input-bar__attach-btn"
          />
        </Tooltip>
        <Input.TextArea
          ref={ref}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={handlePaste}
          placeholder={blockedMessage || t("typeMessage")}
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={disabled && !onCancel}
          className="input-bar__control input-bar__textarea"
        />
        {disabled && onCancel ? (
          <Tooltip title={t("stopGeneration")}>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={() => { onCancel(); }}
              className="input-bar__action-btn"
            />
          </Tooltip>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={submit}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            className="input-bar__action-btn input-bar__send-btn"
          />
        )}
      </div>
    </div>
  );
};

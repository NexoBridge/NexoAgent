import React, { useState, useRef, useEffect } from "react";
import { Input, Button, Tag, Tooltip } from "antd";
import { SendOutlined, PaperClipOutlined, CloseOutlined, FileOutlined, StopOutlined } from "@ant-design/icons";
import { getApiBase } from "../../services/api";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import type { Attachment } from "../../shared/types";

interface Props {
  onSend: (content: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  onCancel?: () => void;
  fillValue?: { text: string; ts: number } | null;
  onValueChange?: (v: string) => void;
}

export const InputBar: React.FC<Props> = ({ onSend, disabled, onCancel, fillValue, onValueChange }) => {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { colors } = useTheme();
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

  const handleChange = (v: string) => {
    setValue(v);
    onValueChange?.(v);
  };

  const submit = () => {
    if (disabled || (!value.trim() && attachments.length === 0)) return;
    onSend(value, attachments);
    setValue("");
    setAttachments([]);
    onValueChange?.("");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(getApiBase() + "/api/upload", { method: "POST", body: form });
    if (res.ok) {
      const data = await res.json();
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : "file";
      setAttachments((prev) => [
        ...prev,
        {
          url: data.url,
          name: data.name || file.name,
          type: data.type || type,
          mimeType: data.mimeType || file.type,
          size: data.size || file.size,
          source: "upload",
        },
      ]);
    }
    e.target.value = "";
  };

  const controlStyle: React.CSSProperties = {
    borderRadius: 12,
    background: colors.bgTertiary,
    color: colors.textPrimary,
    border: `1px solid ${colors.borderStrong}`,
  };

  return (
    <div style={{ padding: "12px 24px 20px", borderTop: `1px solid ${colors.border}`, background: colors.bgSecondary }}>
      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {attachments.map((att, i) => (
            <Tag
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "2px 6px",
                background: colors.bgTertiary, border: `1px solid ${colors.borderStrong}`, color: colors.textPrimary,
              }}
              closeIcon={<CloseOutlined style={{ color: colors.textMuted }} />}
              closable
              onClose={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
            >
              {att.type === "image"
                ? <img src={getApiBase() + att.url} alt={att.name} style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 2 }} />
                : <FileOutlined />}
              <span>{att.name}</span>
            </Tag>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileChange} />
        <Tooltip title={t("attachFile")}>
          <Button
            icon={<PaperClipOutlined />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            style={{ ...controlStyle, height: 40, width: 48, flexShrink: 0, color: colors.textMuted }}
          />
        </Tooltip>
        <Input.TextArea
          ref={ref}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          placeholder={t("typeMessage")}
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={disabled && !onCancel}
          style={{ ...controlStyle, resize: "none" }}
        />
        {disabled && onCancel ? (
          <Tooltip title={t("stopGeneration")}>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={() => { onCancel(); }}
              style={{ borderRadius: 12, height: 40, width: 48, flexShrink: 0 }}
            />
          </Tooltip>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={submit}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            style={{ borderRadius: 12, height: 40, width: 48, flexShrink: 0, background: colors.accent, border: "none" }}
          />
        )}
      </div>
    </div>
  );
};

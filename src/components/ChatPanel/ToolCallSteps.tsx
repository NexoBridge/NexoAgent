import React, { useMemo, useState } from "react";
import { CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined, LoadingOutlined, RightOutlined, ToolOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";
import { getApiBase } from "../../services/api";
import type { ToolOutputStats, ToolRawOutputRef } from "../../shared/types";

export interface ToolCallEvent {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  outputSummary?: string;
  outputPreview?: string;
  rawOutput?: ToolRawOutputRef;
  outputStats?: ToolOutputStats;
  elapsed?: number;
  status: "running" | "done" | "error";
}

function parseToolName(name: string) {
  if (!name.startsWith("mcp__")) {
    return {
      provider: "built-in",
      displayName: name,
      title: name,
      isMcp: false,
    };
  }

  const parts = name.split("__").filter(Boolean);
  const [, serverName, ...toolNameParts] = parts;
  const toolName = toolNameParts.join("__") || name.replace(/^mcp__/, "");

  return {
    provider: serverName || "mcp",
    displayName: toolName,
    title: `${serverName || "mcp"} / ${toolName}`,
    isMcp: true,
  };
}

function isTrivialShellCommandResult(call: ToolCallEvent) {
  if (call.name !== "shell_command" || call.status !== "done" || !call.output) {
    return false;
  }

  const normalized = call.output
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalized.length === 0) return true;
  if (normalized.length === 1) {
    return /^exit_code:\s*0$/i.test(normalized[0]);
  }
  if (normalized.length === 2) {
    return /^exit_code:\s*0$/i.test(normalized[0]) && /^cwd:\s*/i.test(normalized[1]);
  }

  return false;
}

function isTrivialShellCommandSummary(summary: string) {
  const normalized = summary.trim().toLowerCase();
  return (
    normalized === "stdout:" ||
    normalized === "stderr:" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "fullname"
  );
}

function summarizeOutput(output?: string) {
  if (!output) return "";
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^cwd:\s*/i.test(line))
    .filter((line) => !/^exit_code:\s*0$/i.test(line))
    .filter((line) => !/^stdout:\s*$/i.test(line))
    .filter((line) => !/^stderr:\s*$/i.test(line))
    .filter((line) => !/^fullname$/i.test(line))
    .filter((line) => !/^-{2,}$/.test(line));
  const firstLine = lines[0] || "";
  if (!firstLine) return "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}...` : firstLine;
}

function summarizeInput(input: unknown) {
  try {
    const text = JSON.stringify(input);
    if (!text) return "{}";
    return text.length > 120 ? `${text.slice(0, 120)}...` : text;
  } catch {
    return "[unserializable input]";
  }
}

function formatBytes(value?: number) {
  if (!Number.isFinite(value ?? NaN)) return "";
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resolveRawOutputHref(rawOutput?: ToolRawOutputRef) {
  if (!rawOutput?.url) return "";
  if (/^https?:\/\//i.test(rawOutput.url)) return rawOutput.url;
  return `${getApiBase()}${rawOutput.url}`;
}

export const ToolCallItem: React.FC<{ call: ToolCallEvent }> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const [rawOutputText, setRawOutputText] = useState<string | null>(null);
  const [rawOutputLoading, setRawOutputLoading] = useState(false);
  const [rawOutputError, setRawOutputError] = useState("");
  const { colors } = useTheme();
  const { t } = useI18n();
  const parsed = useMemo(() => parseToolName(call.name), [call.name]);
  const summary = call.outputSummary || summarizeOutput(call.output);
  const inputSummary = summarizeInput(call.input);
  const rawOutputHref = useMemo(() => resolveRawOutputHref(call.rawOutput), [call.rawOutput]);

  const loadRawOutput = async () => {
    if (!rawOutputHref || rawOutputLoading || rawOutputText !== null) return;
    setRawOutputLoading(true);
    setRawOutputError("");
    try {
      const response = await fetch(rawOutputHref);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setRawOutputText(await response.text());
    } catch (error) {
      setRawOutputError(error instanceof Error ? error.message : String(error));
    } finally {
      setRawOutputLoading(false);
    }
  };

  const statusMeta = useMemo(() => {
    switch (call.status) {
      case "running":
        return {
          icon: <LoadingOutlined style={{ color: "#f59e0b", fontSize: 12 }} />,
          color: "#fbbf24",
          label: t("running"),
        };
      case "error":
        return {
          icon: <CloseCircleOutlined style={{ color: "#ef4444", fontSize: 12 }} />,
          color: "#f87171",
          label: t("failedExecution"),
        };
      case "done":
      default:
        return {
          icon: <CheckCircleOutlined style={{ color: "#22c55e", fontSize: 12 }} />,
          color: "#4ade80",
          label: t("done"),
        };
    }
  }, [call.status, t]);

  if (isTrivialShellCommandResult(call) || (call.name === "shell_command" && isTrivialShellCommandSummary(summary))) {
    return null;
  }

  return (
    <div
      style={{
        margin: "10px 0",
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        background: colors.toolBg,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          color: colors.textPrimary,
          padding: "10px 12px",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>{statusMeta.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: statusMeta.color, fontSize: 13, fontWeight: 600 }}>{parsed.displayName}</span>
              <Tag color={parsed.isMcp ? "geekblue" : "default"} icon={parsed.isMcp ? <ToolOutlined /> : undefined}>
                {parsed.isMcp ? parsed.provider : t("builtinTool")}
              </Tag>
              <Tag color={call.status === "error" ? "error" : call.status === "running" ? "gold" : "green"}>
                {statusMeta.label}
              </Tag>
              {call.elapsed !== undefined && call.elapsed > 0 ? (
                <span style={{ color: colors.textMuted, fontSize: 12 }}>{call.elapsed.toFixed(2)}s</span>
              ) : null}
            </div>
          </div>
          <RightOutlined
            style={{
              color: colors.textMuted,
              fontSize: 11,
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          />
        </div>
      </button>
      {open ? (
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: 12 }}>
          {parsed.title !== parsed.displayName ? (
            <>
              <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>{t("title")}</div>
              <pre
                style={{
                  background: colors.bgSecondary,
                  color: colors.textPrimary,
                  padding: "10px 12px",
                  borderRadius: 8,
                  margin: "0 0 12px",
                  overflow: "auto",
                  border: `1px solid ${colors.border}`,
                  whiteSpace: "pre-wrap",
                }}
              >
                {parsed.title}
              </pre>
            </>
          ) : null}
          {summary ? (
            <>
              <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>{t("detail")}</div>
              <pre
                style={{
                  background: colors.bgSecondary,
                  color: call.status === "error" ? "#fca5a5" : colors.textPrimary,
                  padding: "10px 12px",
                  borderRadius: 8,
                  margin: "0 0 12px",
                  overflow: "auto",
                  border: `1px solid ${colors.border}`,
                  whiteSpace: "pre-wrap",
                }}
              >
                {summary}
              </pre>
            </>
          ) : null}
          <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>{t("inputSummary")}</div>
          <pre
            style={{
              background: colors.bgSecondary,
              color: colors.textMuted,
              padding: "10px 12px",
              borderRadius: 8,
              margin: "0 0 12px",
              overflow: "auto",
              border: `1px solid ${colors.border}`,
              whiteSpace: "pre-wrap",
            }}
          >
            {inputSummary}
          </pre>
          <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>{t("rawInput")}</div>
          <pre
            style={{
              background: colors.bgSecondary,
              color: colors.textPrimary,
              padding: "10px 12px",
              borderRadius: 8,
              margin: "0 0 12px",
              overflow: "auto",
              border: `1px solid ${colors.border}`,
            }}
          >
            {JSON.stringify(call.input, null, 2)}
          </pre>
          {call.output !== undefined ? (
            <>
              <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>{t("rawOutput")}</div>
              {call.rawOutput ? (
                <div
                  style={{
                    background: colors.bgSecondary,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    margin: "0 0 12px",
                    color: colors.textSecondary,
                    fontSize: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div>
                    {t("rawOutputStored")} {formatBytes(call.rawOutput.originalBytes)}
                    {call.rawOutput.truncated ? ` -> ${formatBytes(call.rawOutput.storedBytes)} sample` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => void loadRawOutput()} loading={rawOutputLoading}>
                      {rawOutputLoading ? t("loadingRawOutput") : t("loadRawOutput")}
                    </Button>
                    <Button size="small" href={rawOutputHref} target="_blank" icon={<DownloadOutlined />}>
                      {t("downloadAttachment")}
                    </Button>
                  </div>
                  {rawOutputError ? (
                    <div style={{ color: "#fca5a5" }}>{t("rawOutputUnavailable")} {rawOutputError}</div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>
                {call.rawOutput && rawOutputText === null ? t("rawOutputPreview") : t("rawOutput")}
              </div>
              <pre
                style={{
                  background: colors.bgSecondary,
                  color: call.status === "error" ? "#fca5a5" : colors.textPrimary,
                  padding: "10px 12px",
                  borderRadius: 8,
                  margin: 0,
                  overflow: "auto",
                  maxHeight: "min(42vh, 360px)",
                  overscrollBehavior: "contain",
                  scrollbarGutter: "stable",
                  border: `1px solid ${colors.border}`,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {rawOutputText ?? (call.rawOutput ? call.outputPreview : call.output) ?? ""}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const ToolCallSteps: React.FC<{ calls: ToolCallEvent[] }> = ({ calls }) => (
  <>
    {calls.map((call) => (
      <ToolCallItem key={call.id} call={call} />
    ))}
  </>
);

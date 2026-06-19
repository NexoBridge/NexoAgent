import React, { useState } from "react";
import { CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined, RightOutlined } from "@ant-design/icons";
import { useTheme } from "../../theme";

export interface ToolCallEvent {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  elapsed?: number;
  status: "running" | "done" | "error";
}

export const ToolCallItem: React.FC<{ call: ToolCallEvent }> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();

  const icon =
    call.status === "running" ? <LoadingOutlined style={{ color: "#f59e0b", fontSize: 11 }} /> :
    call.status === "done" ? <CheckCircleOutlined style={{ color: "#10b981", fontSize: 11 }} /> :
    <CloseCircleOutlined style={{ color: "#ef4444", fontSize: 11 }} />;

  const nameColor = call.status === "error" ? "#f87171" : call.status === "running" ? "#fbbf24" : "#4ade80";

  return (
    <div style={{ marginBottom: 4 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", userSelect: "none" }}
      >
        {icon}
        <span style={{ color: nameColor, fontSize: 13, fontWeight: 500 }}>{call.name}</span>
        {call.elapsed !== undefined && call.elapsed > 0 && (
          <span style={{ color: colors.textSecondary, fontSize: 12 }}>{call.elapsed.toFixed(2)}s</span>
        )}
        <RightOutlined style={{ color: colors.textSecondary, fontSize: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
      </div>
      {open && (
        <div style={{ marginTop: 6, fontSize: 12, fontFamily: "monospace" }}>
          <pre style={{ background: colors.toolBg, color: colors.textMuted, padding: "8px 10px", borderRadius: 6, margin: "0 0 6px", overflow: "auto", border: `1px solid ${colors.border}` }}>
            {JSON.stringify(call.input, null, 2)}
          </pre>
          {call.output !== undefined && (
            <pre style={{ background: colors.toolBg, color: "#65a30d", padding: "8px 10px", borderRadius: 6, margin: 0, overflow: "auto", border: `1px solid ${colors.border}` }}>
              {call.output}
            </pre>
          )}
        </div>
      )}
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

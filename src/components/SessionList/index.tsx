import React, { useState } from "react";
import { Button, Tooltip, Popconfirm, Typography, Input } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined } from "@ant-design/icons";
import { useChatStore, type SessionMeta } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";

const { Text } = Typography;

const SessionItem: React.FC<{ session: SessionMeta; active: boolean }> = ({ session, active }) => {
  const { selectSession, deleteSession, renameSession } = useChatStore();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  const confirmRename = () => {
    if (title.trim()) void renameSession(session.id, title.trim());
    setEditing(false);
  };

  return (
    <div
      onClick={() => !editing && void selectSession(session.id)}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
        borderRadius: 8, cursor: "pointer", marginBottom: 2,
        background: active ? colors.bgTertiary : "transparent",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = colors.hoverBg; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {editing ? (
        <>
          <Input
            size="small"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={confirmRename}
            autoFocus
            style={{
              flex: 1,
              background: colors.bgPrimary,
              color: colors.textPrimary,
              border: `1px solid ${colors.borderStrong}`,
            }}
          />
          <Button size="small" type="text" icon={<CheckOutlined />} onClick={confirmRename} style={{ color: colors.textMuted }} />
        </>
      ) : (
        <>
          <Text
            ellipsis style={{ flex: 1, color: active ? colors.textPrimary : colors.textMuted, fontSize: 13 }}
          >
            {session.title}
          </Text>
          <div style={{ display: "flex", gap: 2, opacity: 0 }} className="session-actions">
            <Tooltip title={t("rename")}>
              <Button size="small" type="text" icon={<EditOutlined />}
                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                style={{ color: colors.textSecondary, padding: "0 4px" }}
              />
            </Tooltip>
            <Popconfirm title={t("delete") + "?"} onConfirm={(e) => { e?.stopPropagation(); void deleteSession(session.id); }} okText={t("delete")} cancelText={t("cancel")}>
              <Button size="small" type="text" icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
                style={{ color: colors.textSecondary, padding: "0 4px" }}
              />
            </Popconfirm>
          </div>
        </>
      )}
    </div>
  );
};

export const SessionList: React.FC = () => {
  const { sessions, activeSessionId, newSession } = useChatStore();
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 10px 8px" }}>
        <Button
          icon={<PlusOutlined />}
          block
          onClick={() => void newSession()}
          style={{
            background: colors.bgTertiary,
            color: colors.textMuted,
            border: `1px solid ${colors.borderStrong}`,
            borderRadius: 8,
          }}
        >
          {t("newChat")}
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
        <style>{`.session-actions { opacity: 0 } div:hover .session-actions { opacity: 1 }`}</style>
        {sessions.map((s) => (
          <SessionItem key={s.id} session={s} active={s.id === activeSessionId} />
        ))}
      </div>
    </div>
  );
};

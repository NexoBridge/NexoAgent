import React, { useEffect, useState } from "react";
import { Button, Input, Modal, Tooltip, Typography } from "antd";
import { PlusOutlined, MenuUnfoldOutlined, MenuFoldOutlined, CheckOutlined } from "@ant-design/icons";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import { useChatStore, type SessionMeta } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import "./index.scss";

const { Text } = Typography;

function formatSessionTitle(title: string, newChatLabel: string, tasksLabel: string) {
  if (title === "New Chat" || title === "\u65b0\u5bf9\u8bdd") {
    return newChatLabel;
  }
  if (title.startsWith("[Task] ")) {
    return `[${tasksLabel}] ${title.slice(7)}`;
  }
  if (title.startsWith("[\u4efb\u52a1] ")) {
    return `[${tasksLabel}] ${title.slice(5)}`;
  }
  if (title.startsWith("[浠诲姟] ")) {
    return `[${tasksLabel}] ${title.slice(6)}`;
  }
  return title;
}

const SessionItem: React.FC<{ session: SessionMeta; active: boolean }> = ({ session, active }) => {
  const { selectSession, deleteSession, renameSession } = useChatStore();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  useEffect(() => {
    setTitle(session.title);
  }, [session.title]);

  const confirmRename = () => {
    if (title.trim()) void renameSession(session.id, title.trim());
    setEditing(false);
  };

  const openActionMenu = (key: string) => {
    if (key === "rename") {
      setTitle(session.title);
      setEditing(true);
      return;
    }

    if (key === "delete") {
      Modal.confirm({
        title: `${t("delete")}?`,
        okText: t("delete"),
        cancelText: t("cancel"),
        okButtonProps: { danger: true },
        onOk: async () => {
          await deleteSession(session.id);
        },
      });
    }
  };

  return (
    <div
      className={`session-list__row${active ? " session-list__row--active" : ""}`}
      onClick={() => !editing && void selectSession(session.id)}
    >
      {editing ? (
        <>
          <Input
            size="small"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onPressEnter={confirmRename}
            autoFocus
            className="session-list__rename-input"
          />
          <Button size="small" type="text" icon={<CheckOutlined />} onClick={confirmRename} className="session-list__confirm-btn" />
        </>
      ) : (
        <>
          <Text ellipsis className={`session-list__title${active ? " session-list__title--active" : ""}`}>
            {formatSessionTitle(session.title, t("newChat"), t("tasks"))}
          </Text>
          <div className="session-list__actions">
            <OverflowMenuButton
              color={colors.textSecondary}
              items={[
                { key: "rename", label: t("rename") },
                { key: "delete", label: t("delete"), danger: true },
              ]}
              onItemClick={openActionMenu}
            />
          </div>
        </>
      )}
    </div>
  );
};

interface SessionListProps {
  collapsed: boolean;
  onToggleWidth: () => void;
}

export const SessionList: React.FC<SessionListProps> = ({ collapsed, onToggleWidth }) => {
  const { sessions, activeSessionId, newSession } = useChatStore();
  const { t } = useI18n();

  const widthTooltip = collapsed ? t("expandHistory") : t("collapseHistory");

  return (
    <div className="session-list">
      <div className={`session-list__toolbar${collapsed ? " session-list__toolbar--collapsed" : ""}`}>
        {!collapsed && (
          <Button
            icon={<PlusOutlined />}
            onClick={() => void newSession()}
            className="session-list__new-btn"
          >
            {t("newChat")}
          </Button>
        )}
        <Tooltip title={widthTooltip}>
          <Button
            onClick={onToggleWidth}
            className={`session-list__toggle-btn ${collapsed ? "session-list__toggle-btn--collapsed" : "session-list__toggle-btn--expanded"}`}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          />
        </Tooltip>
      </div>
      {!collapsed && (
        <div className="session-list__items">
          {sessions.map((session) => (
            <SessionItem key={session.id} session={session} active={session.id === activeSessionId} />
          ))}
        </div>
      )}
    </div>
  );
};

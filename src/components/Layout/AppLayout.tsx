import React, { useEffect, useRef, useState } from "react";
import { Badge, Divider, Layout, Tooltip } from "antd";
import {
  ApiOutlined,
  BookOutlined,
  BorderOutlined,
  CloseOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MessageOutlined,
  MinusOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { SessionList } from "../SessionList";
import { ChatPanel } from "../ChatPanel";
import { MemoryPanel } from "../Memory";
import Knowledge from "../Knowledge";
import Tools from "../Tools";
import Skills from "../Skills";
import Tasks from "../Tasks";
import Logs from "../Logs";
import { Channels } from "../Channels";
import { Settings } from "../Settings";
import BrowserWorkbench from "../BrowserWorkbench";
import { useChatStore } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import { getApiBase, isElectron } from "../../services/api";
import "./index.scss";

const { Content, Sider } = Layout;
const brandIconUrl = new URL("../../../assets/nexoagent-icon-32.png", import.meta.url).href;
const COLLAPSED_SESSION_SIDER_WIDTH = 60;
const MIN_SESSION_SIDER_WIDTH = 220;
const DEFAULT_SESSION_SIDER_WIDTH = 280;
const MAX_SESSION_SIDER_WIDTH = 520;
const DEFAULT_EXPANDED_SESSION_SIDER_WIDTH = 340;

type View = "chat" | "browser" | "memory" | "knowledge" | "tools" | "skills" | "tasks" | "logs" | "channels" | "settings";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export const AppLayout: React.FC = () => {
  const [view, setView] = useState<View>("chat");
  const [knowledgeOpenPath, setKnowledgeOpenPath] = useState<string | null>(null);
  const [sessionSiderCollapsed, setSessionSiderCollapsed] = useState(() => localStorage.getItem("nexo-session-sider-collapsed") === "true");
  const [sessionSiderWidth, setSessionSiderWidth] = useState(() => {
    const saved = Number(localStorage.getItem("nexo-session-sider-width"));
    return Number.isFinite(saved) ? Math.min(MAX_SESSION_SIDER_WIDTH, Math.max(MIN_SESSION_SIDER_WIDTH, saved)) : DEFAULT_SESSION_SIDER_WIDTH;
  });
  const [preferredExpandedWidth, setPreferredExpandedWidth] = useState(() => {
    const saved = Number(localStorage.getItem("nexo-session-sider-expanded-width"));
    return Number.isFinite(saved) ? Math.min(MAX_SESSION_SIDER_WIDTH, Math.max(MIN_SESSION_SIDER_WIDTH, saved)) : DEFAULT_EXPANDED_SESSION_SIDER_WIDTH;
  });
  const [resizingSessionSider, setResizingSessionSider] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [hoveredWindowControl, setHoveredWindowControl] = useState<"minimize" | "maximize" | "close" | null>(null);
  const isDesktopApp = isElectron();
  const browserWorkbenchAvailable = isDesktopApp;
  const isWindowsDesktop = isDesktopApp && navigator.userAgent.includes("Windows");
  const { ensureRuntimeReady, loadSessions, loadModelProfiles, newSession, loadSettings } = useChatStore();
  const { mode, toggleTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const resizeOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const desktopApi = window.nexoDesktop;

  useEffect(() => {
    if (!isWindowsDesktop || !desktopApi?.isWindowMaximized) return;
    let disposed = false;
    const unsubscribe = desktopApi.onWindowMaximizedChange?.((value) => {
      if (!disposed) {
        setWindowMaximized(value);
      }
    });

    void desktopApi.isWindowMaximized().then((value) => {
      if (!disposed) {
        setWindowMaximized(value);
      }
    }).catch((error) => {
      console.warn("[window] failed to read maximize state:", error);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [desktopApi, isWindowsDesktop]);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | undefined;

    void (async () => {
      await ensureRuntimeReady();
      if (disposed) return;
      await Promise.all([
        loadSessions(),
        loadModelProfiles().catch((error) => {
          console.warn("[app] model profiles load failed:", error);
        }),
      ]);
      const sessions = useChatStore.getState().sessions;
      if (disposed) return;
      if (sessions.length === 0) {
        await newSession();
      } else {
        await useChatStore.getState().selectSession(sessions[0].id);
      }

      void loadSettings().catch((error) => {
        console.warn("[app] settings load failed:", error);
      });

      refreshTimer = window.setInterval(() => {
        void useChatStore.getState().loadSessions();
      }, 5000);
    })();

    return () => {
      disposed = true;
      if (refreshTimer !== undefined) {
        window.clearInterval(refreshTimer);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view !== "chat") return;

    const interval = window.setInterval(() => {
      const state = useChatStore.getState();
      const activeSessionId = state.activeSessionId;
      if (!activeSessionId || state.streaming) return;

      const activeMeta = state.sessions.find((session) => session.id === activeSessionId);
      const latestMessageAt = state.messages[state.messages.length - 1]?.createdAt ?? "";
      if (!activeMeta?.updatedAt || !latestMessageAt) return;
      if (activeMeta.updatedAt <= latestMessageAt) return;

      void state.selectSession(activeSessionId).catch((error) => {
        console.warn("[app] failed to refresh active session:", error);
      });
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [view]);

  useEffect(() => {
    if (!browserWorkbenchAvailable && view === "browser") {
      setView("chat");
    }
  }, [browserWorkbenchAvailable, view]);

  useEffect(() => {
    localStorage.setItem("nexo-session-sider-collapsed", String(sessionSiderCollapsed));
  }, [sessionSiderCollapsed]);

  useEffect(() => {
    localStorage.setItem("nexo-session-sider-width", String(sessionSiderWidth));
  }, [sessionSiderWidth]);

  useEffect(() => {
    localStorage.setItem("nexo-session-sider-expanded-width", String(preferredExpandedWidth));
  }, [preferredExpandedWidth]);

  useEffect(() => {
    if (!resizingSessionSider) return undefined;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: MouseEvent) => {
      const origin = resizeOriginRef.current;
      if (!origin) return;
      const nextWidth = Math.min(
        MAX_SESSION_SIDER_WIDTH,
        Math.max(MIN_SESSION_SIDER_WIDTH, origin.startWidth + (event.clientX - origin.startX)),
      );
      setSessionSiderWidth(nextWidth);
      if (nextWidth > MIN_SESSION_SIDER_WIDTH) {
        setPreferredExpandedWidth(nextWidth);
      }
    };

    const stopResize = () => {
      resizeOriginRef.current = null;
      setResizingSessionSider(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResize);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizingSessionSider]);

  const toggleSessionSiderWidth = () => {
    setSessionSiderCollapsed((current) => !current);
  };

  const startSessionResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (sessionSiderCollapsed) return;
    event.preventDefault();
    resizeOriginRef.current = { startX: event.clientX, startWidth: sessionSiderWidth };
    setResizingSessionSider(true);
  };

  const navItem = (targetView: View, icon: React.ReactNode, label: string) => (
    <Tooltip title={label} placement="right" key={targetView}>
      <div
        onClick={() => setView(targetView)}
        className={joinClasses("app-layout__nav-btn", view === targetView && "app-layout__nav-btn--active")}
      >
        {icon}
      </div>
    </Tooltip>
  );

  const openWebConsole = async () => {
    const targetUrl = getApiBase() || "http://localhost:9898";
    if (isElectron() && desktopApi?.openExternal) {
      await desktopApi.openExternal(targetUrl);
      return;
    }
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  const windowButtonClass = (control: "minimize" | "maximize" | "close") => joinClasses(
    "app-layout__window-btn",
    control === "close" && "app-layout__window-btn--close",
    hoveredWindowControl === control && "app-layout__window-btn--hovered",
  );

  const handleMinimize = async () => {
    await desktopApi?.minimizeWindow?.();
  };

  const handleToggleMaximize = async () => {
    if (!desktopApi) return;
    if (windowMaximized) {
      await desktopApi.unmaximizeWindow?.();
      setWindowMaximized(false);
      return;
    }
    await desktopApi.maximizeWindow?.();
    setWindowMaximized(true);
  };

  const handleCloseWindow = async () => {
    await desktopApi?.closeWindow?.();
  };

  const openTaskSession = async (sessionId: string) => {
    setView("chat");
    await useChatStore.getState().loadSessions();
    await useChatStore.getState().selectSession(sessionId);
  };

  const openKnowledgeSource = (path: string) => {
    setKnowledgeOpenPath(path);
    setView("knowledge");
  };

  useEffect(() => {
    const unsubscribe = desktopApi?.onTaskSessionRequested?.((sessionId) => {
      void openTaskSession(sessionId);
    });
    return () => {
      unsubscribe?.();
    };
  }, [desktopApi]);

  return (
    <Layout className={joinClasses("app-layout", isWindowsDesktop && "app-layout--desktop-titlebar")}>
      {isWindowsDesktop && (
        <div className="app-layout__drag-bar">
          <div className="app-layout__brand">
            <img
              src={brandIconUrl}
              alt="NexoAgent"
              className="app-layout__brand-icon"
            />
            <span className="app-layout__brand-title">
              Nexo Agent
            </span>
          </div>

          <div className="app-layout__window-controls">
            <div
              onClick={() => void handleMinimize()}
              onMouseEnter={() => setHoveredWindowControl("minimize")}
              onMouseLeave={() => setHoveredWindowControl(null)}
              className={windowButtonClass("minimize")}
            >
              <MinusOutlined />
            </div>
            <div
              onClick={() => void handleToggleMaximize()}
              onMouseEnter={() => setHoveredWindowControl("maximize")}
              onMouseLeave={() => setHoveredWindowControl(null)}
              className={windowButtonClass("maximize")}
            >
              {windowMaximized ? <CopyOutlined /> : <BorderOutlined />}
            </div>
            <div
              onClick={() => void handleCloseWindow()}
              onMouseEnter={() => setHoveredWindowControl("close")}
              onMouseLeave={() => setHoveredWindowControl(null)}
              className={windowButtonClass("close")}
            >
              <CloseOutlined />
            </div>
          </div>
        </div>
      )}
      <Sider width={52} className="app-layout__icon-sider">
        <div className="app-layout__icon-rail">
          {navItem("chat", <MessageOutlined />, t("chat"))}
          {browserWorkbenchAvailable && navItem("browser", <GlobalOutlined />, t("browserWorkbench"))}

          <Divider className="app-layout__nav-divider" />

          {navItem("memory", <DatabaseOutlined />, t("memory"))}
          {navItem("knowledge", <BookOutlined />, t("knowledge"))}
          {navItem("tools", <ToolOutlined />, t("tools"))}
          {navItem("skills", <ThunderboltOutlined />, t("skills"))}

          <Divider className="app-layout__nav-divider" />

          {navItem("tasks", <ClockCircleOutlined />, t("tasks"))}
          {navItem("logs", <FileTextOutlined />, t("logs"))}
          {navItem("channels", <ApiOutlined />, t("channels"))}

          <div className="app-layout__rail-spacer" />

          <Tooltip title={lang === "zh" ? t("switchToEnglish") : t("switchToChinese")} placement="right">
            <div
              onClick={() => setLang(lang === "zh" ? "en" : "zh")}
              className="app-layout__nav-btn app-layout__nav-btn--lang"
            >
              {lang === "zh" ? "EN" : "ZH"}
            </div>
          </Tooltip>

          <Tooltip title={mode === "dark" ? t("lightMode") : t("darkMode")} placement="right">
            <div onClick={toggleTheme} className="app-layout__nav-btn">
              {mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
            </div>
          </Tooltip>

          {navItem("settings", <SettingOutlined />, t("settings"))}

          <Tooltip title={t("openWebConsole")} placement="right">
            <Badge dot status="success">
              <div onClick={() => void openWebConsole()} className="app-layout__nav-btn">
                <GlobalOutlined />
              </div>
            </Badge>
          </Tooltip>
        </div>
      </Sider>

      {view === "chat" && (
        <>
          <Sider
            width={sessionSiderCollapsed ? COLLAPSED_SESSION_SIDER_WIDTH : sessionSiderWidth}
            className="app-layout__session-sider"
          >
            <SessionList
              collapsed={sessionSiderCollapsed}
              onToggleWidth={toggleSessionSiderWidth}
            />
          </Sider>
          {!sessionSiderCollapsed && (
            <div
              onMouseDown={startSessionResize}
              className={joinClasses("app-layout__resize-handle", resizingSessionSider && "app-layout__resize-handle--active")}
            />
          )}
        </>
      )}

      <Content className="app-layout__content">
        {view === "chat" && <ChatPanel onOpenSettings={() => setView("settings")} onOpenKnowledgeSource={openKnowledgeSource} />}
        {browserWorkbenchAvailable && view === "browser" && <BrowserWorkbench />}
        {view === "memory" && <MemoryPanel />}
        {view === "knowledge" && <Knowledge openPath={knowledgeOpenPath} />}
        {view === "tools" && <Tools />}
        {view === "skills" && <Skills />}
        {view === "tasks" && <Tasks onOpenTaskSession={openTaskSession} />}
        {view === "logs" && <Logs />}
        {view === "channels" && <Channels />}
        {view === "settings" && <Settings />}
      </Content>
    </Layout>
  );
};

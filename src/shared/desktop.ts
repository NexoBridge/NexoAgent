import type { AgentSettings, RuntimeInfo } from "./types";

export type DesktopThemeMode = "dark" | "light";

export interface DesktopApi {
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  loadSettings: () => Promise<AgentSettings>;
  saveSettings: (settings: AgentSettings) => Promise<AgentSettings>;
  openExternal: (url: string) => Promise<void>;
  setThemeMode?: (mode: DesktopThemeMode) => Promise<void>;
  minimizeWindow?: () => Promise<void>;
  maximizeWindow?: () => Promise<void>;
  unmaximizeWindow?: () => Promise<void>;
  closeWindow?: () => Promise<void>;
  isWindowMaximized?: () => Promise<boolean>;
  onWindowMaximizedChange?: (listener: (maximized: boolean) => void) => () => void;
}

import type {
  AgentSettings,
  AgentSettingsSaveInput,
  BrowserActionRequest,
  BrowserActionResponse,
  BrowserBounds,
  BrowserElementPickResult,
  BrowserState,
  RuntimeInfo,
} from "./types";

export type DesktopThemeMode = "dark" | "light";
export const DESKTOP_AUTHORITY_HEADER = "x-nexo-desktop-authority";

export interface DesktopApi {
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  loadSettings: () => Promise<AgentSettings>;
  saveSettings: (settings: AgentSettingsSaveInput) => Promise<AgentSettings>;
  getDesktopAuthorityToken?: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  setThemeMode?: (mode: DesktopThemeMode) => Promise<void>;
  minimizeWindow?: () => Promise<void>;
  maximizeWindow?: () => Promise<void>;
  unmaximizeWindow?: () => Promise<void>;
  closeWindow?: () => Promise<void>;
  isWindowMaximized?: () => Promise<boolean>;
  onWindowMaximizedChange?: (listener: (maximized: boolean) => void) => () => void;
  openBrowserWorkbench?: () => Promise<void>;
  closeBrowserWorkbench?: () => Promise<void>;
  setBrowserBounds?: (bounds: Partial<BrowserBounds>) => Promise<void>;
  setBrowserZoom?: (mode: "in" | "out" | "reset") => Promise<BrowserState>;
  getBrowserState?: () => Promise<BrowserState>;
  browserAction?: (request: BrowserActionRequest) => Promise<BrowserActionResponse>;
  pickBrowserElement?: () => Promise<BrowserElementPickResult>;
  onBrowserStateChange?: (listener: (state: BrowserState) => void) => () => void;
  onTaskSessionRequested?: (listener: (sessionId: string) => void) => () => void;
}

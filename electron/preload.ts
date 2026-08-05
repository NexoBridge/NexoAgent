import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentSettings,
  AgentSettingsSaveInput,
  BrowserActionRequest,
  BrowserActionResponse,
  BrowserBounds,
  BrowserElementPickResult,
  BrowserState,
  DesktopApiRequest,
  DesktopApiResponse,
  RuntimeInfo,
  StreamEvent,
} from "../src/shared/types";
import type { DesktopApi, DesktopThemeMode } from "../src/shared/desktop";

const desktopApi: DesktopApi = {
  getRuntimeInfo: (): Promise<RuntimeInfo> => ipcRenderer.invoke("runtime:info"),
  loadSettings: (): Promise<AgentSettings> => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: AgentSettingsSaveInput): Promise<AgentSettings> =>
    ipcRenderer.invoke("settings:save", settings),
  getDesktopAuthorityToken: (): Promise<string> => ipcRenderer.invoke("desktop-authority:get-token"),
  apiRequest: (request: DesktopApiRequest): Promise<DesktopApiResponse> => ipcRenderer.invoke("desktop-api:request", request),
  uploadFile: (file: { name: string; type: string; data: ArrayBuffer }): Promise<DesktopApiResponse> =>
    ipcRenderer.invoke("desktop-api:upload-file", file),
  subscribeStream: (requestId: string, listener: (event: StreamEvent) => void) => {
    const channel = "desktop-api:stream:" + requestId;
    const wrapped = (_event: unknown, payload: StreamEvent) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    void ipcRenderer.invoke("desktop-api:stream-subscribe", requestId).catch(() => undefined);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
      void ipcRenderer.invoke("desktop-api:stream-unsubscribe", requestId).catch(() => undefined);
    };
  },
  subscribeLogs: (date: string | undefined, listener: (line: string) => void) => {
    const subscriptionId = Date.now() + "-" + Math.random().toString(16).slice(2);
    const channel = "desktop-api:logs:" + subscriptionId;
    const wrapped = (_event: unknown, line: string) => listener(line);
    ipcRenderer.on(channel, wrapped);
    void ipcRenderer.invoke("desktop-api:logs-subscribe", { subscriptionId, date }).catch(() => undefined);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
      void ipcRenderer.invoke("desktop-api:logs-unsubscribe", subscriptionId).catch(() => undefined);
    };
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  setThemeMode: (mode: DesktopThemeMode): Promise<void> => ipcRenderer.invoke("theme:set", mode),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  unmaximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:unmaximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  openBrowserWorkbench: (): Promise<void> => ipcRenderer.invoke("browser:open-workbench"),
  closeBrowserWorkbench: (): Promise<void> => ipcRenderer.invoke("browser:close-workbench"),
  setBrowserBounds: (bounds: Partial<BrowserBounds>): Promise<void> => ipcRenderer.invoke("browser:set-bounds", bounds),
  setBrowserZoom: (mode: "in" | "out" | "reset"): Promise<BrowserState> => ipcRenderer.invoke("browser:set-zoom", mode),
  getBrowserState: (): Promise<BrowserState> => ipcRenderer.invoke("browser:get-state"),
  browserAction: (request: BrowserActionRequest): Promise<BrowserActionResponse> => ipcRenderer.invoke("browser:action", request),
  pickBrowserElement: (): Promise<BrowserElementPickResult> => ipcRenderer.invoke("browser:pick-element"),
  onWindowMaximizedChange: (listener) => {
    const channel = "window:maximized-changed";
    const wrapped = (_event: unknown, maximized: boolean) => listener(maximized);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  onBrowserStateChange: (listener) => {
    const channel = "browser:state-changed";
    const wrapped = (_event: unknown, state: BrowserState) => listener(state);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  onTaskSessionRequested: (listener) => {
    const channel = "task:open-session";
    const wrapped = (_event: unknown, payload: { sessionId?: string } | string) => {
      const sessionId = typeof payload === "string" ? payload : payload?.sessionId;
      if (sessionId) listener(sessionId);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("nexoDesktop", desktopApi);

import { contextBridge, ipcRenderer } from "electron";
import type { AgentSettings, RuntimeInfo } from "../src/shared/types";
import type { DesktopApi, DesktopThemeMode } from "../src/shared/desktop";

const desktopApi: DesktopApi = {
  getRuntimeInfo: (): Promise<RuntimeInfo> => ipcRenderer.invoke("runtime:info"),
  loadSettings: (): Promise<AgentSettings> => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: AgentSettings): Promise<AgentSettings> =>
    ipcRenderer.invoke("settings:save", settings),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  setThemeMode: (mode: DesktopThemeMode): Promise<void> => ipcRenderer.invoke("theme:set", mode),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  unmaximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:unmaximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  onWindowMaximizedChange: (listener) => {
    const channel = "window:maximized-changed";
    const wrapped = (_event: unknown, maximized: boolean) => listener(maximized);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("nexoDesktop", desktopApi);

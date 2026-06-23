import type { DesktopApi } from "./shared/desktop";

declare global {
  interface Window {
    nexoDesktop?: DesktopApi;
  }
}

export {};

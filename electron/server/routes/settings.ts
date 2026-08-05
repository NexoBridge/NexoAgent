import type { Application } from "express";
import type { AgentSettingsSaveInput } from "../../../src/shared/types";
import { sanitizeSettingsForClient } from "../../../src/shared/settings";
import { isDesktopAuthorizedRequest } from "../desktop-authority";
import { denySafeModeWebRequest, isWebSafeModeRequestAuthorized } from "../web-safe-mode-access";
import { buildRuntimeSettings, getWebSettings, mergeWebSettings } from "../settings";
import type { ServerContext } from "./context";

function buildSettingsResponse(surface: "desktop" | "web") {
  const { apiKey, ...safe } = sanitizeSettingsForClient(buildRuntimeSettings(), surface);
  return { ...safe, hasApiKey: Boolean(apiKey || getWebSettings().hasApiKey) };
}

function stripBrowserSafeModeUpdates(payload: Partial<AgentSettingsSaveInput>) {
  const { webSafeMode, webSafeModePassword, ...safePayload } = payload;
  return safePayload;
}

export function registerSettingsRoutes(app: Application, ctx: ServerContext) {
  app.post("/api/settings", (req, res) => {
    if (!isWebSafeModeRequestAuthorized(req, ctx.desktopAuthorityToken)) {
      return denySafeModeWebRequest(res);
    }
    const desktopAuthorized = isDesktopAuthorizedRequest(req, ctx.desktopAuthorityToken);
    const payload = req.body as Partial<AgentSettingsSaveInput>;
    mergeWebSettings(desktopAuthorized ? payload : stripBrowserSafeModeUpdates(payload));
    res.json(buildSettingsResponse(desktopAuthorized ? "desktop" : "web"));
  });

  app.get("/api/settings", (req, res) => {
    if (!isWebSafeModeRequestAuthorized(req, ctx.desktopAuthorityToken)) {
      return denySafeModeWebRequest(res);
    }
    const desktopAuthorized = isDesktopAuthorizedRequest(req, ctx.desktopAuthorityToken);
    res.json(buildSettingsResponse(desktopAuthorized ? "desktop" : "web"));
  });
}

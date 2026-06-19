import type { Application } from "express";
import type { AgentSettings } from "../../../src/shared/types";
import { buildRuntimeSettings, getWebSettings, mergeWebSettings } from "../settings";

export function registerSettingsRoutes(app: Application) {
  app.post("/api/settings", (req, res) => {
    mergeWebSettings(req.body as Partial<AgentSettings>);
    const { apiKey, ...safe } = buildRuntimeSettings();
    res.json({ ...safe, hasApiKey: Boolean(apiKey || getWebSettings().hasApiKey) });
  });

  app.get("/api/settings", (_req, res) => {
    const { apiKey, ...safe } = buildRuntimeSettings();
    res.json({ ...safe, hasApiKey: Boolean(apiKey || getWebSettings().hasApiKey) });
  });
}

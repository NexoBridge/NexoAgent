import type { Application } from "express";
import {
  ensureToolsLoaded,
  getToolDefs,
  getToolMap,
  isToolEnabled,
  saveToolSettings,
  setToolEnabled,
} from "../tools/registry";

export function registerToolRoutes(app: Application) {
  app.get("/api/tools", async (_req, res) => {
    await ensureToolsLoaded();
    const tools = getToolDefs().map((tool) => ({
      name: tool.name,
      label: tool.label,
      group: tool.group,
      description: tool.description,
      enabled: isToolEnabled(tool.name),
    }));
    res.json(tools);
  });

  app.post("/api/tools", async (req, res) => {
    await ensureToolsLoaded();
    const { name, enabled } = req.body;
    if (!getToolMap().has(name)) return res.status(400).json({ error: "unknown tool" });
    setToolEnabled(name, enabled);
    await saveToolSettings();
    return res.json({ ok: true });
  });
}

import type { Application } from "express";
import type { McpServerConfig } from "../../../src/shared/types";
import { listMcpServers, saveMcpServers } from "../mcp-servers";

export function registerMcpServerRoutes(app: Application) {
  app.get("/api/mcp-servers", async (_req, res) => {
    res.json(await listMcpServers());
  });

  app.post("/api/mcp-servers", async (req, res) => {
    const servers = req.body as McpServerConfig[];
    if (!Array.isArray(servers)) return res.status(400).json({ error: "array required" });
    res.json(await saveMcpServers(servers));
  });
}

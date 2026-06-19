import type { Application } from "express";
import type { SkillDefinition, SkillInstallRequest } from "../../../src/shared/types";
import {
  deleteSkill,
  installMarketplaceSkill,
  listMarketplaces,
  listSkills,
  saveSkill,
  searchLocalSkills,
  searchSkillsInMarketplaces,
  setSkillEnabled,
} from "../skills";

export function registerSkillRoutes(app: Application) {
  app.get("/api/skills", async (_req, res) => {
    try {
      res.json(await listSkills());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/skills/marketplaces", async (_req, res) => {
    try {
      res.json(await listMarketplaces());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/skills/search", async (req, res) => {
    try {
      const { query, marketplaceIds, scope } = req.body as { query?: string; marketplaceIds?: string[]; scope?: "all" | "local" | "marketplace" };
      if (!query?.trim()) return res.status(400).json({ error: "query required" });
      const trimmed = query.trim();

      if (scope === "local") {
        return res.json({
          query: trimmed,
          results: await searchLocalSkills(trimmed),
          warnings: [],
        });
      }

      if (scope === "marketplace") {
        return res.json(await searchSkillsInMarketplaces(trimmed, marketplaceIds));
      }

      const [localResults, marketplaceResults] = await Promise.all([
        searchLocalSkills(trimmed),
        searchSkillsInMarketplaces(trimmed, marketplaceIds),
      ]);

      res.json({
        query: trimmed,
        results: localResults,
        marketplaceResults: marketplaceResults.results,
        warnings: marketplaceResults.warnings,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/skills/install", async (req, res) => {
    try {
      const installRequest = req.body as SkillInstallRequest;
      if (!installRequest.marketplaceId?.trim()) {
        return res.status(400).json({ error: "marketplaceId required" });
      }
      if (!installRequest.installSpec?.trim()) {
        return res.status(400).json({ error: "installSpec required" });
      }
      res.json(await installMarketplaceSkill(installRequest));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/skills", async (req, res) => {
    try {
      const skill = req.body as SkillDefinition & { instruction?: string };
      if (!skill.key?.trim() && !skill.name?.trim()) return res.status(400).json({ error: "key or name required" });
      if (!skill.name?.trim()) return res.status(400).json({ error: "name required" });
      if (!skill.description?.trim()) return res.status(400).json({ error: "description required" });
      if (!skill.instruction?.trim()) return res.status(400).json({ error: "instruction required" });

      const saved = await saveSkill({
        ...skill,
        key: skill.key || skill.name,
        instruction: skill.instruction,
        source: "workspace",
        enabled: skill.enabled ?? true,
        category: skill.category || "custom",
      });
      res.json(saved);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/skills/toggle", async (req, res) => {
    try {
      const { key, enabled } = req.body as { key?: string; enabled?: boolean };
      if (!key?.trim()) return res.status(400).json({ error: "key required" });
      await setSkillEnabled(key.trim(), enabled === true);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/skills/:key", async (req, res) => {
    try {
      await deleteSkill(req.params.key);
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("cannot be deleted") ? 403 : 500;
      res.status(status).json({ error: message });
    }
  });
}

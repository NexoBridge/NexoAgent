import type { Application } from "express";
import {
  loadMemory,
  getAllMemories,
  deleteMemory,
  clearAllMemory,
  storeScriptMemory,
  searchMemories,
  consolidateDreamForDay,
  normalizeDayKey,
} from "../../memory";
import { getDefaultServiceProviderName, normalizeServiceProviderName } from "../../../src/shared/providers";
import { resolveMemoryEmbeddingSettings } from "../memory-embedding";
import { resolvePrimaryModelConfig } from "../model-runtime";
import { getWebSettings } from "../settings";
import { buildRuntimeSettings } from "../settings";
import { getOptionalNumberArg, parseMemoryKind, parseMemoryKinds } from "../utils";
import type { ServerContext } from "./context";

export function registerMemoryRoutes(app: Application, ctx: ServerContext) {
  const getModelSettings = async () => {
    const webSettings = buildRuntimeSettings(getWebSettings());
    const apiKey = webSettings.apiKey || ctx.getStoredApiKey() || "";
    const primaryConfig = await resolvePrimaryModelConfig(
      { ...webSettings, apiKey },
      apiKey,
    ).catch(() => null);
    const providerId = primaryConfig?.providerId ?? webSettings.providerId;
    const apiBase = (primaryConfig?.apiBase || webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
    const providerName = normalizeServiceProviderName("", apiBase, providerId)
      || normalizeServiceProviderName(webSettings.providerName, apiBase, providerId)
      || getDefaultServiceProviderName(providerId);
    const model = primaryConfig?.model || webSettings.model || "gpt-4o-mini";
    const resolvedApiKey = primaryConfig?.apiKey || apiKey;
    const embeddingSettings = await resolveMemoryEmbeddingSettings({
      providerId,
      providerName,
      apiKey: resolvedApiKey,
      apiBase,
      model,
      temperature: primaryConfig?.temperature ?? webSettings.temperature ?? 0,
    });
    return {
      providerId,
      providerName,
      apiKey: resolvedApiKey,
      apiBase,
      model,
      embeddingSettings,
    };
  };

  app.get("/api/memory", async (req, res) => {
    await loadMemory();
    res.json(getAllMemories({
      kind: parseMemoryKind(req.query.kind),
      dayKey: typeof req.query.dayKey === "string" ? req.query.dayKey : undefined,
    }));
  });

  app.get("/api/memory/search", async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) return res.status(400).json({ error: "query required" });
    const { embeddingSettings } = await getModelSettings();
    const results = await searchMemories(query, embeddingSettings, {
      kinds: parseMemoryKinds(req.query.kinds ?? req.query.kind),
      dayKey: typeof req.query.dayKey === "string" ? req.query.dayKey : undefined,
      k: getOptionalNumberArg(req.query as Record<string, unknown>, "k", 6),
    });
    return res.json(results);
  });

  app.post("/api/memory/script", async (req, res) => {
    const { key, content, scope, metadata, dayKey } = req.body as {
      key?: string;
      content?: string;
      scope?: string;
      metadata?: Record<string, unknown>;
      dayKey?: string;
    };
    if (!key?.trim()) return res.status(400).json({ error: "key required" });
    if (!content?.trim()) return res.status(400).json({ error: "content required" });

    const { embeddingSettings } = await getModelSettings();
    const id = await storeScriptMemory(key.trim(), content.trim(), { scope, metadata, embeddingSettings, dayKey });
    return res.json({ ok: true, id });
  });

  app.post("/api/memory/dream/:dayKey/regenerate", async (req, res) => {
    const dayKey = normalizeDayKey(req.params.dayKey);
    const { apiKey, apiBase, model, embeddingSettings } = await getModelSettings();
    const result = await consolidateDreamForDay(dayKey, { apiKey, apiBase, model, embeddingSettings });
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.delete("/api/memory/:id", async (req, res) => {
    await deleteMemory(req.params.id);
    res.json({ ok: true });
  });

  app.delete("/api/memory", async (req, res) => {
    await clearAllMemory({
      kind: parseMemoryKind(req.query.kind),
      dayKey: typeof req.query.dayKey === "string" ? req.query.dayKey : undefined,
    });
    res.json({ ok: true });
  });
}

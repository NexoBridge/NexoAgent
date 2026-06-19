import type { Application } from "express";
import { randomUUID } from "node:crypto";
import { getSessionsMap, saveSessionsToDisk } from "../sessions";
import type { Session } from "../types";

export function registerSessionRoutes(app: Application) {
  app.get("/api/sessions", (_req, res) => {
    const list = [...getSessionsMap().values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
    res.json(list);
  });

  app.post("/api/sessions", (_req, res) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const s: Session = { id, title: "新对话", messages: [], createdAt: now, updatedAt: now };
    getSessionsMap().set(id, s);
    void saveSessionsToDisk();
    res.json(s);
  });

  app.get("/api/sessions/:id/messages", (req, res) => {
    const s = getSessionsMap().get(req.params.id);
    if (!s) return res.status(404).json({ error: "会话不存在" });
    return res.json(s.messages);
  });

  app.delete("/api/sessions/:id", (req, res) => {
    getSessionsMap().delete(req.params.id);
    void saveSessionsToDisk();
    res.json({ ok: true });
  });

  app.patch("/api/sessions/:id", (req, res) => {
    const s = getSessionsMap().get(req.params.id);
    if (!s) return res.status(404).json({ error: "会话不存在" });
    const { title } = req.body as { title?: string };
    if (title) {
      s.title = title;
      s.updatedAt = new Date().toISOString();
      void saveSessionsToDisk();
    }
    res.json({ ok: true });
  });
}

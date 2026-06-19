import type { Application } from "express";
import { createHmac } from "node:crypto";
import { addAuthToken, hasAuthToken, removeAuthToken } from "../auth-store";
import { getWebSettings } from "../settings";

export function registerAuthRoutes(app: Application) {
  app.post("/api/auth/login", (req, res) => {
    const { password } = req.body;
    const expected = getWebSettings().webPassword || "";
    if (expected && password !== expected) return res.status(401).json({ error: "wrong password" });
    const token = createHmac("sha256", "nexo-secret-" + expected).update(Date.now().toString()).digest("hex");
    addAuthToken(token);
    return res.json({ token });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    removeAuthToken(token);
    res.json({ ok: true });
  });

  app.get("/api/auth/status", (req, res) => {
    if (!getWebSettings().webPassword) return res.json({ authenticated: true });
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    res.json({ authenticated: hasAuthToken(token) });
  });
}

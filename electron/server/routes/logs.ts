import type { Application } from "express";
import fs from "node:fs/promises";
import { LOG_FILE } from "../config";

export function registerLogRoutes(app: Application) {
  app.get("/api/logs", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    let closed = false;
    req.on("close", () => { closed = true; });

    try {
      const raw = await fs.readFile(LOG_FILE, "utf8");
      const lines = raw.split("\n").filter(Boolean).slice(-200);
      for (const line of lines) res.write("data: " + JSON.stringify(line) + "\n\n");
    } catch { /* no file yet */ }

    let offset = 0;
    try {
      const st = await fs.stat(LOG_FILE);
      offset = st.size;
    } catch { /* ok */ }

    const interval = setInterval(async () => {
      if (closed) {
        clearInterval(interval);
        return;
      }
      try {
        const st = await fs.stat(LOG_FILE);
        if (st.size <= offset) return;
        const buf = Buffer.alloc(st.size - offset);
        const fh = await fs.open(LOG_FILE, "r");
        await fh.read(buf, 0, buf.length, offset);
        await fh.close();
        offset = st.size;
        const newLines = buf.toString().split("\n").filter(Boolean);
        for (const line of newLines) res.write("data: " + JSON.stringify(line) + "\n\n");
      } catch { /* ok */ }
    }, 1000);
  });
}

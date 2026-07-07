import type { Application } from "express";
import fs from "node:fs/promises";
import { LOG_DIR, LOG_FILE } from "../config";
import { getCurrentLogFile, getLogFileForDate } from "../logger";

const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isLogDate(value: unknown): value is string {
  return typeof value === "string" && LOG_DATE_RE.test(value);
}

async function readRecentLines(file: string, limit = 200) {
  const raw = await fs.readFile(file, "utf8");
  return raw.split("\n").filter(Boolean).slice(-limit);
}

async function fileSize(file: string) {
  const st = await fs.stat(file);
  return st.size;
}

async function listDailyLogFiles() {
  try {
    const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const match = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(entry.name);
          if (!match) return null;
          const file = getLogFileForDate(match[1]);
          try {
            const st = await fs.stat(file);
            return {
              date: match[1],
              size: st.size,
              updatedAt: st.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        }),
    );
    return files
      .filter((file): file is { date: string; size: number; updatedAt: string } => Boolean(file))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

async function streamNewLines(file: string, offset: number, write: (line: string) => void) {
  const st = await fs.stat(file);
  if (st.size <= offset) return offset;
  const buf = Buffer.alloc(st.size - offset);
  const fh = await fs.open(file, "r");
  try {
    await fh.read(buf, 0, buf.length, offset);
  } finally {
    await fh.close();
  }
  const newLines = buf.toString().split("\n").filter(Boolean);
  for (const line of newLines) write(line);
  return st.size;
}

export function registerLogRoutes(app: Application) {
  app.get("/api/logs/dates", async (_req, res) => {
    res.json(await listDailyLogFiles());
  });

  app.get("/api/logs", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    let closed = false;
    req.on("close", () => { closed = true; });

    const requestedDate = isLogDate(req.query.date) ? req.query.date : null;
    const followCurrentDate = !requestedDate;
    let activeLogFile = requestedDate ? getLogFileForDate(requestedDate) : getCurrentLogFile();
    try {
      const lines = await readRecentLines(activeLogFile);
      for (const line of lines) res.write("data: " + JSON.stringify(line) + "\n\n");
    } catch {
      if (!requestedDate) {
        try {
          const lines = await readRecentLines(LOG_FILE);
          for (const line of lines) res.write("data: " + JSON.stringify(line) + "\n\n");
        } catch { /* no file yet */ }
      }
    }

    let offset = 0;
    try {
      offset = await fileSize(activeLogFile);
    } catch { /* ok */ }

    const interval = setInterval(async () => {
      if (closed) {
        clearInterval(interval);
        return;
      }
      try {
        const currentLogFile = followCurrentDate ? getCurrentLogFile() : activeLogFile;
        if (followCurrentDate && currentLogFile !== activeLogFile) {
          activeLogFile = currentLogFile;
          offset = 0;
        }
        offset = await streamNewLines(activeLogFile, offset, (line) => {
          res.write("data: " + JSON.stringify(line) + "\n\n");
        });
      } catch { /* ok */ }
    }, 1000);
  });
}

import fs from "node:fs/promises";
import path from "node:path";
import { LOG_DIR, LOG_FILE } from "./config";

let legacyLogMigrationPromise: Promise<void> | null = null;

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromLogLine(line: string) {
  return /^(\d{4}-\d{2}-\d{2})T/.exec(line)?.[1] ?? localDateKey();
}

export function getLogFileForDate(dateKey = localDateKey()) {
  return path.join(LOG_DIR, `app-${dateKey}.log`);
}

export function getCurrentLogFile() {
  return getLogFileForDate(localDateKey());
}

export function migrateLegacyLogFile() {
  legacyLogMigrationPromise ??= (async () => {
    let raw = "";
    try {
      raw = await fs.readFile(LOG_FILE, "utf8");
    } catch {
      return;
    }

    await fs.mkdir(LOG_DIR, { recursive: true });
    const grouped = new Map<string, string[]>();
    for (const line of raw.split("\n").filter(Boolean)) {
      const dateKey = dateKeyFromLogLine(line);
      const lines = grouped.get(dateKey) ?? [];
      lines.push(line);
      grouped.set(dateKey, lines);
    }

    for (const [dateKey, lines] of grouped) {
      await fs.appendFile(getLogFileForDate(dateKey), `${lines.join("\n")}\n`);
    }

    const archiveStamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(LOG_FILE, path.join(LOG_DIR, `app.log.migrated-${archiveStamp}`));
  })().catch(() => {});
  return legacyLogMigrationPromise;
}

export function serverLog(msg: string) {
  const now = new Date();
  const line = now.toISOString() + " " + msg + "\n";
  void fs.mkdir(LOG_DIR, { recursive: true })
    .then(() => fs.appendFile(getLogFileForDate(localDateKey(now)), line))
    .catch(() => {});
}

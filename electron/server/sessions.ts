import fs from "node:fs/promises";
import { DATA_DIR, SESSIONS_FILE } from "./config";
import type { Session } from "./types";

const sessions = new Map<string, Session>();

export function getSessionsMap() {
  return sessions;
}

export function getSession(id: string) {
  return sessions.get(id);
}

export async function loadSessionsFromDisk() {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf8");
    const arr = JSON.parse(raw) as Session[];
    for (const s of arr) sessions.set(s.id, s);
  } catch { /* first run */ }
}

export async function saveSessionsToDisk() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify([...sessions.values()], null, 2));
}

void loadSessionsFromDisk();

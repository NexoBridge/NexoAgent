import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_DIR } from "./config";

export const MAX_FILE_READ_BYTES = 200_000;
export const MAX_FILE_WRITE_BYTES = 1_000_000;

export async function collectFiles(root: string, dir = root, limit = 200): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string) {
    if (out.length >= limit) return;
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) out.push(fullPath);
    }
  }
  await walk(dir);
  return out;
}

function scoreKnowledge(query: string, content: string, filePath: string) {
  const tokens = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []));
  const haystack = `${filePath}\n${content}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export async function retrieveKnowledgeContext(query: string, maxFiles = 4) {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  const files = await collectFiles(KNOWLEDGE_DIR, KNOWLEDGE_DIR, 300);
  const scored: Array<{ rel: string; content: string; score: number }> = [];

  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_FILE_READ_BYTES) continue;
    const content = await fs.readFile(file, "utf8").catch(() => "");
    if (!content.trim()) continue;
    const rel = path.relative(KNOWLEDGE_DIR, file);
    scored.push({ rel, content, score: scoreKnowledge(query, content, rel) });
  }

  const picked = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))
    .slice(0, maxFiles);

  if (!picked.length) return "";
  return picked.map((item) => {
    const excerpt = item.content.length > 3000 ? `${item.content.slice(0, 3000)}\n...[truncated]` : item.content;
    return `## ${item.rel}\n${excerpt}`;
  }).join("\n\n---\n\n");
}

export async function buildKnowledgeTree(dir: string): Promise<unknown[]> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const children = await Promise.all(entries.map(async (e) => {
      const fullPath = path.join(dir, e.name);
      const relPath = path.relative(KNOWLEDGE_DIR, fullPath);
      if (e.isDirectory()) return { name: e.name, path: relPath, type: "dir", children: await buildKnowledgeTree(fullPath) };
      return { name: e.name, path: relPath, type: "file" };
    }));
    return children.sort((a, b) => (a.type === "dir" ? -1 : 1) - (b.type === "dir" ? -1 : 1) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Collection, Metadata } from "chromadb";
import type { KnowledgeSourceHit, KnowledgeSourceMethod } from "../../src/shared/types";
import { embedRetrievalText, getChromaCollection, type MemoryEmbeddingSettings } from "../memory";
import { KNOWLEDGE_DIR } from "./config";
import { serverLog } from "./logger";
import { resolveDataPath } from "./utils";

export const MAX_FILE_READ_BYTES = 200_000;
const KNOWLEDGE_COLLECTION = "nexo_knowledge";
const KNOWLEDGE_INDEX_SCAN_LIMIT = 300;
const KNOWLEDGE_BACKFILL_FILE_LIMIT = 24;
const KNOWLEDGE_CHUNK_CHARS = 1800;
const KNOWLEDGE_CHUNK_OVERLAP = 160;
const KNOWLEDGE_EXCERPT_CHARS = 3000;
const TEXT_SPLITTER_SEPARATORS = ["\n\n", "\n", "\u3002", "\uff1b", "\uff0c", " ", ""];

interface KnowledgeFile {
  rel: string;
  fullPath: string;
  mtimeMs: number;
  size: number;
}

interface IndexedKnowledgeFile {
  ids: string[];
  mtimeMs: number;
  size: number;
}

interface KnowledgeHit {
  rel: string;
  content: string;
  score: number;
  method: KnowledgeSourceMethod;
  chunkIndex?: number;
  chunkCount?: number;
}

let knowledgeIndexing: Promise<void> | null = null;

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

function normalizeKnowledgeRel(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function scoreKnowledge(query: string, content: string, filePath: string) {
  const tokens = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []));
  const haystack = `${filePath}\n${content}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function readKnowledgeFiles(limit = KNOWLEDGE_INDEX_SCAN_LIMIT): Promise<KnowledgeFile[]> {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  const files = await collectFiles(KNOWLEDGE_DIR, KNOWLEDGE_DIR, limit);
  const knowledgeFiles: KnowledgeFile[] = [];

  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.size === 0) continue;
    const rel = normalizeKnowledgeRel(path.relative(KNOWLEDGE_DIR, file));
    knowledgeFiles.push({
      rel,
      fullPath: file,
      mtimeMs: Math.round(stat.mtimeMs),
      size: stat.size,
    });
  }

  return knowledgeFiles;
}

function createKnowledgeChunkAccumulator() {
  const chunks: string[] = [];
  const pushLongText = (text: string) => {
    const step = Math.max(1, KNOWLEDGE_CHUNK_CHARS - KNOWLEDGE_CHUNK_OVERLAP);
    for (let start = 0; start < text.length; start += step) {
      const chunk = text.slice(start, start + KNOWLEDGE_CHUNK_CHARS).trim();
      if (chunk) chunks.push(chunk);
    }
  };

  let current = "";

  const pushParagraph = (paragraph: string) => {
    const part = paragraph.trim();
    if (!part) return;
    if (part.length > KNOWLEDGE_CHUNK_CHARS) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      pushLongText(part);
      return;
    }
    const next = current ? `${current}\n\n${part}` : part;
    if (next.length > KNOWLEDGE_CHUNK_CHARS) {
      if (current) chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  };

  return {
    pushParagraph,
    finish() {
      if (current) chunks.push(current);
      current = "";
      return chunks.filter(Boolean);
    },
  };
}

function chunkKnowledgeContent(content: string) {
  const clean = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= KNOWLEDGE_CHUNK_CHARS) return [clean];

  const accumulator = createKnowledgeChunkAccumulator();
  for (const paragraph of clean.split(/\n{2,}/)) {
    accumulator.pushParagraph(paragraph);
  }
  return accumulator.finish();
}

function isMarkdownKnowledgeFile(file: KnowledgeFile) {
  const lower = file.rel.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

async function splitLargeKnowledgeContent(file: KnowledgeFile, content: string) {
  const clean = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return [];
  const splitter = isMarkdownKnowledgeFile(file)
    ? new MarkdownTextSplitter({
        chunkSize: KNOWLEDGE_CHUNK_CHARS,
        chunkOverlap: KNOWLEDGE_CHUNK_OVERLAP,
        keepSeparator: true,
      })
    : new RecursiveCharacterTextSplitter({
        chunkSize: KNOWLEDGE_CHUNK_CHARS,
        chunkOverlap: KNOWLEDGE_CHUNK_OVERLAP,
        keepSeparator: true,
        separators: TEXT_SPLITTER_SEPARATORS,
      });
  return (await splitter.splitText(clean)).map((chunk) => chunk.trim()).filter(Boolean);
}

async function chunkKnowledgeFile(file: KnowledgeFile) {
  const content = await fs.readFile(file.fullPath, "utf8").catch(() => "");
  return file.size > MAX_FILE_READ_BYTES
    ? splitLargeKnowledgeContent(file, content)
    : chunkKnowledgeContent(content);
}

function knowledgeVectorId(rel: string, chunkIndex: number) {
  const encoded = Buffer.from(rel, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `knowledge:${encoded}:${chunkIndex}`;
}

function embeddingDocument(rel: string, chunk: string, chunkIndex: number, chunkCount: number) {
  return [
    `Path: ${rel}`,
    `Chunk: ${chunkIndex + 1}/${chunkCount}`,
    "",
    chunk,
  ].join("\n");
}

function knowledgeMetadata(file: KnowledgeFile, chunkIndex: number, chunkCount: number): Metadata {
  return {
    source: "nexo-agent",
    kind: "knowledge",
    rel_path: file.rel,
    file_name: path.basename(file.rel),
    chunk_index: chunkIndex,
    chunk_count: chunkCount,
    mtime_ms: file.mtimeMs,
    size: file.size,
  };
}

async function getKnowledgeCollection() {
  return getChromaCollection(KNOWLEDGE_COLLECTION, {
    source: "nexo-agent",
    kind: "knowledge",
  });
}

function metadataString(metadata: Metadata | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function metadataNumber(metadata: Metadata | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mergeKnowledgeSourceMethod(left: KnowledgeSourceMethod, right: KnowledgeSourceMethod): KnowledgeSourceMethod {
  return left === right ? left : "keyword+semantic";
}

async function readIndexedKnowledge(collection: Collection): Promise<Map<string, IndexedKnowledgeFile>> {
  const indexed = new Map<string, IndexedKnowledgeFile>();
  const pageSize = 500;
  let offset = 0;

  while (true) {
    const page = await collection.get({ limit: pageSize, offset, include: ["metadatas"] });
    const ids = page.ids ?? [];
    const metadatas = page.metadatas ?? [];
    ids.forEach((id, index) => {
      const metadata = metadatas[index] as Metadata | null | undefined;
      const rel = metadataString(metadata, "rel_path");
      if (!rel) return;
      const current = indexed.get(rel) ?? { ids: [], mtimeMs: 0, size: 0 };
      current.ids.push(String(id));
      current.mtimeMs = metadataNumber(metadata, "mtime_ms");
      current.size = metadataNumber(metadata, "size");
      indexed.set(rel, current);
    });
    if (ids.length < pageSize) break;
    offset += pageSize;
  }

  return indexed;
}

async function deleteKnowledgeIds(collection: Collection, ids: string[]) {
  if (!ids.length) return;
  await collection.delete({ ids });
}

async function upsertKnowledgeDocument(
  collection: Collection,
  file: KnowledgeFile,
  settings: MemoryEmbeddingSettings = {},
  existingIds: string[] = [],
) {
  const chunks = await chunkKnowledgeFile(file);
  if (!chunks.length) {
    await deleteKnowledgeIds(collection, existingIds);
    return false;
  }

  const embeddings: number[][] = [];
  const ids = chunks.map((_, index) => knowledgeVectorId(file.rel, index));
  const metadatas = chunks.map((_, index) => knowledgeMetadata(file, index, chunks.length));
  const documents = chunks;

  for (let index = 0; index < chunks.length; index += 1) {
    const vector = await embedRetrievalText(
      embeddingDocument(file.rel, chunks[index], index, chunks.length),
      settings,
      "retrieval_document",
    );
    if (!vector?.length) {
      serverLog(`WARN Skipped knowledge vector upsert for ${file.rel}: embedding unavailable.`);
      return false;
    }
    embeddings.push(vector);
  }

  await deleteKnowledgeIds(collection, existingIds);
  await collection.upsert({ ids, embeddings, metadatas, documents });
  serverLog(`INFO Indexed knowledge file ${file.rel} chunks=${chunks.length} size=${file.size}`);
  return true;
}

async function doEnsureKnowledgeVectorIndex(collection: Collection, settings: MemoryEmbeddingSettings = {}) {
  const files = await readKnowledgeFiles();
  const liveRelPaths = new Set(files.map((file) => file.rel));
  const indexed = await readIndexedKnowledge(collection);

  for (const [rel, entry] of indexed.entries()) {
    if (!liveRelPaths.has(rel)) {
      await deleteKnowledgeIds(collection, entry.ids);
    }
  }

  let backfilled = 0;
  for (const file of files) {
    const entry = indexed.get(file.rel);
    if (entry && entry.mtimeMs === file.mtimeMs && entry.size === file.size) continue;
    const ok = await upsertKnowledgeDocument(collection, file, settings, entry?.ids ?? []);
    if (!ok) break;
    backfilled += 1;
    if (backfilled >= KNOWLEDGE_BACKFILL_FILE_LIMIT) break;
  }

  if (backfilled) {
    serverLog(`INFO Indexed ${backfilled} knowledge file(s) into Chroma.`);
  }
}

async function ensureKnowledgeVectorIndex(collection: Collection, settings: MemoryEmbeddingSettings = {}) {
  if (knowledgeIndexing) return knowledgeIndexing;
  knowledgeIndexing = doEnsureKnowledgeVectorIndex(collection, settings)
    .catch((error) => {
      serverLog(`WARN Knowledge vector index refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      knowledgeIndexing = null;
    });
  return knowledgeIndexing;
}

export async function upsertKnowledgeFile(relPath: string, settings: MemoryEmbeddingSettings = {}) {
  const rel = normalizeKnowledgeRel(relPath);
  const fullPath = resolveDataPath(KNOWLEDGE_DIR, rel);
  const stat = await fs.stat(fullPath).catch(() => null);
  const collection = await getKnowledgeCollection();
  if (!collection) return false;

  const indexed = await readIndexedKnowledge(collection);
  const existingIds = indexed.get(rel)?.ids ?? [];
  if (!stat?.isFile()) {
    await deleteKnowledgeIds(collection, existingIds);
    return false;
  }

  return upsertKnowledgeDocument(collection, {
    rel,
    fullPath,
    mtimeMs: Math.round(stat.mtimeMs),
    size: stat.size,
  }, settings, existingIds);
}

export async function deleteKnowledgeVectors(relPath: string) {
  const rel = normalizeKnowledgeRel(relPath);
  const collection = await getKnowledgeCollection();
  if (!collection) return;
  const indexed = await readIndexedKnowledge(collection);
  await deleteKnowledgeIds(collection, indexed.get(rel)?.ids ?? []);
}

async function semanticKnowledgeHits(
  query: string,
  settings: MemoryEmbeddingSettings = {},
  maxFiles = 4,
): Promise<KnowledgeHit[] | null> {
  const vector = await embedRetrievalText(query, settings, "retrieval_query");
  if (!vector?.length) return null;

  const collection = await getKnowledgeCollection();
  if (!collection) return null;

  await ensureKnowledgeVectorIndex(collection, settings);

  const result = await collection.query({
    queryEmbeddings: [vector],
    nResults: Math.max(maxFiles * 3, maxFiles),
    include: ["distances", "documents", "metadatas"],
  });
  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];
  const byRel = new Map<string, KnowledgeHit>();

  documents.forEach((document, index) => {
    const metadata = metadatas[index] as Metadata | null | undefined;
    const rel = metadataString(metadata, "rel_path");
    const content = typeof document === "string" ? document.trim() : "";
    if (!rel || !content) return;
    const score = Number.isFinite(distances[index]) ? -Number(distances[index]) : 0;
    const chunkIndex = metadataNumber(metadata, "chunk_index");
    const chunkCount = metadataNumber(metadata, "chunk_count");
    const current = byRel.get(rel);
    if (!current) {
      byRel.set(rel, { rel, content, score, method: "semantic", chunkIndex, chunkCount });
      return;
    }
    if (current.content.length < KNOWLEDGE_EXCERPT_CHARS) {
      current.content = `${current.content}\n\n...\n\n${content}`;
    }
    current.score = Math.max(current.score, score);
    current.method = mergeKnowledgeSourceMethod(current.method, "semantic");
  });

  return Array.from(byRel.values()).slice(0, maxFiles);
}

async function keywordKnowledgeHits(query: string, maxFiles = 4): Promise<KnowledgeHit[]> {
  const files = await readKnowledgeFiles();
  const hits: KnowledgeHit[] = [];

  for (const file of files) {
    const chunks = await chunkKnowledgeFile(file);
    const scoredChunks = chunks
      .map((chunk, index) => ({
        content: chunk,
        chunkIndex: index,
        score: scoreKnowledge(query, chunk, file.rel),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scoredChunks.length) continue;
    hits.push({
      rel: file.rel,
      content: scoredChunks.slice(0, 3).map((item) => item.content).join("\n\n...\n\n"),
      score: scoredChunks[0].score,
      method: "keyword",
      chunkIndex: scoredChunks[0].chunkIndex,
      chunkCount: chunks.length,
    });
  }

  return hits
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))
    .slice(0, maxFiles);
}

function excerptKnowledge(content: string) {
  const clean = content.trim();
  return clean.length > KNOWLEDGE_EXCERPT_CHARS
    ? `${clean.slice(0, KNOWLEDGE_EXCERPT_CHARS)}\n...[truncated]`
    : clean;
}

function formatKnowledgeContext(hits: KnowledgeHit[]) {
  return hits.map((item) => {
    const chunkLabel = item.chunkCount
      ? `chunk ${(item.chunkIndex ?? 0) + 1}/${item.chunkCount}`
      : "chunk unknown";
    return [
      `## ${item.rel}`,
      `Retrieval: ${item.method}; ${chunkLabel}`,
      "",
      excerptKnowledge(item.content),
    ].join("\n");
  }).join("\n\n---\n\n");
}

function toKnowledgeSourceHit(hit: KnowledgeHit): KnowledgeSourceHit {
  return {
    rel: hit.rel,
    method: hit.method,
    chunkIndex: hit.chunkIndex,
    chunkCount: hit.chunkCount,
    excerpt: excerptKnowledge(hit.content).slice(0, 600),
  };
}

export async function retrieveKnowledgeContextWithSources(
  query: string,
  settingsOrMaxFiles: MemoryEmbeddingSettings | number = {},
  maxFiles = 4,
): Promise<{ context: string; sources: KnowledgeSourceHit[] }> {
  const settings = typeof settingsOrMaxFiles === "number" ? {} : settingsOrMaxFiles;
  const limit = typeof settingsOrMaxFiles === "number" ? settingsOrMaxFiles : maxFiles;
  const picked: KnowledgeHit[] = [];
  const byRel = new Map<string, KnowledgeHit>();
  const addHits = (hits: KnowledgeHit[] | null | undefined) => {
    for (const hit of hits ?? []) {
      const existing = byRel.get(hit.rel);
      if (existing) {
        existing.method = mergeKnowledgeSourceMethod(existing.method, hit.method);
        if (existing.chunkIndex === undefined) existing.chunkIndex = hit.chunkIndex;
        if (existing.chunkCount === undefined) existing.chunkCount = hit.chunkCount;
        continue;
      }
      if (picked.length >= limit) break;
      byRel.set(hit.rel, hit);
      picked.push(hit);
    }
  };

  addHits(await keywordKnowledgeHits(query, limit));

  try {
    addHits(await semanticKnowledgeHits(query, settings, limit));
  } catch (error) {
    serverLog(`WARN Knowledge semantic retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!picked.length) return { context: "", sources: [] };
  const hits = picked.slice(0, limit);
  return {
    context: formatKnowledgeContext(hits),
    sources: hits.map(toKnowledgeSourceHit),
  };
}

export async function retrieveKnowledgeContext(
  query: string,
  settingsOrMaxFiles: MemoryEmbeddingSettings | number = {},
  maxFiles = 4,
) {
  return (await retrieveKnowledgeContextWithSources(query, settingsOrMaxFiles, maxFiles)).context;
}

export async function buildKnowledgeTree(dir: string): Promise<unknown[]> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const children = await Promise.all(entries.map(async (e) => {
      const fullPath = path.join(dir, e.name);
      const relPath = normalizeKnowledgeRel(path.relative(KNOWLEDGE_DIR, fullPath));
      if (e.isDirectory()) return { name: e.name, path: relPath, type: "dir", children: await buildKnowledgeTree(fullPath) };
      return { name: e.name, path: relPath, type: "file" };
    }));
    return children.sort((a, b) => (a.type === "dir" ? -1 : 1) - (b.type === "dir" ? -1 : 1) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

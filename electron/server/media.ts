import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOADS_DIR } from "./config";
import { resolveDataPath } from "./utils";
import type { ChatAttachment } from "./types";
import type { AttachmentType } from "../../src/shared/types";

const GENERATED_UPLOADS_DIR = path.join(UPLOADS_DIR, "generated");

function mimeToAttachmentType(mimeType: string): AttachmentType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function mimeToExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("json")) return "json";
  return "bin";
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3] || "";
  const buffer = isBase64 ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8");
  return { mimeType, buffer };
}

function stripUploadPrefix(url: string) {
  const normalized = url.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
  if (normalized.startsWith("uploads/")) return normalized.slice("uploads/".length);
  if (normalized.startsWith("uploads\\")) return normalized.slice("uploads\\".length);
  return normalized;
}

export async function loadSourceBytes(source: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Missing media source.");
  }

  if (trimmed.startsWith("data:")) {
    const parsed = parseDataUrl(trimmed);
    if (!parsed) throw new Error("Invalid data URL.");
    return { buffer: parsed.buffer, mimeType: parsed.mimeType, filename: "inline" };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed);
    if (!response.ok) {
      throw new Error(`Failed to load media source: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const filename = path.basename(new URL(trimmed).pathname) || "remote";
    return { buffer, mimeType, filename };
  }

  const relative = stripUploadPrefix(trimmed);
  const fullPath = resolveDataPath(UPLOADS_DIR, relative);
  const buffer = await fs.readFile(fullPath);
  const mimeType = (() => {
    const ext = path.extname(fullPath).toLowerCase();
    switch (ext) {
      case ".png": return "image/png";
      case ".jpg":
      case ".jpeg": return "image/jpeg";
      case ".webp": return "image/webp";
      case ".gif": return "image/gif";
      case ".mp3": return "audio/mpeg";
      case ".wav": return "audio/wav";
      case ".m4a": return "audio/mp4";
      case ".ogg": return "audio/ogg";
      case ".webm": return "audio/webm";
      case ".json": return "application/json";
      case ".txt": return "text/plain";
      default: return "application/octet-stream";
    }
  })();
  return { buffer, mimeType, filename: path.basename(fullPath) };
}

export async function attachmentToDataUrl(attachment: ChatAttachment) {
  if (attachment.url.startsWith("data:")) return attachment.url;
  const { buffer, mimeType } = await loadSourceBytes(attachment.url);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function saveGeneratedArtifact(buffer: Buffer, mimeType: string, prefix: string, source: "generated" = "generated") {
  await fs.mkdir(GENERATED_UPLOADS_DIR, { recursive: true });
  const extension = mimeToExtension(mimeType);
  const filename = `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const fullPath = path.join(GENERATED_UPLOADS_DIR, filename);
  await fs.writeFile(fullPath, buffer);
  return {
    url: `/uploads/generated/${filename}`,
    name: filename,
    type: mimeToAttachmentType(mimeType),
    mimeType,
    size: buffer.byteLength,
    source,
    path: fullPath,
  };
}

export function guessAttachmentType(mimeType: string): AttachmentType {
  return mimeToAttachmentType(mimeType);
}

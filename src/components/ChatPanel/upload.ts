import { uploadFile } from "../../services/api";
import type { Attachment } from "../../shared/types";

function inferAttachmentType(file: File, fallback?: string): Attachment["type"] {
  if (fallback === "image" || fallback === "audio" || fallback === "file") {
    return fallback;
  }
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

async function uploadSingleFile(file: File): Promise<Attachment> {
  const data = await uploadFile(file) as Partial<Attachment>;
  return {
    url: data.url || "",
    name: data.name || file.name,
    type: inferAttachmentType(file, typeof data.type === "string" ? data.type : undefined),
    mimeType: data.mimeType || file.type,
    size: data.size || file.size,
    source: "upload",
  };
}

export async function uploadFiles(files: File[]): Promise<Attachment[]> {
  const validFiles = files.filter((file) => file.size >= 0);
  if (validFiles.length === 0) return [];
  return Promise.all(validFiles.map((file) => uploadSingleFile(file)));
}

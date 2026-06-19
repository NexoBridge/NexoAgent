import type { Application } from "express";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, UPLOADS_DIR } from "../config";
import { guessAttachmentType } from "../media";

export function registerUploadRoutes(app: Application) {
  app.use("/uploads", express.static(path.join(DATA_DIR, "uploads")));

  app.post("/api/upload", async (req, res) => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) return res.status(400).json({ error: "multipart required" });
    const Busboy = (await import("busboy")).default;
    const bb = Busboy({ headers: req.headers });
    const files: Array<{ url: string; name: string; type: string; mimeType: string; size: number }> = [];
    const pendingWrites: Promise<void>[] = [];
    await new Promise((resolve, reject) => {
      bb.on("file", (_field, stream, info) => {
        const safe = info.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const id = randomUUID().slice(0, 8);
        const fname = id + "_" + safe;
        const fullPath = path.join(UPLOADS_DIR, fname);
        const mime = info.mimeType || "";
        const fileType = guessAttachmentType(mime);
        const chunks: Buffer[] = [];
        stream.on("data", (d) => chunks.push(d));
        stream.on("end", () => {
          const body = Buffer.concat(chunks);
          pendingWrites.push(
            fs.writeFile(fullPath, body).then(() => {
              files.push({ url: "/uploads/" + fname, name: info.filename, type: fileType, mimeType: mime, size: body.byteLength });
            })
          );
        });
      });
      bb.on("finish", resolve);
      bb.on("error", reject);
      req.pipe(bb);
    });
    await Promise.all(pendingWrites);
    res.json(files[0] || { error: "no file" });
  });
}

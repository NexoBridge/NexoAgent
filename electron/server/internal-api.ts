import type { Application } from "express";
import http from "node:http";
import type { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { DESKTOP_AUTHORITY_HEADER } from "../../src/shared/desktop";
import type { DesktopApiRequest, DesktopApiResponse } from "../../src/shared/types";

class CaptureSocket extends PassThrough {
  chunks: Buffer[] = [];
  encrypted = false;

  constructor() {
    super();
    this.on("data", (chunk) => {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
  }

  setTimeout() {
    return this;
  }

  setNoDelay() {
    return this;
  }

  setKeepAlive() {
    return this;
  }

  destroy(error?: Error) {
    super.destroy(error);
    return this;
  }
}

function findHeaderEnd(buffer: Buffer) {
  for (let index = 0; index <= buffer.length - 4; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10) {
      return index + 4;
    }
  }
  return 0;
}

function normalizeHeaders(headers: DesktopApiRequest["headers"], desktopAuthorityToken: string) {
  const normalized: Record<string, string> = {
    host: "localhost",
    [DESKTOP_AUTHORITY_HEADER]: desktopAuthorityToken,
  };
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function buildRequestBody(request: DesktopApiRequest) {
  if (typeof request.bodyBase64 === "string") {
    return Buffer.from(request.bodyBase64, "base64");
  }
  if (request.body === undefined) {
    return Buffer.alloc(0);
  }
  return Buffer.from(JSON.stringify(request.body), "utf8");
}

function serializeResponseBody(socket: CaptureSocket, bodyChunks: Buffer[]) {
  if (bodyChunks.length > 0) {
    return Buffer.concat(bodyChunks).toString("utf8");
  }
  const raw = Buffer.concat(socket.chunks);
  const headerEnd = findHeaderEnd(raw);
  return (headerEnd ? raw.subarray(headerEnd) : raw).toString("utf8");
}

function bodyChunkToBuffer(chunk: unknown, encoding?: BufferEncoding) {
  if (chunk === undefined || chunk === null || typeof chunk === "function") {
    return null;
  }
  if (Buffer.isBuffer(chunk)) {
    return Buffer.from(chunk);
  }
  if (typeof chunk === "string") {
    return Buffer.from(chunk, encoding ?? "utf8");
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), "utf8");
}

export async function dispatchDesktopApiRequest(
  app: Application,
  request: DesktopApiRequest,
  desktopAuthorityToken: string,
): Promise<DesktopApiResponse> {
  const method = (request.method || "GET").toUpperCase();
  const url = request.path?.trim() || "/";
  if (!url.startsWith("/api/") && !url.startsWith("/uploads/")) {
    return {
      ok: false,
      status: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Unsupported desktop API path." }),
    };
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const body = buildRequestBody(request);
    const headers = normalizeHeaders(request.headers, desktopAuthorityToken);
    if (request.body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    if (body.byteLength > 0) {
      headers["content-length"] = String(body.byteLength);
    }

    const socket = new CaptureSocket();
    const responseBodyChunks: Buffer[] = [];
    const req = new http.IncomingMessage(socket as unknown as Socket);
    req.method = method;
    req.url = url;
    req.headers = headers;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket as unknown as Socket);

    const settle = () => {
      if (settled) return;
      settled = true;
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.getHeaders())) {
        if (Array.isArray(value)) {
          responseHeaders[key.toLowerCase()] = value.join(", ");
        } else if (value !== undefined) {
          responseHeaders[key.toLowerCase()] = String(value);
        }
      }
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: responseHeaders,
        body: serializeResponseBody(socket, responseBodyChunks),
      });
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const originalWrite = res.write.bind(res);
    res.write = ((...args: Parameters<typeof res.write>) => {
      const encoding = typeof args[1] === "string" ? args[1] : undefined;
      const chunk = bodyChunkToBuffer(args[0], encoding);
      if (chunk) responseBodyChunks.push(chunk);
      return originalWrite(...args);
    }) as typeof res.write;

    const originalEnd = res.end.bind(res);
    res.end = ((...args: Parameters<typeof res.end>) => {
      const encoding = typeof args[1] === "string" ? args[1] : undefined;
      const chunk = bodyChunkToBuffer(args[0], encoding);
      if (chunk) responseBodyChunks.push(chunk);
      const result = originalEnd(...args);
      setImmediate(settle);
      return result;
    }) as typeof res.end;

    res.on("finish", settle);
    res.on("error", fail);
    req.on("error", fail);

    app(req, res);
    req.push(body);
    req.push(null);
  });
}

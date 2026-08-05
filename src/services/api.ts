import { NEXO_API_PORT, NEXO_API_URL, VITE_DEV_PORT } from "../shared/ports";
import type { DesktopApiResponse, StreamEvent } from "../shared/types";

export const isElectron = () =>
  typeof window !== "undefined" && "nexoDesktop" in window;

let runtimeBaseUrl = "";
let authToken = typeof localStorage !== "undefined"
  ? localStorage.getItem("nexo-auth-token") || ""
  : "";

export function setRuntimeApiBase(baseUrl?: string) {
  runtimeBaseUrl = baseUrl?.trim().replace(/\/+$/, "") || "";
}

export function getRuntimeApiBase() {
  return runtimeBaseUrl;
}

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token: string) {
  authToken = token.trim();
  if (typeof localStorage !== "undefined") {
    if (authToken) {
      localStorage.setItem("nexo-auth-token", authToken);
    } else {
      localStorage.removeItem("nexo-auth-token");
    }
  }
}

export function clearAuthToken() {
  setAuthToken("");
}

function getDesktopApi() {
  return typeof window !== "undefined" ? window.nexoDesktop : undefined;
}

async function buildApiHeaders(json = false) {
  const headers: Record<string, string> = {};
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  if (authToken) {
    headers.Authorization = "Bearer " + authToken;
  }
  return headers;
}

function resolveApiBase() {
  if (runtimeBaseUrl) {
    return runtimeBaseUrl;
  }

  if (typeof window !== "undefined") {
    const { hostname, port, protocol } = window.location;

    if (protocol === "file:") {
      return NEXO_API_URL;
    }

    const isLocalPreview =
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      (port === String(VITE_DEV_PORT) || port === "5173" || port === "5174" || port === "4173" || port === "4174");

    if (isLocalPreview) {
      return NEXO_API_URL;
    }
  }

  if (typeof location !== "undefined" && location.port !== String(NEXO_API_PORT) && location.hostname === "0.0.0.0") {
    return NEXO_API_URL;
  }

  return "";
}

export function getApiBase() {
  return resolveApiBase();
}

function contentTypeFromHeaders(headers: Headers | Record<string, string>) {
  if (headers instanceof Headers) {
    return headers.get("content-type") || "";
  }
  return headers["content-type"] || headers["Content-Type"] || "";
}

async function responseText(response: Response | DesktopApiResponse) {
  const desktopBody = (response as DesktopApiResponse).body;
  if (typeof desktopBody === "string") {
    return desktopBody;
  }
  return (response as Response).text();
}

async function responseJson<T>(response: Response | DesktopApiResponse): Promise<T> {
  const text = await responseText(response);
  return JSON.parse(text || "null") as T;
}

async function toApiError(response: Response | DesktopApiResponse, fallback: string) {
  try {
    const contentType = contentTypeFromHeaders(response.headers);
    const text = await responseText(response);
    if (contentType.includes("application/json")) {
      const data = JSON.parse(text || "null") as { error?: string };
      if (data?.error) return new Error(data.error);
    } else if (/<!doctype html>/i.test(text)) {
      return new Error("API request hit an HTML page instead of the Nexo backend. Make sure the local backend is running on " + NEXO_API_URL + ".");
    }
  } catch {
    // ignore parse failures
  }
  return new Error(fallback);
}

async function desktopRequest(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) {
  const desktop = getDesktopApi();
  if (!desktop?.apiRequest) return null;
  return desktop.apiRequest({
    method,
    path,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body,
  });
}

async function jsonRequest<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const desktopResponse = await desktopRequest(path, method, body);
  if (desktopResponse) {
    if (!desktopResponse.ok) throw await toApiError(desktopResponse, method + " " + path + " failed: " + desktopResponse.status);
    const contentType = contentTypeFromHeaders(desktopResponse.headers);
    if (!contentType.includes("application/json")) {
      const text = desktopResponse.body;
      if (/<!doctype html>/i.test(text)) {
        throw new Error("API request hit an HTML page instead of JSON.");
      }
      throw new Error(method + " " + path + " returned unexpected content type: " + (contentType || "unknown"));
    }
    return responseJson<T>(desktopResponse);
  }

  const response = await fetch(getApiBase() + path, {
    method,
    headers: await buildApiHeaders(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response, method + " " + path + " failed: " + response.status);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    if (/<!doctype html>/i.test(text)) {
      throw new Error("API request hit an HTML page instead of JSON. Check that the Nexo backend is reachable on " + NEXO_API_URL + ".");
    }
    throw new Error(method + " " + path + " returned unexpected content type: " + (contentType || "unknown"));
  }
  return response.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  return jsonRequest<T>("GET", path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return jsonRequest<T>("POST", path, body);
}

export async function apiDelete(path: string): Promise<void> {
  await jsonRequest<unknown>("DELETE", path);
}

export async function apiPatch(path: string, body: unknown): Promise<void> {
  await jsonRequest<unknown>("PATCH", path, body);
}

function parseSseChunk(buffer: string, onEvent: (event: StreamEvent) => void) {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const rest = chunks.pop() ?? "";
  for (const chunk of chunks) {
    const dataLines = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (!dataLines.length) continue;
    try {
      onEvent(JSON.parse(dataLines.join("\n")) as StreamEvent);
    } catch {
      // Ignore malformed SSE data.
    }
  }
  return rest;
}

export function subscribeStream(
  requestId: string,
  onEvent: (event: StreamEvent) => void
): () => void {
  const desktop = getDesktopApi();
  if (desktop?.subscribeStream) {
    return desktop.subscribeStream(requestId, onEvent);
  }

  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch(getApiBase() + "/api/stream/" + encodeURIComponent(requestId), {
        headers: await buildApiHeaders(),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error("HTTP " + response.status);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, onEvent);
      }
      parseSseChunk(buffer + "\n\n", onEvent);
    } catch {
      if (!controller.signal.aborted) {
        onEvent({ type: "error", message: "Real-time response stream was interrupted. Please try again." });
      }
    }
  })();
  return () => controller.abort();
}

export async function uploadFile(file: File): Promise<unknown> {
  const desktop = getDesktopApi();
  if (desktop?.uploadFile) {
    const response = await desktop.uploadFile({ name: file.name, type: file.type, data: await file.arrayBuffer() });
    if (!response.ok) throw await toApiError(response, "Upload failed: " + file.name);
    return responseJson<unknown>(response);
  }

  const form = new FormData();
  form.append("file", file);
  const response = await fetch(getApiBase() + "/api/upload", {
    method: "POST",
    headers: await buildApiHeaders(),
    body: form,
  });
  if (!response.ok) throw await toApiError(response, "Upload failed: " + file.name);
  return response.json() as Promise<unknown>;
}

export function subscribeLogs(date: string | undefined, onLine: (line: string) => void): () => void {
  const desktop = getDesktopApi();
  if (desktop?.subscribeLogs) {
    return desktop.subscribeLogs(date, onLine);
  }

  const query = date ? "?date=" + encodeURIComponent(date) : "";
  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch(getApiBase() + "/api/logs" + query, {
        headers: await buildApiHeaders(),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const dataLine = chunk.split(/\r?\n/).find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine.slice(5).trimStart());
            onLine(typeof parsed === "string" ? parsed : String(parsed));
          } catch {
            onLine(dataLine.slice(5).trimStart());
          }
        }
      }
    } catch {
      // Log streaming is best-effort.
    }
  })();
  return () => controller.abort();
}

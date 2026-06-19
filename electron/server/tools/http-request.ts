import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const MAX_RESPONSE_BYTES = 24 * 1024;

function normalizeHeaders(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, headerValue]) => headerValue !== undefined && headerValue !== null)
      .map(([key, headerValue]) => [key, typeof headerValue === "string" ? headerValue : String(headerValue)])
  );
}

function normalizeUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  return url.toString();
}

function formatHeaders(headers: Headers) {
  const lines: string[] = [];
  headers.forEach((value, key) => {
    lines.push(`${key}: ${value}`);
  });
  return lines.join("\n");
}

export async function httpRequest(args: Record<string, unknown>) {
  const url = normalizeUrl(getStringArg(args, "url"));
  const method = getOptionalStringArg(args, "method", "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Unsupported method: ${method}`);
  }

  const headers = normalizeHeaders(args.headers);
  const body = args.body == null ? undefined : typeof args.body === "string" ? args.body : JSON.stringify(args.body, null, 2);
  const timeoutMs = Math.max(1000, Math.min(30000, getOptionalNumberArg(args, "timeoutMs", 10000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: controller.signal,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const preview = buffer.subarray(0, MAX_RESPONSE_BYTES);
    const contentType = response.headers.get("content-type") || "";
    let text = preview.toString("utf8");

    if (contentType.includes("application/json")) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Keep raw text when JSON parsing fails.
      }
    }

    return [
      `${method} ${url}`,
      `Status: ${response.status} ${response.statusText}`,
      `Content-Type: ${contentType || "(unknown)"}`,
      `Bytes: ${buffer.byteLength}${buffer.byteLength > MAX_RESPONSE_BYTES ? ` (showing first ${MAX_RESPONSE_BYTES})` : ""}`,
      "",
      "Headers:",
      formatHeaders(response.headers) || "(none)",
      "",
      "Body:",
      text || "(empty)",
    ].join("\n");
  } finally {
    clearTimeout(timer);
  }
}

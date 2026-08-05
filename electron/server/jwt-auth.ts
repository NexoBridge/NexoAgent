import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

const JWT_ALGORITHM = "HS256";
const JWT_TYPE = "JWT";
const JWT_ISSUER = "nexo-agent";
const JWT_AUDIENCE = "nexo-agent-web";
const JWT_TTL_SECONDS = 12 * 60 * 60;
const JWT_SECRET_FILE = path.join(DATA_DIR, "web-auth-jwt-secret");

const revokedTokenIds = new Set<string>();
let cachedSecret = "";

interface JwtHeader {
  alg?: string;
  typ?: string;
}

interface JwtPayload {
  iss?: string;
  aud?: string;
  sub?: string;
  jti?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
}

function base64UrlEncode(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function timingSafeStringEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function loadOrCreateJwtSecret() {
  if (cachedSecret) {
    return cachedSecret;
  }

  try {
    const existing = fs.readFileSync(JWT_SECRET_FILE, "utf8").trim();
    if (existing.length >= 32) {
      cachedSecret = existing;
      return cachedSecret;
    }
  } catch {
    // Create a new persistent signing secret below.
  }

  cachedSecret = randomBytes(48).toString("base64url");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JWT_SECRET_FILE, cachedSecret, { encoding: "utf8", mode: 0o600 });
  return cachedSecret;
}

function signJwt(unsignedToken: string) {
  return base64UrlEncode(createHmac("sha256", loadOrCreateJwtSecret()).update(unsignedToken).digest());
}

function parseJsonPart<T>(part: string): T | null {
  try {
    return JSON.parse(base64UrlDecode(part)) as T;
  } catch {
    return null;
  }
}

export function createAuthJwt(subject: string) {
  const now = Math.floor(Date.now() / 1000);
  const header: JwtHeader = {
    alg: JWT_ALGORITHM,
    typ: JWT_TYPE,
  };
  const payload: JwtPayload = {
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    sub: subject || "web",
    jti: randomUUID(),
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  return `${unsignedToken}.${signJwt(unsignedToken)}`;
}

export function verifyAuthJwt(token: string) {
  const cleanToken = token.trim();
  if (!cleanToken) {
    return false;
  }

  const parts = cleanToken.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return false;
  }

  const [encodedHeader, encodedPayload, submittedSignature] = parts;
  const header = parseJsonPart<JwtHeader>(encodedHeader);
  const payload = parseJsonPart<JwtPayload>(encodedPayload);
  if (!header || !payload) {
    return false;
  }

  if (header.alg !== JWT_ALGORITHM || header.typ !== JWT_TYPE) {
    return false;
  }
  if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE || !payload.sub || !payload.jti) {
    return false;
  }
  if (revokedTokenIds.has(payload.jti)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    return false;
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    return false;
  }

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  return timingSafeStringEqual(submittedSignature, signJwt(unsignedToken));
}

export function revokeAuthJwt(token: string) {
  const payload = parseJsonPart<JwtPayload>(token.split(".")[1] || "");
  if (payload?.jti) {
    revokedTokenIds.add(payload.jti);
  }
}

import type { NextFunction, Request, Response } from "express";
import { isDesktopAuthorizedRequest } from "./desktop-authority";
import { verifyAuthJwt } from "./jwt-auth";
import { getWebSettings } from "./settings";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/safe-mode/unlock",
]);

export function getBearerAuthToken(req: Request) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

export function isHttpJwtAuthRequired() {
  const webSettings = getWebSettings();
  return webSettings.webSafeMode?.enabled === true || Boolean(webSettings.webPassword);
}

function isPublicApiRequest(req: Request) {
  if (PUBLIC_API_PATHS.has(req.path)) {
    return true;
  }
  return req.path.startsWith("/api/channels/") && req.path.endsWith("/webhook");
}

export function isWebSafeModeRequestAuthorized(req: Request, desktopAuthorityToken?: string) {
  if (isDesktopAuthorizedRequest(req, desktopAuthorityToken)) {
    return true;
  }

  if (!isHttpJwtAuthRequired()) {
    return true;
  }

  return verifyAuthJwt(getBearerAuthToken(req));
}

export function requireHttpJwtForApi(desktopAuthorityToken?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/") || isPublicApiRequest(req)) {
      next();
      return;
    }

    if (isWebSafeModeRequestAuthorized(req, desktopAuthorityToken)) {
      next();
      return;
    }

    denySafeModeWebRequest(res);
  };
}

export function denySafeModeWebRequest(res: Response) {
  return res.status(401).json({ error: "Authentication required." });
}

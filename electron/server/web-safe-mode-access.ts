import type { Request, Response } from "express";
import { hasAuthToken } from "./auth-store";
import { isDesktopAuthorizedRequest } from "./desktop-authority";
import { getWebSettings } from "./settings";

export function getBearerAuthToken(req: Request) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

export function isWebSafeModeRequestAuthorized(req: Request, desktopAuthorityToken?: string) {
  if (isDesktopAuthorizedRequest(req, desktopAuthorityToken)) {
    return true;
  }

  const webSafeMode = getWebSettings().webSafeMode;
  if (webSafeMode?.enabled !== true) {
    return true;
  }

  return hasAuthToken(getBearerAuthToken(req));
}

export function denySafeModeWebRequest(res: Response) {
  return res.status(401).json({ error: "Authentication required." });
}

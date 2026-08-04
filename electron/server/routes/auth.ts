import type { Application } from "express";
import { randomBytes } from "node:crypto";
import { addAuthToken, hasAuthToken, removeAuthToken } from "../auth-store";
import { DEFAULT_WEB_SAFE_MODE_SETTINGS, sanitizeWebSafeModeForDesktop } from "../../../src/shared/settings";
import { isDesktopAuthorizedRequest } from "../desktop-authority";
import { getWebSettings, setWebSafeModeState } from "../settings";
import {
  evaluateSafeModeLogin,
  GENERIC_SAFE_MODE_LOGIN_ERROR,
  unlockSafeModeAccount,
} from "../web-safe-mode-auth";
import type { ServerContext } from "./context";

function getBearerToken(value: string | undefined) {
  return (value || "").replace(/^Bearer\s+/i, "").trim();
}

function createSessionToken() {
  return randomBytes(32).toString("hex");
}

async function persistWebSafeModeState(ctx: ServerContext, webSafeMode: ReturnType<typeof unlockSafeModeAccount>) {
  setWebSafeModeState(webSafeMode);
  try {
    await ctx.persistAgentSettings?.({ webSafeMode });
  } catch (error) {
    console.warn("[auth] failed to persist web safe mode state:", error);
  }
}

export function registerAuthRoutes(app: Application, ctx: ServerContext) {
  app.post("/api/auth/login", async (req, res) => {
    const { accountName, account, password } = req.body as {
      accountName?: string;
      account?: string;
      password?: string;
    };
    const webSettings = getWebSettings();
    const webSafeMode = webSettings.webSafeMode;

    if (webSafeMode?.enabled) {
      const evaluation = evaluateSafeModeLogin(webSafeMode, accountName ?? account, password);
      if (evaluation.shouldPersist) {
        await persistWebSafeModeState(ctx, evaluation.nextSettings);
      }
      if (!evaluation.ok) {
        return res.status(401).json({ error: GENERIC_SAFE_MODE_LOGIN_ERROR });
      }
      const token = createSessionToken();
      addAuthToken(token);
      return res.json({ token });
    }

    const expected = webSettings.webPassword || "";
    if (expected && password !== expected) return res.status(401).json({ error: "wrong password" });
    const token = createSessionToken();
    addAuthToken(token);
    return res.json({ token });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getBearerToken(req.headers.authorization);
    removeAuthToken(token);
    res.json({ ok: true });
  });

  app.get("/api/auth/status", (req, res) => {
    const desktopAuthorized = isDesktopAuthorizedRequest(req, ctx.desktopAuthorityToken);
    const webSettings = getWebSettings();
    const safeModeEnabled = webSettings.webSafeMode?.enabled === true;
    const legacyPasswordRequired = !safeModeEnabled && Boolean(webSettings.webPassword);

    if (desktopAuthorized) {
      return res.json({ authenticated: true, safeModeEnabled, legacyPasswordRequired: false });
    }
    if (!safeModeEnabled && !legacyPasswordRequired) {
      return res.json({ authenticated: true, safeModeEnabled: false, legacyPasswordRequired: false });
    }

    const token = getBearerToken(req.headers.authorization);
    return res.json({
      authenticated: hasAuthToken(token),
      safeModeEnabled,
      legacyPasswordRequired,
    });
  });

  app.post("/api/auth/safe-mode/unlock", async (req, res) => {
    if (!isDesktopAuthorizedRequest(req, ctx.desktopAuthorityToken)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const next = unlockSafeModeAccount(getWebSettings().webSafeMode ?? DEFAULT_WEB_SAFE_MODE_SETTINGS);
    await persistWebSafeModeState(ctx, next);
    return res.json({ ok: true, webSafeMode: sanitizeWebSafeModeForDesktop(next) });
  });
}

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repoRoot, "dist-electron/electron/server");

const authCore = await import(pathToFileURL(path.join(distRoot, "web-safe-mode-auth.js")));
const accessCore = await import(pathToFileURL(path.join(distRoot, "web-safe-mode-access.js")));
const settingsCore = await import(pathToFileURL(path.join(distRoot, "settings.js")));
const authRoutes = await import(pathToFileURL(path.join(distRoot, "routes/auth.js")));

const {
  createSafeModePasswordVerifier,
  evaluateSafeModeLogin,
  GENERIC_SAFE_MODE_LOGIN_ERROR,
} = authCore;

const desktopAuthorityToken = "desktop-verification-token";
const chatRouteSource = await fs.readFile(path.join(repoRoot, "electron/server/routes/chat.ts"), "utf8");
const chatPostIndex = chatRouteSource.indexOf('app.post("/api/chat", async');
const chatGateIndex = chatRouteSource.indexOf("isWebSafeModeRequestAuthorized", chatPostIndex);
const chatLoadIndex = chatRouteSource.indexOf("await ensureSessionsLoaded()", chatPostIndex);
const chatSessionCreateIndex = chatRouteSource.indexOf("getSessionsMap().set(sessionId, session)", chatPostIndex);
assert.ok(chatPostIndex >= 0, "chat route handler should exist");
assert.ok(chatGateIndex > chatPostIndex, "chat route should check safe-mode auth");
assert.ok(chatGateIndex < chatLoadIndex, "chat route should deny before loading sessions");
assert.ok(chatGateIndex < chatSessionCreateIndex, "chat route should deny before creating sessions");

const credentials = createSafeModePasswordVerifier("correct-password");
const configured = {
  enabled: true,
  accountName: "owner",
  retryLimit: 1,
  failedAttempts: 0,
  ...credentials,
};

{
  const result = evaluateSafeModeLogin(configured, "other", "wrong-password");
  assert.equal(result.ok, false);
  assert.equal(result.internalOutcome, "wrong_account");
  assert.equal(result.nextSettings.failedAttempts, 0);
  assert.equal(result.shouldPersist, false);
}

{
  const result = evaluateSafeModeLogin(configured, "owner", "wrong-password");
  assert.equal(result.ok, false);
  assert.equal(result.internalOutcome, "wrong_password");
  assert.equal(result.nextSettings.failedAttempts, 1);
  assert.equal(result.nextSettings.lockedAt, undefined);
  assert.equal(result.shouldPersist, true);
}

{
  const onceFailed = evaluateSafeModeLogin(configured, "owner", "wrong-password").nextSettings;
  const locked = evaluateSafeModeLogin(onceFailed, "owner", "wrong-password", "2026-08-04T00:00:00.000Z");
  assert.equal(locked.ok, false);
  assert.equal(locked.nextSettings.failedAttempts, 2);
  assert.equal(locked.nextSettings.lockedAt, "2026-08-04T00:00:00.000Z");

  const correctWhileLocked = evaluateSafeModeLogin(locked.nextSettings, "owner", "correct-password");
  assert.equal(correctWhileLocked.ok, false);
  assert.equal(correctWhileLocked.internalOutcome, "locked");
}

{
  const onceFailed = evaluateSafeModeLogin(configured, "owner", "wrong-password").nextSettings;
  const result = evaluateSafeModeLogin(onceFailed, "owner", "correct-password");
  assert.equal(result.ok, true);
  assert.equal(result.internalOutcome, "success");
  assert.equal(result.nextSettings.failedAttempts, 0);
  assert.equal(result.nextSettings.lockedAt, undefined);
}

settingsCore.mergeWebSettings({
  webSafeMode: {
    enabled: true,
    accountName: "owner",
    retryLimit: 1,
    failedAttempts: 0,
  },
  webSafeModePassword: "correct-password",
});

{
  const desktopRequest = {
    headers: {},
    get: (name) => name.toLowerCase() === "x-nexo-desktop-authority" ? desktopAuthorityToken : "",
  };
  assert.equal(accessCore.isWebSafeModeRequestAuthorized(desktopRequest, desktopAuthorityToken), true);

  const browserRequest = { headers: {}, get: () => "" };
  assert.equal(accessCore.isWebSafeModeRequestAuthorized(browserRequest, desktopAuthorityToken), false);
}

const app = express();
app.use(express.json());
const chatMutations = {
  sessions: new Map(),
  streams: 0,
  runs: 0,
};
const ctx = {
  getStoredApiKey: () => "",
  distPath: repoRoot,
  desktopAuthorityToken,
  persistAgentSettings: async () => undefined,
};
authRoutes.registerAuthRoutes(app, ctx);
app.post("/api/chat", (req, res) => {
  if (!accessCore.isWebSafeModeRequestAuthorized(req, desktopAuthorityToken)) {
    return accessCore.denySafeModeWebRequest(res);
  }
  const { sessionId } = req.body;
  chatMutations.sessions.set(sessionId, { messages: [{ role: "user" }] });
  chatMutations.streams += 1;
  chatMutations.runs += 1;
  return res.json({ requestId: "verified", turnId: "verified-turn" });
});

const server = http.createServer(app);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

async function postJson(pathname, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}

try {
  const wrongAccount = await postJson("/api/auth/login", {
    accountName: "other",
    password: "correct-password",
  });
  assert.equal(wrongAccount.status, 401);
  assert.equal(wrongAccount.data.error, GENERIC_SAFE_MODE_LOGIN_ERROR);

  const wrongPassword = await postJson("/api/auth/login", {
    accountName: "owner",
    password: "wrong-password",
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.data.error, GENERIC_SAFE_MODE_LOGIN_ERROR);

  await postJson("/api/auth/login", {
    accountName: "owner",
    password: "wrong-password",
  });
  const lockedCorrectPassword = await postJson("/api/auth/login", {
    accountName: "owner",
    password: "correct-password",
  });
  assert.equal(lockedCorrectPassword.status, 401);
  assert.equal(lockedCorrectPassword.data.error, GENERIC_SAFE_MODE_LOGIN_ERROR);

  const sessionId = `verify-safe-mode-${Date.now()}`;
  const deniedChat = await postJson("/api/chat", {
    sessionId,
    message: "hello",
    settings: settingsCore.buildRuntimeSettings(),
  });
  assert.equal(deniedChat.status, 401);
  assert.equal(chatMutations.sessions.has(sessionId), false);
  assert.equal(chatMutations.streams, 0);
  assert.equal(chatMutations.runs, 0);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("web safe mode auth verification passed");

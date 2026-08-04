import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { WebSafeModeSettings } from "../../src/shared/types";
import {
  hasConfiguredWebSafeModeCredentials,
  normalizeWebSafeModeSettings,
} from "../../src/shared/settings";

const PASSWORD_VERIFIER_BYTES = 64;

export const GENERIC_SAFE_MODE_LOGIN_ERROR = "Invalid account or password.";

export type SafeModeLoginInternalOutcome =
  | "disabled"
  | "not_configured"
  | "wrong_account"
  | "wrong_password"
  | "locked"
  | "success";

export interface SafeModeLoginEvaluation {
  ok: boolean;
  internalOutcome: SafeModeLoginInternalOutcome;
  nextSettings: WebSafeModeSettings;
  shouldPersist: boolean;
}

function normalizeSubmittedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createSafeModePasswordVerifier(password: string) {
  const cleanPassword = password.trim();
  if (!cleanPassword) {
    throw new Error("Safe mode password is required.");
  }

  const passwordSalt = randomBytes(16).toString("hex");
  const passwordVerifier = scryptSync(cleanPassword, passwordSalt, PASSWORD_VERIFIER_BYTES).toString("hex");
  return { passwordVerifier, passwordSalt };
}

export function validateSafeModePassword(password: unknown, webSafeMode: WebSafeModeSettings) {
  const cleanPassword = normalizeSubmittedText(password);
  const normalized = normalizeWebSafeModeSettings(webSafeMode);
  if (!cleanPassword || !normalized.passwordVerifier || !normalized.passwordSalt) {
    return false;
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(normalized.passwordVerifier, "hex");
  } catch {
    return false;
  }
  if (expected.length <= 0) {
    return false;
  }

  const actual = scryptSync(cleanPassword, normalized.passwordSalt, expected.length);
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function applyWebSafeModeSettingsUpdate(
  current: WebSafeModeSettings,
  incoming: Partial<WebSafeModeSettings> | undefined,
  passwordInput?: unknown,
) {
  const base = normalizeWebSafeModeSettings(current);
  const update = incoming ? normalizeWebSafeModeSettings(incoming) : undefined;
  const cleanPassword = normalizeSubmittedText(passwordInput);
  const accountNameChanged = update ? update.accountName !== base.accountName : false;
  const updateHasVerifier = Boolean(update?.passwordVerifier && update.passwordSalt);

  let next = update
    ? {
        ...base,
        enabled: update.enabled,
        accountName: update.accountName,
        retryLimit: update.retryLimit,
        failedAttempts: update.failedAttempts,
        lockedAt: update.lockedAt,
      }
    : base;

  if (cleanPassword) {
    next = {
      ...next,
      ...createSafeModePasswordVerifier(cleanPassword),
      failedAttempts: 0,
      lockedAt: undefined,
    };
  } else if (update) {
    next = {
      ...next,
      passwordVerifier: updateHasVerifier ? update.passwordVerifier : base.passwordVerifier,
      passwordSalt: updateHasVerifier ? update.passwordSalt : base.passwordSalt,
      hasPassword: updateHasVerifier || base.hasPassword,
    };
  }

  if (accountNameChanged) {
    next = {
      ...next,
      failedAttempts: 0,
      lockedAt: undefined,
    };
  }

  next = normalizeWebSafeModeSettings(next);
  if (next.enabled && !hasConfiguredWebSafeModeCredentials(next)) {
    throw new Error("Account name and password are required to enable web safe mode.");
  }

  return next;
}

export function evaluateSafeModeLogin(
  webSafeMode: WebSafeModeSettings,
  accountName: unknown,
  password: unknown,
  nowIso = new Date().toISOString(),
): SafeModeLoginEvaluation {
  const current = normalizeWebSafeModeSettings(webSafeMode);
  if (!current.enabled) {
    return { ok: true, internalOutcome: "disabled", nextSettings: current, shouldPersist: false };
  }
  if (!hasConfiguredWebSafeModeCredentials(current)) {
    return { ok: false, internalOutcome: "not_configured", nextSettings: current, shouldPersist: false };
  }

  const submittedAccount = normalizeSubmittedText(accountName);
  if (current.lockedAt) {
    return { ok: false, internalOutcome: "locked", nextSettings: current, shouldPersist: false };
  }
  if (submittedAccount !== current.accountName) {
    return { ok: false, internalOutcome: "wrong_account", nextSettings: current, shouldPersist: false };
  }
  if (validateSafeModePassword(password, current)) {
    const nextSettings = normalizeWebSafeModeSettings({
      ...current,
      failedAttempts: 0,
      lockedAt: undefined,
    });
    return {
      ok: true,
      internalOutcome: "success",
      nextSettings,
      shouldPersist: current.failedAttempts !== 0 || Boolean(current.lockedAt),
    };
  }

  const failedAttempts = current.failedAttempts + 1;
  const lockedAt = failedAttempts > current.retryLimit ? nowIso : undefined;
  const nextSettings = normalizeWebSafeModeSettings({
    ...current,
    failedAttempts,
    ...(lockedAt ? { lockedAt } : {}),
  });
  return {
    ok: false,
    internalOutcome: "wrong_password",
    nextSettings,
    shouldPersist: true,
  };
}

export function unlockSafeModeAccount(webSafeMode: WebSafeModeSettings) {
  return normalizeWebSafeModeSettings({
    ...webSafeMode,
    failedAttempts: 0,
    lockedAt: undefined,
  });
}

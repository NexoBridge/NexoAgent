import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { DESKTOP_AUTHORITY_HEADER } from "../../src/shared/desktop";

function timingSafeStringEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isDesktopAuthorizedRequest(req: Request, desktopAuthorityToken?: string) {
  if (!desktopAuthorityToken) {
    return false;
  }
  const submitted = req.get(DESKTOP_AUTHORITY_HEADER) || "";
  return Boolean(submitted && timingSafeStringEqual(submitted, desktopAuthorityToken));
}

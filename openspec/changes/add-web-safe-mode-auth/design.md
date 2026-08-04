## Context

See proposal.md for motivation. Current web authentication is a single password check in `/api/auth/login`, backed by `webPassword` in runtime settings. Desktop and web clients share the same backend HTTP API, so a web-only safe mode needs a reliable desktop bypass path instead of relying only on front-end route hiding.

## Goals / Non-Goals

**Goals:**

- Add a dedicated safe-mode credential model with account name, password verifier, retry limit, failed count, and lock state.
- Require browser users to authenticate before web chat access when safe mode is enabled.
- Keep the desktop app usable without entering the web safe-mode account and password.
- Avoid browser-facing responses that reveal whether the submitted account name is correct.
- Let desktop settings unlock a locked safe-mode account.

**Non-Goals:**

- Multi-user account management is out of scope; this change introduces one configured safe-mode account.
- Role-based authorization is out of scope.
- Desktop startup password protection is out of scope.
- Investment, finance, or domain-specific policy logic is unrelated to this change.

## Decisions

### Use a separate `webSafeMode` settings/state object

Add a new persisted object instead of overloading `webPassword`.

Shape:

```ts
webSafeMode: {
  enabled: boolean;
  accountName: string;
  passwordVerifier: string;
  passwordSalt: string;
  retryLimit: number;
  failedAttempts: number;
  lockedAt?: string;
}
```

Rationale: `webPassword` is currently a simple legacy gate. Safe mode has different semantics: account name, retry state, lock state, and desktop unlock.

Alternative considered: extend `webPassword` with account fields. Rejected because it would blur legacy behavior and make rollback/migration harder.

### Store only a password verifier

Hash passwords with Node crypto using a random per-password salt and constant-time verifier comparison. Do not persist plaintext passwords.

Rationale: settings are stored on disk and may be copied into logs or support bundles. A one-way verifier limits exposure.

Alternative considered: Electron `safeStorage`. Rejected as the primary mechanism because the web backend must verify logins without recovering plaintext.

### Add desktop authority for bypass and unlock

Generate an ephemeral desktop authority token in the Electron main process at startup. Expose it only through the preload/IPC desktop API, and have the shared API client attach it as a header for desktop-originated HTTP requests.

Rationale: desktop and web use the same backend. The backend needs a server-verifiable signal that a request came from the trusted desktop renderer.

Alternative considered: infer desktop by host or origin. Rejected because web browsers can run on localhost or the same origin.

### Gate web chat requests in backend middleware

Introduce safe-mode middleware for browser HTTP requests. The middleware allows requests that have a valid desktop authority header. Otherwise, when safe mode is enabled, protected web chat endpoints require a valid safe-mode session token.

Rationale: front-end login screens alone do not protect APIs.

Alternative considered: only block the send button in the web UI. Rejected because direct API calls would bypass it.

### Keep login failures indistinguishable

For browser login attempts, return the same status category and generic message for wrong account, wrong password, and locked account. Internally, increment `failedAttempts` only when the submitted account name matches the configured account and the password is wrong.

Rationale: the user explicitly wants retry counting to start only after the correct account is supplied, while not telling the browser user whether the account was correct.

Alternative considered: report "account locked" after lockout. Rejected because it can reveal that the submitted account is valid.

### Reset failure state only on successful login or desktop unlock

Successful login with the configured account and correct password clears failed attempts. Desktop unlock clears both failed attempts and locked state.

Rationale: this keeps lockout behavior predictable and gives the desktop owner a recovery path.

## Risks / Trade-offs

- Wrong-account attempts do not increment the retry counter -> Attackers can guess account names without consuming retries. Mitigation: preserve generic responses, avoid account hints in UI/API, and allow users to choose non-obvious account names.
- Desktop authority token exposure in the renderer would bypass web safe mode -> Keep it ephemeral, expose only through preload IPC, never persist it, and do not include it in logs.
- Existing `webPassword` users may expect old behavior -> Keep existing behavior when safe mode is disabled, and document that safe mode supersedes `webPassword` for protected web chat access when enabled.
- Lockout state stored in settings can be edited manually -> Treat desktop filesystem access as owner-level authority; desktop unlock remains the supported UI path.

## Migration Plan

1. Add default disabled `webSafeMode` settings/state fields with no configured credentials.
2. Preserve existing `webPassword` behavior while safe mode is disabled.
3. When safe mode is enabled for the first time, require setting account name, password, and retry limit.
4. Rollback by disabling safe mode and leaving existing `webPassword` behavior intact.

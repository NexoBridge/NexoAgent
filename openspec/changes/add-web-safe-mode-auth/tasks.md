## 1. Settings And State

- [x] 1.1 Add shared `webSafeMode` types, defaults, normalization, and sanitized settings handling.
- [x] 1.2 Persist safe-mode account name, password verifier, salt, retry limit, failed-attempt count, and locked timestamp.
- [x] 1.3 Add migration-safe behavior so existing `webPassword` behavior remains unchanged while safe mode is disabled.

## 2. Credential And Lockout Core

- [x] 2.1 Implement password verifier creation and constant-time password validation using Node crypto.
- [x] 2.2 Implement safe-mode login evaluation that distinguishes internal outcomes while returning generic browser-facing failures.
- [x] 2.3 Increment failed attempts only for matching-account wrong-password attempts.
- [x] 2.4 Lock the configured account when matching-account failures exceed the configured retry limit.
- [x] 2.5 Reset failed attempts after successful login and after desktop unlock.

## 3. Desktop Authority And Web Enforcement

- [x] 3.1 Generate an ephemeral desktop authority token in Electron main and expose it only through preload/IPC.
- [x] 3.2 Attach the desktop authority header from the shared API client when running inside the desktop renderer.
- [x] 3.3 Add backend helpers or middleware to identify desktop-authorized requests.
- [x] 3.4 Require safe-mode web session authentication for browser chat requests when safe mode is enabled.
- [x] 3.5 Ensure unauthenticated browser chat requests do not create user messages, sessions, snapshots, streams, or agent runs.
- [x] 3.6 Deny browser unlock attempts without desktop authority.

## 4. Auth Routes And Sessions

- [x] 4.1 Update `/api/auth/login` to accept account and password for safe mode while preserving legacy disabled-safe-mode behavior.
- [x] 4.2 Update `/api/auth/status` to report authenticated state without exposing account correctness or lock state.
- [x] 4.3 Update logout/session-token handling so safe-mode web sessions can be invalidated.
- [x] 4.4 Add desktop-only endpoint or IPC-backed action to unlock the configured safe-mode account.

## 5. User Interface

- [x] 5.1 Add desktop settings controls for enabling safe mode, setting account/password, changing retry limit, and showing locked status.
- [x] 5.2 Add a desktop unlock action that clears locked state and failed-attempt count.
- [x] 5.3 Update the web login screen to collect account and password when safe mode is enabled.
- [x] 5.4 Display only generic web login failure messages that do not reveal account correctness, password correctness, or lock state.
- [x] 5.5 Keep desktop chat usable without safe-mode login prompts.

## 6. Verification

- [x] 6.1 Add unit tests for login evaluation: wrong account does not count, wrong password counts, correct password resets, and lockout denies login.
- [x] 6.2 Add API tests or route-level verification for unauthenticated browser chat denial without session mutation or agent run creation.
- [x] 6.3 Add verification that desktop-authorized chat bypasses web safe-mode login.
- [x] 6.4 Add verification that web responses remain generic across wrong account, wrong password, and locked account cases.
- [x] 6.5 Run `npm run typecheck` and targeted test/verification scripts for the changed auth and chat paths.

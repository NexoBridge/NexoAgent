## Why

The web console can currently be exposed with only a simple password gate, which is not enough when the service is reachable from a browser or local network. A dedicated web-only safe mode should protect chat access with an account/password login, configurable retry limits, and a desktop-side recovery path for locked accounts.

## What Changes

- Add a web-only safe mode that can be enabled from the desktop application.
- When safe mode is enabled for the first time, require setting an account name and password before web access is allowed.
- Require web users to authenticate with the configured account and password before starting or continuing chat interactions.
- Add configurable failed-password retry limits.
- Lock the configured account after the retry limit is exceeded.
- Allow the desktop application to unlock the account and update safe mode settings.
- Keep the desktop app usable without web safe-mode authentication.
- Use generic web login failure responses so users are not told whether the account name or password was incorrect.
- Count failed retries only after the submitted account matches the configured account; submissions with a wrong account name must not increment the retry counter.

## Capabilities

### New Capabilities

- `web-safe-mode-auth`: Web-only safe mode authentication, retry counting, account lockout, and desktop unlock behavior.

### Modified Capabilities

- None.

## Impact

- Affects web authentication routes, chat API access control, persisted settings/state, settings UI, and desktop-only management controls.
- Requires password storage to use a non-reversible verifier rather than plaintext.
- Requires web login responses and chat access denials to avoid account-enumeration leaks.
- Requires desktop UI support for enabling safe mode, configuring retry limits, setting credentials, and unlocking a locked account.

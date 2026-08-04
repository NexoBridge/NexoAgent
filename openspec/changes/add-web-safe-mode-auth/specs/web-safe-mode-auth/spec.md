## Purpose

Defines a web-only safe mode that protects browser access to Nexo Agent with configured credentials, retry limits, account lockout, and desktop-side recovery without blocking the desktop application.

## ADDED Requirements

### Requirement: Web safe mode can be configured from desktop
The system SHALL allow the desktop application to enable or disable web safe mode, set the web account name and password, and configure the failed-password retry limit.

#### Scenario: First enable requires credentials
- **WHEN** a desktop user enables web safe mode without saved safe-mode credentials
- **THEN** the system MUST require an account name, password, and retry limit before safe mode becomes active

#### Scenario: Retry limit can be changed
- **WHEN** a desktop user updates the retry limit while web safe mode is enabled
- **THEN** the system SHALL use the updated retry limit for subsequent matching-account failed password attempts

#### Scenario: Desktop remains usable
- **WHEN** web safe mode is enabled
- **THEN** the desktop application SHALL continue to load and use chat features without requiring the web safe-mode account login

### Requirement: Web users must authenticate before chat
The system SHALL require an authenticated safe-mode web session before browser users can start or continue chat conversations when web safe mode is enabled.

#### Scenario: Authenticated web chat
- **WHEN** a browser user submits the configured account name and correct password
- **THEN** the system SHALL create an authenticated web session that can access chat APIs

#### Scenario: Unauthenticated web chat is denied
- **WHEN** a browser user without an authenticated safe-mode session attempts to send a chat message
- **THEN** the system SHALL deny the chat request without creating a user message or starting an agent run

#### Scenario: Safe mode disabled
- **WHEN** web safe mode is disabled
- **THEN** browser users SHALL be able to use the existing web access behavior without safe-mode account authentication

### Requirement: Failed retry counting only applies to the configured account
The system SHALL count failed password attempts only when the submitted account name matches the configured safe-mode account.

#### Scenario: Wrong account does not count
- **WHEN** a browser login attempt submits an account name that does not match the configured account
- **THEN** the system MUST NOT increment the failed retry counter

#### Scenario: Matching account wrong password counts
- **WHEN** a browser login attempt submits the configured account name with an incorrect password
- **THEN** the system SHALL increment the failed retry counter by one

#### Scenario: Correct password resets counter
- **WHEN** a browser login attempt submits the configured account name with the correct password before the account is locked
- **THEN** the system SHALL reset the failed retry counter and create an authenticated web session

### Requirement: Account lockout is enforced for web login
The system SHALL lock the configured safe-mode account after matching-account failed password attempts exceed the configured retry limit.

#### Scenario: Retry limit exceeded
- **WHEN** matching-account failed password attempts exceed the configured retry limit
- **THEN** the system SHALL mark the configured account as locked and deny further web safe-mode login attempts until desktop unlock occurs

#### Scenario: Locked account blocks correct password
- **WHEN** the configured account is locked and a browser user submits the configured account name with the correct password
- **THEN** the system SHALL deny the login attempt and SHALL NOT create an authenticated web session

### Requirement: Login failures do not reveal account correctness
The system SHALL use generic browser-facing login failure behavior that does not reveal whether the submitted account name matched the configured account.

#### Scenario: Wrong account response is generic
- **WHEN** a browser login attempt submits an incorrect account name
- **THEN** the system SHALL return the same generic failure category used for other safe-mode login failures

#### Scenario: Wrong password response is generic
- **WHEN** a browser login attempt submits the configured account name with an incorrect password
- **THEN** the system SHALL return the same generic failure category used for other safe-mode login failures

#### Scenario: Locked account response is generic
- **WHEN** a browser login attempt is denied because the configured account is locked
- **THEN** the system SHALL NOT reveal in the browser response whether the account name was correct or whether the account is locked

### Requirement: Desktop can unlock the safe-mode account
The system SHALL allow the desktop application to clear the locked state and failed retry counter for the configured safe-mode account.

#### Scenario: Desktop unlock restores web login
- **WHEN** the configured account is locked and a desktop user unlocks it
- **THEN** the system SHALL clear the locked state and failed retry counter so future correct browser login attempts can succeed

#### Scenario: Web cannot unlock
- **WHEN** a browser user attempts to unlock the configured account without desktop authority
- **THEN** the system SHALL deny the unlock operation

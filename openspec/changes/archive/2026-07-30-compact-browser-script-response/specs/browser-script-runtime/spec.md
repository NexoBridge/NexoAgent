## ADDED Requirements

### Requirement: Script response returns only script-owned output
The system SHALL return only `ok` plus the script execution payload for `browser_action.action="script"` so script results are not buried under repeated page snapshots.

#### Scenario: Script response omits repeated page snapshot
- **WHEN** Agent calls `browser_action` with `action="script"`
- **THEN** the tool output SHALL include `ok` and the script result, script cache report, script error, or timeout metadata when present
- **AND** the response SHALL NOT inline the full page `elements`, readable page `text`, browser `history`, or resolver state
- **AND** the response SHALL NOT inline URL/title/loading/navigation metadata unless the script itself returns those values
- **AND** the response SHALL NOT require or expose any parameter that makes the script action return full page state

#### Scenario: Full page state requires snapshot
- **WHEN** Agent needs DOM elements, readable page text, browser history, or resolver state after a script call
- **THEN** the Agent SHALL fetch that state through a separate `browser_action.action="snapshot"` call

#### Scenario: Internal state remains fresh after script response
- **WHEN** a script changes the current page or DOM state
- **THEN** the browser runtime SHALL refresh its internal post-script snapshot before returning
- **AND** subsequent `snapshot`, `resolve`, `click`, `type`, or screenshot actions SHALL operate on the same updated browser session

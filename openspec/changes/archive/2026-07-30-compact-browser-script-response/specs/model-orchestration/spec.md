## ADDED Requirements

### Requirement: Browser script orchestration uses script-owned results
The orchestrator SHALL treat `browser_action.action="script"` as script-output-only and avoid assuming that full page state is present in each script result.

#### Scenario: Script result needs page state after execution
- **WHEN** a script response does not include DOM elements, readable page text, or browser history and the Agent needs that state to continue
- **THEN** the Agent SHALL call `browser_action` with `action="snapshot"`
- **AND** the Agent SHALL NOT repeat the same script solely because the script response omitted unrelated page snapshot data

## MODIFIED Requirements

### Requirement: Bounded script action return payloads
The system SHALL NOT apply application-level character truncation to `browser_action.action="script"` results, script cache values, inspect fallbacks, or replay response bodies. Script authors MAY intentionally return summaries or cache keys, but the runtime SHALL preserve the value it receives unless serialization itself fails.

#### Scenario: Script returns a serializable large value
- **WHEN** `browser_action.action="script"` returns a large JSON-serializable value
- **THEN** the browser runtime SHALL return the complete serialized value in the script result
- **AND** it SHALL NOT replace that value with a fixed-length text preview

#### Scenario: Script returns an unserializable value
- **WHEN** a script result cannot be JSON-serialized
- **THEN** the browser runtime SHALL return an inspect-format representation
- **AND** the inspect fallback SHALL use unlimited string and array lengths at the application level

#### Scenario: Script cache stores a large value
- **WHEN** script cache stores a JSON-serializable large value
- **THEN** the cache entry SHALL preserve the complete JSON value
- **AND** the cache summary SHALL NOT mark the entry as truncated due to a fixed character cap

#### Scenario: Cached request replay returns a large response body
- **WHEN** `scriptCache.replay` receives a large response body
- **THEN** the replay result SHALL include the complete response body returned by `response.text()`
- **AND** the result SHALL NOT include a `bodyTruncated` flag produced by application-level truncation

## ADDED Requirements

### Requirement: Script output overflow is handled by the agent context budget
The browser runtime SHALL return complete script-owned output, and the agent runtime SHALL decide whether the next model call can include that output.

#### Scenario: Complete script output fits the next model call
- **WHEN** a script result is complete and the next prompt remains within the active model input budget
- **THEN** the agent SHALL include the complete script result in the next model call

#### Scenario: Complete script output exceeds the next model call
- **WHEN** a complete script result would cause the next prompt to exceed the active model input budget
- **THEN** the agent SHALL stop with `stopReason="context_overflow"`
- **AND** it SHALL report the budget details rather than asking the browser runtime to truncate the script result

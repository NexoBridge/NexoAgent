## 1. Contract

- [x] 1.1 Remove script state include parameters from the request contract.
- [x] 1.2 Remove script state omission metadata from the response contract.
- [x] 1.3 Document fixed script-only response behavior in tool schema and prompts.

## 2. Runtime

- [x] 2.1 Keep post-script internal snapshot refresh for browser state consistency.
- [x] 2.2 Return only `ok` plus the script execution payload for successful script calls.
- [x] 2.3 Return only `ok` plus the script execution payload for script compile errors, runtime errors, and timeouts.
- [x] 2.4 Require full page state to be fetched with a separate `snapshot` action.

## 3. Output Summary

- [x] 3.1 Keep script summaries focused on script duration, result, error, and cache activity.
- [x] 3.2 Avoid misleading `snapshot elements: 0` summaries for script responses.

## 4. Verification

- [x] 4.1 Verify script output omits full page state without any state include parameter.
- [x] 4.2 Verify bounded output summaries stay focused on script data.

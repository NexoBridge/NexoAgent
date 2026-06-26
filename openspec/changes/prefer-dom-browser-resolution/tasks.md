## 1. DOM Descriptor and Index

- [x] 1.1 Define `BrowserElementDescriptor`, `BrowserResolveCandidate`, and resolver request/response shared types.
- [x] 1.2 Extend snapshot extraction to generate accessible names from aria, labels, title, alt, placeholder, text, and form associations.
- [x] 1.3 Add context fields: nearest heading, form/dialog/toolbar ownership, nearby label text, recent focus/input relation, visibility, enabled state, and viewport bounds.
- [x] 1.4 Maintain an in-memory DOM index keyed by stable snapshot refs and selector metadata.
- [ ] 1.5 Mark the index dirty on navigation, click/type results, scroll, and relevant MutationObserver events.

## 2. Resolver Scoring

- [x] 2.1 Implement exact, contains, fuzzy, and normalized token matching over descriptor text.
- [x] 2.2 Add role/action boosts for common browser tasks such as send, submit, search, login, next, save, cancel, close, and delete.
- [x] 2.3 Add context boosts for current form/dialog/toolbar and recent focused editable element.
- [x] 2.4 Penalize hidden, disabled, offscreen, duplicate, or low-interaction candidates.
- [x] 2.5 Return Top K candidates with confidence, match reasons, and disambiguation metadata.

## 3. `browser_action` API

- [x] 3.1 Add `action: "resolve"` to `BrowserAction` and `nexo/tools.json`.
- [x] 3.2 Add optional `query`, `role`, `limit`, and `minConfidence` parameters.
- [x] 3.3 Implement `browser_action.resolve` in the executor and BrowserManager.
- [x] 3.4 Allow `click` and `type` to accept `query` when `ref` is absent, using resolver confidence gates.
- [x] 3.5 Return clear `needs_disambiguation` results instead of operating when confidence is low or candidates are too close.

## 4. Agent Routing Policy

- [x] 4.1 Update system prompt overlays so browser mode treats DOM resolver results as the primary page perception path.
- [x] 4.2 Update tool descriptions to require `snapshot`/`resolve`/ref-based `click` or `type` before screenshot or vision for ordinary DOM controls.
- [x] 4.3 Require the Agent to explain or internally satisfy a DOM-insufficient condition before invoking vision for browser UI operation.
- [x] 4.4 Keep screenshots available for user-requested capture, visual evidence, image/canvas/chart inspection, and resolver failure fallback.

## 5. MiniLM Semantic Index

- [x] 5.1 Add a local embedding runtime for `all-MiniLM-L6-v2` and define whether the model is bundled or downloaded into a cache directory.
- [x] 5.2 Preload/warm the MiniLM model in the background when browser mode or the first browser action starts.
- [x] 5.3 Generate descriptor text with deterministic rules and embed only descriptor text, not full page content.
- [x] 5.4 Cache descriptor vectors by descriptor text hash and refresh only changed descriptors.
- [x] 5.5 Embed each resolver query and compute normalized cosine similarity against descriptor vectors.
- [x] 5.6 Fuse semantic score with lexical, role, context, visible/enabled, and recency scores.
- [x] 5.7 Return `semanticReady`, `semanticPending`, or degraded-mode metadata when the local model is unavailable or still loading.
- [x] 5.8 Ensure MiniLM similarity alone cannot trigger click/type without role, state, confidence, and ambiguity checks.

## 6. Verification

- [ ] 6.1 Unit test descriptor generation for buttons, links, inputs, labels, aria-labelledby, title, placeholder, and nearby heading context.
- [ ] 6.2 Unit test resolver ranking for `发送`, `搜索`, `登录`, `下一步`, `保存`, and ambiguous duplicate controls.
- [ ] 6.3 Unit test MiniLM semantic matching for fuzzy queries whose exact text is absent from the target element.
- [ ] 6.4 Verify query-based click does not operate when confidence is below threshold or candidates are ambiguous.
- [ ] 6.5 Verify degraded mode still works with rules/lexical matching when MiniLM is loading or unavailable.
- [ ] 6.6 Verify browser-mode prompt/tool guidance prefers resolver over screenshot/vision for ordinary DOM controls.
- [ ] 6.7 Manually verify a compose-email flow: after typing body text, resolving/clicking `发送` uses DOM refs without screenshot or multimodal analysis.

## 1. Tooling and Theme Foundation

- [x] 1.1 Add `sass` to `devDependencies` and verify Vite can import `.scss` files.
- [x] 1.2 Extend `applyThemeCssVars` with any missing `--nexo-*` tokens needed by migrated components (e.g. accent, textSecondary, bubble colors).
- [x] 1.3 Document the inline vs SCSS vs Ant Design decision table in a short comment or README note under `src/components/` (optional one-liner in design is enough for code; keep code self-explanatory).

## 2. Reference Migration — AppLayout

- [x] 2.1 Create `src/components/Layout/index.scss` with BEM root block `app-layout`.
- [x] 2.2 Move static layout, navigation, desktop drag bar, and window-control styles from `AppLayout.tsx` into SCSS using `--nexo-*` variables.
- [x] 2.3 Keep runtime-dependent values inline (`sessionSiderWidth`, active view toggles that are simpler as conditional classNames).
- [x] 2.4 Smoke test dark/light theme and Windows desktop drag bar behavior.

## 3. High-Traffic Components

- [x] 3.1 Migrate `ChatPanel/MessageBubble.tsx` static styles to co-located SCSS; preserve markdown/code bubble presentation.
- [x] 3.2 Migrate `ChatPanel/InputBar.tsx` and `ChatPanel/MessageList.tsx` static styles to co-located SCSS.
- [x] 3.3 Migrate `Settings/index.tsx` static styles to co-located SCSS; keep form-specific dynamic inline values only where needed.

## 4. Secondary Panels (Incremental)

- [x] 4.1 Migrate `SessionList/index.tsx` static styles to SCSS.
- [x] 4.2 Migrate `BrowserWorkbench/index.tsx` static styles to SCSS.
- [x] 4.3 Migrate remaining panel components (`Memory`, `Knowledge`, `Tools`, `Skills`, `Tasks`, `Logs`, `Channels`) opportunistically or in follow-up PRs without blocking this change.

## 5. Guardrails

- [x] 5.1 Ensure `src/index.css` remains limited to global reset, scrollbar, and keyframes only.
- [x] 5.2 Review migrated components for duplicate inline style objects that can be collapsed into shared SCSS modifiers.
- [x] 5.3 Confirm new/edited components follow the layered styling rule for touched code.

## 6. Verification

- [x] 6.1 Run `npm run build`.
- [x] 6.2 Run `npm run typecheck`.
- [x] 6.3 Manual smoke test: theme toggle, session sider resize, chat send/receive, settings navigation, browser workbench open/close.

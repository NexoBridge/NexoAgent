# Nexo Agent

[简体中文](./README.zh-CN.md)

Nexo Agent is a local-first AI agent desktop app and web console. It brings chat, model orchestration, built-in tools, persistent memory, local knowledge, scheduled tasks, and a shared browser session into one workspace.

The project is built with Electron, React, TypeScript, Ant Design, Express, LangChain, SQLite/sql.js, and Vite. The Electron app starts the same local backend used by the web console, so desktop and browser surfaces share sessions, settings, memory, tools, uploads, and runtime state.

## Status

This repository is an active product and agent-runtime workspace. Some surfaces are production-shaped but still evolving. The README describes the current runtime direction and the built-in toolset in `nexo/tools.json`; OpenSpec changes under `openspec/` are the source of truth for in-progress capability contracts.

## Highlights

- Multi-session chat with streaming responses, persisted conversation history, interruption support, and tool-call traces.
- OpenAI-compatible and Anthropic-compatible model orchestration through LangChain.
- Built-in tools for shell commands, model sub-calls, scheduled tasks, persistent memory recall, script memory storage, and shared browser operation.
- AI Browser: a shared Electron browser session for interactive web work, screenshots, DOM-first target resolution, CDP input events, and high-privilege runtime scripts.
- Short-lived browser script cache for temporary capture/replay samples, separate from durable script memory.
- Persistent `daily`, `dream`, and `script` memory in SQLite, with embedding-backed recall when available.
- Local Markdown knowledge base with semantic retrieval when embeddings are configured.
- Token-aware context management, rolling thread compaction, and bounded tool-output handling for large payloads.
- Desktop packaging with electron-builder for Windows, macOS, and Linux.

## Quick Start

### Requirements

- Node.js 22 or a compatible version
- npm
- A model provider endpoint and API key for full agent behavior

### Install

```bash
npm install
```

### Start the Electron App

```bash
npm run dev:electron
```

This starts:

- Vite web dev server at `http://localhost:8106`
- Electron main-process TypeScript watch
- Electron desktop window
- Local Express backend and web console at `http://localhost:9898`

### Start Only the Web Dev Server

```bash
npm run dev:web
```

The Vite server listens on `http://localhost:8106` and proxies `/api` and `/uploads` to `http://localhost:9898`. If you run only `dev:web`, make sure the backend is already running.

### Serve the Built Web Console

```bash
npm run build
npm run serve:web-console
```

Default URL:

```text
http://localhost:9898
```

## Configuration

Open Settings after first launch and configure a model profile.

Common settings:

| Setting | Purpose |
| --- | --- |
| Provider | OpenAI-compatible, Anthropic-compatible, or a configured custom provider |
| API Base URL | Provider endpoint, such as `https://api.openai.com/v1` |
| API Key | Secret used for model calls |
| Model | Chat model name |
| Temperature | Default response randomness |
| Workspace Path | Default root for command and workspace-aware tasks |
| Context Window | Optional override for model context budgeting |
| Reserved Output Tokens | Tokens reserved for the model response |
| Context Compaction Threshold | Message-count threshold for rolling conversation summary |
| Max Tool Steps | Maximum tool-call loop depth per assistant turn |
| Shell Command Timeout | Default timeout for `shell_command` |
| Memory / Knowledge Toggles | Enable or disable recall and local knowledge injection |

Without a configured model API key, the app can still open, but full agent behavior requires a working provider profile.

## Built-In Tools

Built-in tool metadata lives in `nexo/tools.json`; executors live under `electron/server/tools/`.

Default enabled tools:

| Tool | Purpose |
| --- | --- |
| `shell_command` | Run a command in the configured workspace. It is intended for development, inspection, and scripted local workflows. |
| `invoke_model` | Call the default model or a specialist model profile for sub-tasks such as vision, image generation, image editing, speech-to-text, text-to-speech, or embeddings when configured. |
| `create_scheduled_task` | Create a future or recurring prompt task shown in the Tasks panel. |
| `recall_memory` | Search persistent `daily`, `dream`, or `script` memories stored in SQLite. |
| `store_script_memory` | Persist durable script memories, runbooks, replay templates, or repeatable workflow notes. |
| `browser_action` | Operate the shared Electron browser session through one-step browser actions, screenshots, DOM/AX resolution, CDP input, and high-privilege scripts. |

The toolset is intentionally small. Short-lived browser capture data should use `scriptCache`; only stable, reusable workflows should be promoted to `store_script_memory`.

## AI Browser / Shared Browser Runtime

The AI Browser is a conversation-scoped shared Electron browser. It is used by the agent to inspect pages, operate web apps, capture screenshots, and perform browser automation while keeping the user in the same conversation.

Supported `browser_action` operations:

```text
snapshot, resolve, navigate, click, type, scroll, wheel, hover, drag,
key, script, screenshot, refresh, back, forward
```

### One Action Per Call

Each non-script browser action performs one operation and returns updated page state. Multi-step web workflows should be performed as repeated tool calls:

1. `snapshot` or `resolve`
2. `click`
3. inspect returned state
4. `type`, `scroll`, `screenshot`, or the next needed action

This keeps refs fresh and avoids long opaque browser macros.

### DOM-First Target Resolution

For ordinary web controls, Nexo prefers DOM and accessibility evidence over vision. The resolver uses:

- AX tree snapshots
- stable element refs
- stale ref re-resolution
- DOM metadata
- selectors and XPath when explicitly supplied
- coordinate fallback when needed
- CDP-backed input events

Example:

```json
{
  "action": "click",
  "target": { "query": "Submit", "role": "button" },
  "strategy": "auto"
}
```

### High-Privilege Scripts

`browser_action` with `action="script"` runs Electron-side service JavaScript. It has direct access to objects such as:

- `browserView`
- `webContents`
- `cdp`, `rawDebugger`, `sendCommand(...)`, and `cdpSend(...)`
- `scriptCache`
- `browserManager`
- Node/Electron runtime objects such as `require`, `Buffer`, `process`, `console`, and timers

Use this path for explicit BrowserView programming, raw CDP work, request capture, runtime debugging, or reusable page instrumentation. Ordinary clicking and typing should still use normal browser actions.

Script tool output is intentionally narrow: the model-facing tool result contains only `ok` plus the script execution payload. It does not return browser history, element snapshots, page text, URL/title metadata, or resolver state unless the script itself returns those values. If full page state is needed after a script, call `browser_action` with `action="snapshot"`.

### Script Cache

`scriptCache` is a short-lived cache available inside `action="script"`. It is designed for temporary capture and replay samples such as network requests, headers, bodies, response snippets, or debugging records.

Available operations include:

```text
set, get, getEntry, list, delete, clear,
capture, consume, consumeEntry, replay
```

Cache entries have TTL-based expiry. Scripts should actively remove one-time samples with `consume`, `delete`, `clear`, or `replay(..., { deleteAfter: true })` / `replay(..., { deleteOnSuccess: true })`.

## Memory

Nexo stores persistent memories in SQLite under the local data directory.

| Kind | Description |
| --- | --- |
| `daily` | Conversation facts grouped by calendar day |
| `dream` | Consolidated daily memory summaries for longer-term recall |
| `script` | Durable workflow notes, runbooks, scripts, captured replay templates, and reusable process state |

Memory recall can use embeddings when a compatible embedding profile is available. If vector search is unavailable, Nexo falls back to SQLite-backed keyword matching.

Thread compaction is separate from durable memory. Long chats are summarized into a rolling session summary for current-context continuity, while `daily`, `dream`, and `script` memories are cross-session data.

## Knowledge Base

The local knowledge base manages Markdown files and can inject relevant notes into chat context.

It supports:

- browse, create, edit, and delete Markdown notes
- preview rendered Markdown
- semantic retrieval when embeddings are configured
- keyword fallback when embeddings are unavailable

Use it for project rules, runbooks, operating procedures, team context, and other reusable reference material.

## Scheduled Tasks

Scheduled tasks create prompts that run later through Nexo's built-in scheduler. A task can use:

- `cron` for a recurring 5-field cron schedule
- `runAt` for a one-time date/time
- `delayMinutes` for a one-time delayed run

Completed task runs are saved as task sessions for review.

## Local Data

Runtime data is stored outside the repository by default:

```text
%USERPROFILE%/.NexoAgent
```

Common contents:

- settings and model profiles
- sessions
- memory SQLite database
- Chroma or embedding-related local data when enabled
- knowledge files
- managed skills
- scheduled tasks
- uploaded files and generated artifacts
- runtime logs

Do not commit local runtime data.

## Project Layout

```text
nexoAgent/
|-- electron/
|   |-- bootstrap.ts              # Electron bootstrap entry
|   |-- main.ts                   # Desktop window, IPC, local backend startup
|   |-- preload.ts                # Secure renderer bridge
|   |-- memory.ts                 # SQLite memory and recall helpers
|   `-- server/
|       |-- agent.ts              # Agent loop, prompts, tools, context assembly
|       |-- browser-manager.ts    # Shared browser runtime and browser_action backend
|       |-- conversation-context.ts
|       |-- tool-output.ts        # Large tool-output bounding
|       |-- routes/               # HTTP API routes
|       `-- tools/                # Built-in tool executors and registry
|-- src/
|   |-- components/               # React UI panels and layout
|   |-- services/                 # API client layer
|   |-- shared/                   # Shared types, ports, settings
|   |-- store/                    # Client state
|   |-- theme/                    # Theme configuration
|   `-- i18n/                     # UI strings
|-- nexo/
|   |-- tools.json                # Built-in tool metadata
|   |-- skills/                   # Built-in skills
|   `-- models/                   # Local browser resolver model assets
|-- docs/                         # Project documentation
|-- openspec/                     # Capability specs and proposed changes
|-- scripts/                      # Verification and maintenance scripts
|-- assets/                       # Icons and static assets
|-- release/                      # Packaged build output
|-- README.md                     # English-first documentation
`-- README.zh-CN.md               # Simplified Chinese documentation
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev:web` | Start the Vite web dev server |
| `npm run dev:electron` | Start the full Electron development environment |
| `npm run build:web` | Type-check and build the React frontend |
| `npm run build:electron` | Compile Electron main/preload/server code |
| `npm run build` | Build frontend and Electron code |
| `npm run serve:web-console` | Serve the built local web console |
| `npm run preview` | Preview the Vite build output |
| `npm run typecheck` | Run TypeScript checks for frontend and Electron projects |
| `npm run verify:context-management` | Verify rolling context compaction behavior |
| `npm run verify:tool-output-bounds` | Verify large tool-output summarization and raw-output references |
| `npm run verify:browser-action-run` | Verify browser action runtime behavior |
| `npm run verify:provider-embeddings` | Verify provider embedding configuration |
| `npm run verify:memory-recall` | Verify memory recall behavior |
| `npm run verify:multimodal-models` | Verify multimodal model routing |
| `npm run package` | Build icons, build the app, and package with electron-builder |
| `npm run package:win` | Package Windows artifacts |
| `npm run package:mac` | Package macOS artifacts |
| `npm run package:linux` | Package Linux artifacts |

Packaged artifacts are written to:

```text
release/
```

## Ports

Defined in `src/shared/ports.ts`.

| Service | Port | URL |
| --- | --- | --- |
| Vite dev server | `8106` | `http://localhost:8106` |
| Express API / web console | `9898` | `http://localhost:9898` |
| Vite preview | `4173` | `http://localhost:4173` |

## Development Notes

- Agent behavior usually starts in `electron/server/agent.ts`.
- Browser runtime behavior lives mainly in `electron/server/browser-manager.ts`.
- Built-in tools require both metadata in `nexo/tools.json` and an executor in `electron/server/tools/executors.ts`.
- Shared types live in `src/shared/types.ts`.
- Large tool-output behavior lives in `electron/server/tool-output.ts`.
- Context compaction behavior lives in `electron/server/conversation-context.ts`.
- UI chat behavior is mainly in `src/store/chat.ts` and `src/components/ChatPanel/`.
- Capability proposals and requirements should be tracked under `openspec/`.

## Current Boundaries

- Channel configuration screens are not a complete production messaging gateway.
- MCP support is still configuration-oriented; runtime discovery and invocation are not the primary built-in path.
- Knowledge retrieval is local Markdown retrieval, not enterprise RAG with permissions, citations, and advanced ranking.
- Vision, image generation, audio, and embeddings depend on configured model profiles and provider support.
- Browser automation is strongest on DOM-accessible web apps. Canvas-only UIs, cross-origin iframe internals, plugin content, and aggressive anti-automation pages may require screenshots, user confirmation, or site-specific scripts.
- `action="script"` is high privilege and should be reserved for explicit browser-runtime, CDP, capture, replay, or debugging work.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).

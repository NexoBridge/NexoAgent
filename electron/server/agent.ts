import { ChatOpenAI, type ChatOpenAICallOptions } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import {
  getDefaultServiceProviderName,
  normalizeServiceProviderName,
  providerConnectionAllowsEmptyApiKey,
  resolveProviderSdkApiKey,
} from "../../src/shared/providers";
import type { AgentSettings, ChatMessage, ConversationSurface, MessageBlock, ToolCallTrace } from "../../src/shared/types";
import { AI_REQUEST_TIMEOUT_MAX_MS, normalizeAiRequestTimeoutMs } from "../../src/shared/settings";
import { extractAndStore, recallMemory } from "../memory";
import { loadAttachmentContext } from "./attachments";
import { AI_REQUEST_MAX_RETRIES, collectStreamWithAiRequestRetries } from "./ai-retry";
import { circuitBreakerInfoFromDecision, createAgentLoopCircuitBreaker } from "./agent-loop-circuit-breaker";
import { retrieveKnowledgeContext } from "./knowledge";
import { resolveMemoryEmbeddingSettings } from "./memory-embedding";
import { resolveAndPersistModelContextBudget, getEnabledModelCapabilitySummary } from "./model-profiles";
import { resolvePrimaryModelConfig, resolveThinkingRequestConfig } from "./model-runtime";
import { getRunAbortSignal, isRunInterrupted } from "./run-control";
import { serverLog } from "./logger";
import { pushEvent } from "./sse";
import { getWebSettings } from "./settings";
import { getEnabledSkillInstructions } from "./skills";
import { computePromptBudget, trimSectionsToBudget, truncateTextToTokenBudget } from "./token-budget";
import { buildBudgetAwareConversationContext, formatCurrentSessionContextForRecall } from "./conversation-context";
import { normalizeToolOutputForModel, type BoundedToolOutput } from "./tool-output";
import { getAllEnabledToolDefs, toLcTool } from "./tools/registry";
import { extractArtifactsFromToolOutput } from "./tools/multimodal";
import type { ChatAttachment, Session, StreamEvent, ToolDef, ToolExecutionContext } from "./types";
import { decodeHtml, safeParseToolArgs, toErrorLog, toErrorMessage } from "./utils";
import { getWorkspaceRoot } from "./workspace";
import { createSnapshot } from "./snapshot";
import { attachmentToDataUrl } from "./media";
const MISSING_PRIMARY_MODEL_MESSAGE = "No primary model is configured. Go to Settings > Models, create a model, add an API key, and mark it as Primary.";
const MISSING_API_KEY_MESSAGE = "The current primary model does not have an API key configured. Add one in Settings > Models and try again.";
const LOOP_GUARD_FALLBACK_MESSAGE = "\n\nThis run entered a repeated loop, so I stopped here for now. The tool results gathered so far are still available. Send \"continue\" if you want me to keep working from the current results.";
const EMPTY_RESPONSE_FALLBACK_MESSAGE = "I did not produce a valid reply. Please try again, or review the model configuration and retry.";
const USER_INTERRUPTED_FALLBACK_MESSAGE = "Stopped the current run.";
const TOKEN_EVENT_CHUNK_SIZE = 120;
const SDK_NO_TIMEOUT_MS = AI_REQUEST_TIMEOUT_MAX_MS;
const CONTEXT_COMPACTION_NOTICE = [
  "\u5df2\u63a5\u8fd1\u4e0a\u4e0b\u6587\u4e0a\u9650\uff0c\u6211\u5df2\u5c06\u8f83\u65e9\u7684\u5f53\u524d\u4f1a\u8bdd\u5185\u5bb9\u538b\u7f29\u6210\u6458\u8981\uff1b\u63a5\u4e0b\u6765\u4f1a\u7ee7\u7eed\u57fa\u4e8e\u538b\u7f29\u6458\u8981\u3001\u5f53\u524d\u4f1a\u8bdd\u5c3e\u90e8\u548c\u957f\u671f\u8bb0\u5fc6\u5de5\u4f5c\u3002",
  "",
  "---",
  "",
].join("\n");

function buildDoneEvent(
  requestId: string,
  event: Extract<StreamEvent, { type: "done" }>
): Extract<StreamEvent, { type: "done" }> {
  pushEvent(requestId, event);
  return event;
}

function pushTokenText(requestId: string, content: string) {
  for (let index = 0; index < content.length; index += TOKEN_EVENT_CHUNK_SIZE) {
    pushEvent(requestId, { type: "token", content: content.slice(index, index + TOKEN_EVENT_CHUNK_SIZE) });
  }
}

function interruptedContent(content: string) {
  return content.trim() ? content : USER_INTERRUPTED_FALLBACK_MESSAGE;
}

function formatCapabilitySummary(summary: Awaited<ReturnType<typeof getEnabledModelCapabilitySummary>>) {
  const lines = Object.entries(summary)
    .filter(([, profiles]) => profiles.length > 0)
    .map(([capability, profiles]) => `- ${capability}: ${profiles.join("; ")}`);
  return lines.length ? lines.join("\n") : "No specialist model profiles are configured.";
}

function buildOpenAIThinkingCallOptions(settings: AgentSettings, model: string): Partial<ChatOpenAICallOptions> {
  const thinking = resolveThinkingRequestConfig(settings, model);
  return thinking.openAIReasoningEffort
    ? { reasoningEffort: thinking.openAIReasoningEffort }
    : {};
}

function formatApiBaseForLog(apiBase: string) {
  try {
    const url = new URL(apiBase);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return apiBase.replace(/\/+$/, "");
  }
}

function formatToolNamesForLog(toolCalls: Array<Pick<ToolCallTrace, "name" | "status">>) {
  return toolCalls.length
    ? toolCalls.map((tool) => `${tool.name}:${tool.status}`).join(",")
    : "none";
}

function createLangChainChatModel(
  config: Awaited<ReturnType<typeof resolvePrimaryModelConfig>>,
  apiKey: string,
  settings: AgentSettings,
  overrides: { temperature?: number; maxTokens?: number; streaming?: boolean } = {},
) {
  const temperature = overrides.temperature ?? config.temperature ?? settings.temperature ?? 0.4;
  const timeout = normalizeAiRequestTimeoutMs(settings.aiRequestTimeoutMs) || SDK_NO_TIMEOUT_MS;
  if (config.providerId === "anthropic-compatible") {
    return new ChatAnthropic({
      apiKey,
      model: config.model,
      temperature,
      maxTokens: overrides.maxTokens,
      streaming: overrides.streaming ?? true,
      streamUsage: true,
      maxRetries: AI_REQUEST_MAX_RETRIES,
      clientOptions: { timeout },
      anthropicApiUrl: config.apiBase.replace(/\/v1\/?$/i, ""),
    });
  }

  return new ChatOpenAI({
    apiKey: resolveProviderSdkApiKey(apiKey, {
      providerId: config.providerId,
      providerName: settings.providerName,
      apiBase: config.apiBase,
    }),
    model: config.model,
    temperature,
    maxTokens: overrides.maxTokens,
    timeout,
    configuration: { baseURL: config.apiBase },
    streaming: overrides.streaming ?? true,
    maxRetries: AI_REQUEST_MAX_RETRIES,
  });
}

function messageContentToText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .join("");
}

function buildBrowserSurfacePrompt(surface: ConversationSurface) {
  const common = [
    "Browser capability:",
    "- The shared browser exists to support the current conversation. Do not describe it as a standalone product feature, workbench, or separate agent.",
    "- Use browser_action for interactive web browsing, page inspection, and web app operation in the shared browser session.",
    "- When the user refers to the current page, this page, what is on screen, or a website already opened in the shared browser, use browser_action against that shared session.",
    "- Do not use browser_action as a generic HTTP client, crawler, search API, or file access tool.",
    "- browser_action performs exactly one browser operation per call: use snapshot, resolve, navigate, click, type, scroll, wheel, hover, drag, key, screenshot, refresh, back, or forward. For multi-step workflows, call one action, inspect the returned page state, then choose the next action.",
    "- Use action=\"script\" when the user explicitly asks for raw browser-runtime, raw CDP, BrowserView programming, request capture, runtime debugging, or reusable page instrumentation. It is not the normal path for ordinary clicking, typing, or scrolling.",
    "- action=\"script\" runs in the Electron service/Node host, not inside the webpage DOM. The script receives browserView, webContents, CDP/debugger helpers, browserManager, scriptCache, require, Buffer, process, and args; it cannot use webpage document/window globals directly. To inspect or modify the page DOM, call webContents.executeJavaScript(...) or use CDP through webContents.debugger/cdp.",
    "- The action=\"script\" source is already compiled as the body of an async Electron/Node function. Write top-level await statements and return the final value directly. Do not write an unreturned `(async () => { ... })();`; if you use an async IIFE, write `return await (async () => { ... })();` so the tool waits for it and receives its return value.",
    "- action=\"script\" returns only ok plus the script execution payload. It does not return browser history, elements, page text, or resolver state. Call action=\"snapshot\" next when full page state is needed.",
    "- For request capture tasks such as listening to the user's form submission and replaying it later, action=\"script\" may write its own host/runtime script, including page instrumentation through webContents/CDP when needed. Return compact structured logs with method, URL, headers, body, status, and response snippets.",
    "- action=\"script\" injects scriptCache for short-lived capture samples. Scripts can call scriptCache.set/get/getEntry/list/delete/clear/capture/consume/consumeEntry/replay, and capture-like return values are automatically stored with a TTL.",
    "- Use scriptCache for temporary request logs and replay samples. When a sample has served its one-time purpose, consume/delete it or call replay with deleteAfter/deleteOnSuccess so temporary captures do not linger.",
    "- Large tool outputs are bounded before they enter model context. For action=\"script\", return concise summaries plus scriptCache keys or raw-output references instead of complete history/log/body arrays whenever possible.",
    "- Promote only stable reusable scripts, runbooks, or replay templates to store_script_memory so future sessions can recall them with recall_memory.",
    "- For canvas, 3D model, or map gestures, use snapshot or screenshot to obtain target bounds/coordinates, then use action=\"drag\"/wheel/click. If raw CDP is explicitly required, action=\"script\" should send CDP Input events with already-known coordinates.",
    "- Standard browser control resolution is AX tree plus stable refs with stale re-resolution. That path is browser-only and is used for ordinary browser DOM target resolution, not for memory, knowledge retrieval, or general question answering.",
    "- When a snapshot returns a stable element ref such as e1, use target:{ ref:\"e1\" } for click/type/hover/drag/wheel. Do not put the ref in a description field.",
    "- When a snapshot or selected-element block provides bounds, pass target.bounds with strategy=\"coordinate\" so the runtime can click the element center; do not invent target.x/y from the top-left corner or nearby toolbar area.",
    "- When only an explicit viewport point is available or a semantic click did not affect the page, use target.x and target.y with strategy=\"coordinate\" for click, hover, wheel, or drag.",
    "- Do not use screenshots, vision models, shell_command, PowerShell, or OS-level mouse/keyboard automation to locate or operate ordinary DOM controls when browser_action elements/refs can do it.",
    "- Use screenshot or explicit vision fallback only when the user asks to see the page, visual state matters, strategy requests visionFallback, or DOM evidence is insufficient.",
    "- After click/type/navigation, treat URL, loading, navigation flags, title, text, and elements together as the page state. If navigation changed but text looks transitional, sparse, or stale, do not claim the action failed; request a fresh snapshot or continue from the updated URL.",
    "- Before typing passwords, tokens, payment data, or other sensitive values, confirm that the user explicitly requested that exact action.",
  ];

  const chatOnly = [
    "Chat-only browser posture:",
    "- The user is mainly in the conversation and cannot rely on seeing the browser state.",
    "- Act as an analyst or researcher: use the browser in the background to gather evidence, inspect interactive pages, or complete web workflows, then bring the result back as a self-contained answer.",
    "- Use screenshots when visual state matters, layout must be verified, images/charts are relevant, or the user asks to see/show/inspect the page; screenshot artifacts are attached to the assistant response automatically.",
    "- Do not ask the user to watch the hidden browser. Summarize the relevant page state, what you did, and what remains.",
  ];

  const visibleBrowser = [
    "Visible-browser posture:",
    "- The conversation is embedded beside a browser page that the user can see.",
    "- Act as a browser co-pilot and page operator: prefer direct action on the visible current page for navigation, clicking, typing, searching, form work, comparison, and inspection tasks.",
    "- When asked to press, hover, drag, scroll, or type into a visible labeled or fuzzily described control such as Send, Submit, Search, Save, Next, or Subject, call the matching single browser_action operation with target descriptors and then inspect the returned state before continuing.",
    "- Keep narration short around obvious page actions. After acting, say what changed, what you found, or what input you need next.",
    "- Use screenshots only when the user asks to capture/show/send the page, visual evidence must be preserved in the conversation, or the state cannot be conveyed reliably from the text snapshot.",
    "- If the user says to continue, click, type, search, go back, inspect, or otherwise refers to the visible page, treat the current browser state as primary context.",
  ];

  return [...common, ...(surface === "browser" ? visibleBrowser : chatOnly)].join("\n");
}

function withSettingsAwareToolDefs(tools: ToolDef[], settings: AgentSettings): ToolDef[] {
  return tools.map((tool) => {
    if (tool.name === "shell_command") {
      return {
        ...tool,
        description: [
          tool.description,
          `Default cwd when omitted: ${getWorkspaceRoot(settings)}.`,
          "The command is not stopped by a fixed timeout; it runs until the process exits, fails to start, or the user interrupts the run.",
          "Never run broad recursive scans from drive or system roots (for example Get-ChildItem C:\\\\ -Recurse, find /, or du -sh /) unless the user explicitly asks and you can narrow the path and depth.",
          "Prefer targeted directory listings in the relevant project path with a small depth limit instead of full-disk enumeration.",
          "Git is allowed for inspection and normal workflows, but do not run commands that discard uncommitted work, such as git checkout --, git restore, git reset --hard, or git clean, unless the user explicitly asks to restore, reset, discard, or clean those changes.",
          "When repairing generated file corruption, preserve unrelated user changes and use targeted edits instead of restoring whole files.",
          "Avoid starting long-lived dev servers such as vite, webpack, or npm run dev with shell_command unless the user explicitly wants that process to occupy the current run.",
        ].join(" "),
      };
    }
    if (tool.name === "invoke_model") {
      return {
        ...tool,
        description: [
          tool.description,
          'Use capability="vision" for image analysis, "image_generation" for text-to-image, "image_editing" for image edits, "speech_to_text" for transcription, and "text_to_speech" for spoken audio generation.',
        ].join(" "),
      };
    }
    if (tool.name === "browser_action") {
      return {
        ...tool,
        description: [
          tool.description,
          "Use only for interactive browser navigation, page inspection, and web app control inside the current conversation.",
          "The browser session is shared with the conversation UI; do not present it as a separate standalone product feature.",
          "Do not use it as a general HTTP request tool, search tool, or file access tool.",
          "Each non-script browser_action call performs exactly one browser operation and returns updated page state; for multi-step workflows, call one action at a time and inspect the result before continuing.",
          "Use target descriptors with click, type, resolve, wheel, hover, or drag when you want the browser runtime to resolve natural-language targets through AX tree snapshots, stable refs, stale re-resolution, DOM rules, and CDP-backed input events.",
          "When a tool result gives a stable ref such as e1, call with target:{ref:\"e1\"}; do not put the ref in description or a free-text sentence.",
          "When a snapshot or selected-element block provides bounds, pass target.bounds with strategy=coordinate so the runtime clicks the element center; do not invent target.x/y from a nearby toolbar area.",
          "When only an explicit viewport point is available or a semantic click did not affect the page, use target.x and target.y with strategy=coordinate.",
          "Use action=\"script\" when the user explicitly asks for Electron-side service JavaScript, raw CDP, BrowserView programming, request capture, runtime debugging, or reusable page instrumentation. Ordinary controls should still use click/type/drag/wheel.",
          "action=\"script\" runs in the Electron service/Node host, not inside the webpage DOM. The script receives browserView, webContents, cdp/rawDebugger, browserManager, scriptCache, require, Buffer, process, and args; it cannot directly use page globals such as document or window. To inspect or manipulate the page DOM, call webContents.executeJavaScript(...) or use CDP through webContents.debugger/cdp.",
          "The action=\"script\" source is already compiled as the body of an async Electron/Node function. Write top-level await statements and return the final value directly. Do not write an unreturned `(async () => { ... })();`; if you use an async IIFE, write `return await (async () => { ... })();` so the tool waits for it and receives its return value.",
          "action=script returns only ok plus the script execution payload. It does not return browser history, elements, page text, or resolver state. Call action=snapshot next when full page state is needed.",
          "For request capture tasks such as listening to the user's form submission and replaying it later, action=\"script\" may write its own host/runtime script, including page instrumentation through webContents/CDP when needed. Return compact structured logs with method, URL, headers, body, status, and response snippets.",
          "action=\"script\" injects scriptCache for short-lived capture samples. Scripts can call scriptCache.set/get/getEntry/list/delete/clear/capture/consume/consumeEntry/replay, and capture-like return values are automatically stored with a TTL.",
          "Use scriptCache for temporary request logs and replay samples. When a sample has served its one-time purpose, consume/delete it or call replay with deleteAfter/deleteOnSuccess so temporary captures do not linger.",
          "Large tool outputs are bounded before they enter model context. For action=script, return concise summaries plus scriptCache keys or raw-output references instead of complete history/log/body arrays whenever possible.",
          "Promote only stable reusable scripts, runbooks, or replay templates to store_script_memory; in a later session, call recall_memory before recreating durable workflows.",
          "For canvas, 3D model, or map gestures, use snapshot or screenshot to obtain target bounds/coordinates, then call action=drag/wheel/click. If raw CDP is explicitly required, send CDP Input events through sendCommand/cdpSend with already-known coordinates.",
          "Do not use shell commands, PowerShell, or OS-level mouse/keyboard automation to operate ordinary browser UI controls.",
          "When visual state matters or the user asks to see the current page, call action=screenshot; screenshot artifacts are attached to the assistant response automatically. Vision fallback is allowed only when DOM evidence is insufficient or strategy explicitly asks for it.",
          "Before typing passwords, tokens, or other sensitive values, make sure the user explicitly asked for that action.",
          "If the element reference is stale, request a fresh snapshot before retrying.",
        ].join(" "),
      };
    }
    return tool;
  });
}

function summarizeTerminalToolOutput(name: string, output: string) {
  void name;
  void output;
  return "";
}

function toolArgsParseErrorOutput(toolName: string, error: NonNullable<ReturnType<typeof safeParseToolArgs>["error"]>) {
  return [
    `Error: Invalid JSON arguments for tool '${toolName}'.`,
    error.message,
    `Raw arguments preview: ${error.preview || "(empty)"}`,
    "Retry the same tool call with a valid JSON object. Use quoted property names and ':' between every property name and value.",
  ].join("\n");
}

type BufferedToolCall = {
  key: string;
  id: string;
  name: string;
  args: string;
  index?: number;
};

type ParsedBufferedToolCall = {
  toolCall: BufferedToolCall;
  args: Record<string, unknown>;
  parseError?: ReturnType<typeof safeParseToolArgs>["error"];
};

const DSML_TAG = String.raw`(?:\|\|DSML\|\||\uFF5C\uFF5CDSML\uFF5C\uFF5C|\uFFE5\u7CEFDSML\uFFE5\u7CEF|\u95FF\u6FE1\u7CA3\u7F0D\u64E0SML\u95FF\u6FE1\u7CA3\u7F0D?)`;
const DSML_TOOL_BLOCK_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>([\s\S]*?)<\/\s*${DSML_TAG}tool_calls\s*>`, "g");
const DSML_TOOL_START_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>`);
const DSML_INVOKE_RE = new RegExp(String.raw`<\s*${DSML_TAG}invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\s*${DSML_TAG}invoke\s*>`, "g");
const DSML_PARAMETER_RE = new RegExp(String.raw`<\s*${DSML_TAG}parameter\s+name="([^"]+)"(?:\s+string="([^"]+)")?\s*>([\s\S]*?)<\/\s*${DSML_TAG}parameter\s*>`, "g");
const DSML_ANY_TAG_RE = new RegExp(String.raw`<\/?\s*${DSML_TAG}(?:tool_calls|invoke|parameter)\b[^>]*>`, "g");
const DSML_OPENING_PREFIXES = [
  "<||dsml||tool_calls",
  "<｜｜dsml｜｜tool_calls",
  "<锝滐綔dsml锝滐綔tool_calls",
  "<閿濇粣缍擠sml閿濇粣缍攟tool_calls",
  "<閿濇粣缍擠sml閿濇粣缍tool_calls",
];

function stripDsmlArtifacts(content: string) {
  let visibleText = content;
  DSML_TOOL_BLOCK_RE.lastIndex = 0;
  visibleText = visibleText.replace(DSML_TOOL_BLOCK_RE, "");

  const danglingStart = visibleText.search(DSML_TOOL_START_RE);
  if (danglingStart >= 0) {
    visibleText = visibleText.slice(0, danglingStart);
  }

  DSML_ANY_TAG_RE.lastIndex = 0;
  visibleText = visibleText.replace(DSML_ANY_TAG_RE, "");
  return visibleText;
}

function coerceDsmlParameter(value: string, stringAttr?: string) {
  const decoded = decodeHtml(value).trim();
  if (stringAttr === "true") return decoded;
  if (/^(true|false)$/i.test(decoded)) return decoded.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(decoded)) return Number(decoded);
  if (/^[\[{"]/.test(decoded)) {
    try {
      return JSON.parse(decoded) as unknown;
    } catch {
      return decoded;
    }
  }
  return decoded;
}

function parseDsmlToolCalls(content: string): { visibleText: string; calls: BufferedToolCall[] } {
  const calls: BufferedToolCall[] = [];
  let visibleText = "";
  let cursor = 0;
  DSML_TOOL_BLOCK_RE.lastIndex = 0;

  for (const blockMatch of content.matchAll(DSML_TOOL_BLOCK_RE)) {
    visibleText += content.slice(cursor, blockMatch.index);
    cursor = (blockMatch.index ?? 0) + blockMatch[0].length;
    const block = blockMatch[1] ?? "";
    DSML_INVOKE_RE.lastIndex = 0;
    for (const invokeMatch of block.matchAll(DSML_INVOKE_RE)) {
      const name = invokeMatch[1]?.trim() ?? "";
      const body = invokeMatch[2] ?? "";
      const args: Record<string, unknown> = {};
      DSML_PARAMETER_RE.lastIndex = 0;
      for (const paramMatch of body.matchAll(DSML_PARAMETER_RE)) {
        const paramName = paramMatch[1]?.trim();
        if (!paramName) continue;
        args[paramName] = coerceDsmlParameter(paramMatch[3] ?? "", paramMatch[2]);
      }
      if (name) {
        const id = `dsml_${Date.now()}_${calls.length}`;
        calls.push({ key: id, id, name, args: JSON.stringify(args) });
      }
    }
  }

  visibleText += content.slice(cursor);
  return { visibleText: stripDsmlArtifacts(visibleText), calls };
}

function normalizePotentialDsmlStart(value: string) {
  return value.replace(/^<\s*/, "<").toLowerCase();
}

function isPotentialDsmlStart(value: string) {
  const normalized = normalizePotentialDsmlStart(value);
  if (normalized === "<") return true;
  return DSML_OPENING_PREFIXES.some((opening) => opening.startsWith(normalized) || normalized.startsWith(opening));
}

function findPotentialDsmlStart(value: string) {
  let index = value.indexOf("<");
  while (index >= 0) {
    if (isPotentialDsmlStart(value.slice(index))) return index;
    index = value.indexOf("<", index + 1);
  }
  return -1;
}

function shouldDropDanglingDsml(value: string) {
  const normalized = normalizePotentialDsmlStart(value);
  return normalized.includes("dsml") || DSML_OPENING_PREFIXES.some((opening) => normalized.startsWith(opening));
}

function createDsmlStreamBuffer() {
  let pending = "";

  const drain = (flush: boolean): { visibleText: string; calls: BufferedToolCall[] } => {
    let visibleText = "";
    const calls: BufferedToolCall[] = [];

    while (pending) {
      DSML_TOOL_BLOCK_RE.lastIndex = 0;
      const blockMatch = DSML_TOOL_BLOCK_RE.exec(pending);
      if (blockMatch) {
        visibleText += pending.slice(0, blockMatch.index);
        calls.push(...parseDsmlToolCalls(blockMatch[0]).calls);
        pending = pending.slice(blockMatch.index + blockMatch[0].length);
        continue;
      }

      const potentialStart = findPotentialDsmlStart(pending);
      if (potentialStart >= 0) {
        visibleText += pending.slice(0, potentialStart);
        const held = pending.slice(potentialStart);
        if (flush) {
          if (!shouldDropDanglingDsml(held)) {
            visibleText += held;
          }
          pending = "";
        } else {
          pending = held;
        }
        break;
      }

      visibleText += pending;
      pending = "";
    }

    return { visibleText: stripDsmlArtifacts(visibleText), calls };
  };

  return {
    push(token: string) {
      pending += token;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}

function browserScreenshotAttachmentFromToolResult(
  name: string,
  args: Record<string, unknown>,
  output: string,
): ChatAttachment | null {
  if (name !== "browser_action" || args.action !== "screenshot") return null;
  try {
    const parsed = JSON.parse(output) as {
      artifact?: {
        url?: string;
        name?: string;
        type?: string;
        mimeType?: string;
        size?: number;
      };
    };
    const artifact = parsed.artifact;
    if (!artifact?.url || !artifact.name) return null;
    return {
      url: artifact.url,
      name: artifact.name,
      type: artifact.type === "audio" || artifact.type === "file" ? artifact.type : "image",
      mimeType: artifact.mimeType,
      size: artifact.size,
      source: "generated",
    };
  } catch {
    return null;
  }
}

function generatedAttachmentsFromToolResult(
  name: string,
  args: Record<string, unknown>,
  output: string,
): ChatAttachment[] {
  if (name !== "invoke_model") return [];
  const capability = String(args.capability ?? "").toLowerCase();
  if (capability !== "image_generation" && capability !== "image_editing" && capability !== "text_to_speech") {
    return [];
  }

  return extractArtifactsFromToolOutput(output).map((artifact) => ({
    url: artifact.url,
    name: artifact.name,
    type: artifact.type,
    mimeType: artifact.mimeType,
    size: artifact.size,
    source: "generated",
  }));
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isVisionCapability(args: Record<string, unknown>) {
  const capability = String(args.capability ?? "").toLowerCase();
  return capability === "vision" || capability === "image" || capability === "image_analysis";
}

function looksLikeDomControlLocalization(text: string) {
  const lower = text.toLowerCase();
  const controlWords = [
    "button", "按钮", "控件", "链接", "link", "input", "输入框", "文本框", "菜单", "menu",
    "发送", "写信", "提交", "登录", "搜索", "保存", "下一步", "继续", "send", "submit", "compose", "search", "save", "next",
  ];
  const operationWords = [
    "click", "press", "type", "定位", "找到", "查找", "点击", "按", "输入", "填写", "触发", "operate",
  ];
  const visualWords = [
    "图像", "图片", "照片", "canvas", "chart", "图表", "地图", "视觉检查", "截图给用户", "capture for user",
  ];
  return controlWords.some((word) => lower.includes(word.toLowerCase()))
    && operationWords.some((word) => lower.includes(word.toLowerCase()))
    && !visualWords.some((word) => lower.includes(word.toLowerCase()));
}

function inferResolveQuery(text: string) {
  const candidates = ["写信", "发送", "提交", "搜索", "登录", "保存", "下一步", "继续", "收件人", "主题", "正文"];
  const hit = candidates.find((candidate) => text.includes(candidate));
  if (hit) return ["收件人", "主题", "正文"].includes(hit) ? hit : `${hit}按钮`;
  const quoted = text.match(/["“']([^"”']{1,24})["”']/)?.[1]?.trim();
  return quoted || "目标控件";
}

function browserDomFirstRedirect(
  toolName: string,
  args: Record<string, unknown>,
  contextText: string,
  hasResolveAttempt: boolean,
) {
  const combined = [
    contextText,
    textFromUnknown(args.prompt),
    textFromUnknown(args.system),
    textFromUnknown(args.query),
    textFromUnknown(args.text),
  ].join("\n");
  if (!looksLikeDomControlLocalization(combined) || hasResolveAttempt) return "";

  if (toolName === "browser_action" && args.action === "screenshot") {
    const query = inferResolveQuery(combined);
    return [
      "DOM-first guard: screenshot is not allowed yet for ordinary browser control localization.",
      `Call browser_action with action="click", target:{ query:"${query}", role:"button" }, strategy:"auto" or the matching single type/hover/drag/wheel action instead.`,
      "Use screenshot or vision only after DOM resolution returns weak evidence, strategy explicitly requests visionFallback, or for image/canvas/chart/layout tasks.",
    ].join(" ");
  }

  if (toolName === "invoke_model" && isVisionCapability(args)) {
    const query = inferResolveQuery(combined);
    return [
      "DOM-first guard: vision model calls are not allowed yet for ordinary browser control localization.",
      `Call browser_action with action="click", target:{ query:"${query}", role:"button" }, strategy:"auto" or the matching single type/hover/drag/wheel action instead.`,
      "Use vision only after DOM evidence is insufficient or for genuinely visual content such as images, canvas, charts, or layout inspection.",
    ].join(" ");
  }

  return "";
}

function appendUniqueAttachment(attachments: ChatAttachment[], attachment: ChatAttachment | null) {
  if (!attachment) return;
  if (attachments.some((item) => item.url === attachment.url)) return;
  attachments.push(attachment);
}

function formatAuxiliarySection(title: string, content: string) {
  if (!content.trim()) return "";
  return `${title}:\n${content.trim()}`;
}

function mergeMemoryContext(...contexts: string[]) {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const context of contexts) {
    for (const line of context.split(/\r?\n/)) {
      const normalized = line.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      lines.push(normalized);
    }
  }
  return lines.join("\n");
}

async function buildCurrentUserMultimodalContent(
  content: string,
  attachments: ChatAttachment[] = [],
) {
  const imageAttachments = attachments.filter((attachment) => attachment.type === "image");
  if (!imageAttachments.length) {
    return content;
  }

  const imageParts = await Promise.all(
    imageAttachments.map(async (attachment) => ({
      type: "image_url" as const,
      image_url: {
        url: await attachmentToDataUrl(attachment),
      },
    })),
  );

  return [
    { type: "text" as const, text: content || "Please analyze the attached image." },
    ...imageParts,
  ];
}

export async function streamFromLLM(
  settings: AgentSettings,
  session: Session,
  requestId: string,
  storedApiKey: string,
  attachments: ChatAttachment[] = [],
  turnId: string = "",
  surface: ConversationSurface = "chat",
): Promise<Extract<StreamEvent, { type: "done" }>> {
  const messages = session.messages;
  const webSettings = getWebSettings();
  const fallbackApiKey = settings.apiKey || storedApiKey || webSettings.apiKey || "";
  const fallbackApiBase = (settings.apiBase || webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
  const fallbackModel = settings.model || webSettings.model || "gpt-4o-mini";
  const primaryConfig = await resolvePrimaryModelConfig(
    { ...settings, apiBase: fallbackApiBase, model: fallbackModel, apiKey: fallbackApiKey },
    fallbackApiKey
  );
  const effectiveApiKey = primaryConfig.apiKey || fallbackApiKey;
  const apiBase = primaryConfig.apiBase;
  const requestLogBase = `requestId=${requestId} sessionId=${session.id} turnId=${turnId || ""}`;
  const allowsEmptyPrimaryApiKey = providerConnectionAllowsEmptyApiKey({
    providerId: primaryConfig.providerId,
    providerName: settings.providerName,
    apiBase,
  });

  if (!primaryConfig.model.trim()) {
    serverLog(`ERROR AI run precondition failed ${requestLogBase} reason=missing_primary_model`);
    return buildDoneEvent(requestId, {
      type: "done",
      content: MISSING_PRIMARY_MODEL_MESSAGE,
      status: "failed",
      stopReason: "precondition_failed",
    });
  }

  if (!effectiveApiKey && !allowsEmptyPrimaryApiKey) {
    serverLog(`ERROR AI run precondition failed ${requestLogBase} reason=missing_api_key profile=${primaryConfig.name}`);
    return buildDoneEvent(requestId, {
      type: "done",
      content: primaryConfig.name === "default" ? MISSING_PRIMARY_MODEL_MESSAGE : MISSING_API_KEY_MESSAGE,
      status: "failed",
      stopReason: "precondition_failed",
    });
  }

  const model = primaryConfig.model;
  const openAiThinkingOptions = buildOpenAIThinkingCallOptions(
    {
      ...settings,
      thinkingEnabled: primaryConfig.thinkingEnabled ?? settings.thinkingEnabled,
      thinkingEffort: primaryConfig.thinkingEffort ?? settings.thinkingEffort,
    },
    model,
  );
  const capabilitySummary = await getEnabledModelCapabilitySummary();
  const skillInstructions = await getEnabledSkillInstructions();
  const enabledToolDefs = withSettingsAwareToolDefs(await getAllEnabledToolDefs(), settings);
  const resolvedBudget = await resolveAndPersistModelContextBudget({
    providerId: primaryConfig.providerId,
    model: primaryConfig.model,
    contextWindowTokens: primaryConfig.contextWindowTokens,
    reservedOutputTokens: primaryConfig.reservedOutputTokens,
    autoCompactTokenLimit: primaryConfig.autoCompactTokenLimit,
    compactionTargetRatio: primaryConfig.compactionTargetRatio,
    contextWindowSource: primaryConfig.contextWindowSource as AgentSettings["contextWindowSource"],
    contextWindowSourceDetail: primaryConfig.contextWindowSourceDetail,
    contextWindowResolvedAt: primaryConfig.contextWindowResolvedAt,
  });
  const budgetConfig = computePromptBudget(settings, resolvedBudget, Math.max(512, enabledToolDefs.length * 180));
  const normalizedAiTimeout = normalizeAiRequestTimeoutMs(settings.aiRequestTimeoutMs);
  serverLog(
    [
      `INFO AI run start ${requestLogBase}`,
      `surface=${surface}`,
      `provider=${primaryConfig.providerId}`,
      `profile=${primaryConfig.name}`,
      `model=${primaryConfig.model}`,
      `apiBase=${formatApiBaseForLog(apiBase)}`,
      `aiTimeoutMs=${normalizedAiTimeout}`,
      `sdkTimeoutMs=${normalizedAiTimeout || SDK_NO_TIMEOUT_MS}`,
      `maxRetries=${AI_REQUEST_MAX_RETRIES}`,
      `messages=${messages.length}`,
      `attachments=${attachments.length}`,
      `tools=${enabledToolDefs.length}`,
      `memory=${settings.enableMemory ? "on" : "off"}`,
      `knowledge=${settings.enableKnowledge ? "on" : "off"}`,
      `contextWindow=${budgetConfig.contextWindowTokens}`,
      `maxInput=${budgetConfig.maxInputTokens}`,
    ].join(" "),
  );

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const currentSessionContext = formatCurrentSessionContextForRecall(session);
  const currentSessionMemoryQuery = [
    "Current user message:",
    lastUserMsg,
    "Current-session context, authoritative for resolving omitted references and current targets:",
    currentSessionContext,
  ].filter((part) => part.trim()).join("\n\n");
  const memoryEmbeddingSettings = await resolveMemoryEmbeddingSettings({
    providerId: primaryConfig.providerId,
    providerName: settings.providerName,
    apiKey: effectiveApiKey,
    apiBase,
    model: primaryConfig.model,
    temperature: primaryConfig.temperature,
  });
  let memoryContext = "";
  if (settings.enableMemory) {
    const operationalMemoryQuery = [
      currentSessionMemoryQuery || lastUserMsg,
      "project path workspace root cwd repository location repo folder client admin management console conventions user preferences",
      "项目路径 工作区 根目录 当前项目 仓库 管理端 客户端 项目规范 用户偏好",
    ].join("\n");
    const [taskMemoryContext, operationalMemoryContext] = await Promise.all([
      recallMemory(currentSessionMemoryQuery || lastUserMsg, memoryEmbeddingSettings, undefined, 6),
      recallMemory(operationalMemoryQuery, memoryEmbeddingSettings, undefined, 6),
    ]);
    memoryContext = mergeMemoryContext(taskMemoryContext, operationalMemoryContext);
  }
  const knowledgeContext = settings.enableKnowledge
    ? await retrieveKnowledgeContext(currentSessionMemoryQuery || lastUserMsg, memoryEmbeddingSettings)
    : "";
  const attachmentContext = await loadAttachmentContext(attachments);

  const trimmedAuxiliarySections = trimSectionsToBudget([
    { key: "skills", label: "Enabled skills", content: skillInstructions || "", minTokens: 128 },
    { key: "memory", label: "Relevant memories about the user", content: memoryContext || "", minTokens: 160 },
    { key: "knowledge", label: "Relevant knowledge base notes", content: knowledgeContext || "", minTokens: 160 },
    { key: "attachments", label: "Current user attachments", content: attachmentContext || "", minTokens: 128 },
  ], Math.max(512, Math.floor(budgetConfig.maxInputTokens * 0.28)));

  const auxiliaryPrompt = trimmedAuxiliarySections
    .map((section) => formatAuxiliarySection(section.label, section.content))
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = [
    "You are Nexo Agent, a helpful AI assistant.",
    "Answer in the user's language. Be concise and action-oriented.",
    `Planning mode: ${settings.planningMode}.`,
    "If a tool loop starts repeating the same visible response without producing fresh progress, stop calling tools and give the best final answer from the current results.",
    `Default shell_command cwd when omitted: ${getWorkspaceRoot(settings)}.`,
    "Context priority: current user message and the current session transcript are authoritative for resolving omitted references, targets, surfaces, and project context. Current-session compressed summaries come next. Recalled memories, knowledge notes, and skills are background only; ignore them whenever they conflict with or would change the target implied by the current session.",
    "When the current session established a target such as admin, client, server, management console, or a specific page, keep using that target for follow-up requests unless the user explicitly switches it.",
    "Use tools when they are helpful.",
    "Never claim that you clicked, navigated, refreshed, submitted, requested, queried, read, wrote, ran, verified, or inspected something unless an actual tool result in the current turn or retained context proves it. If no tool was called, describe the next step or limitation instead of reporting it as completed.",
    "When summarizing or continuing from compacted context, distinguish completed tool-backed actions from plans, intentions, assumptions, and user requests.",
    "Tool results may be bounded: a result can contain only a summary/preview plus a raw output reference. Do not assume the complete raw payload is already in context; retrieve or inspect the reference only when the full payload is necessary.",
    "When current user attachments include images, the images are included directly in this model request. Inspect attached images directly and do not call invoke_model just to analyze them.",
    "Never write DSML/XML-like tool call tags in the user-visible response. Use the provided tool-calling interface only.",
    "Use shell_command for terminal tasks, filesystem inspection, and command-line workflows.",
    buildBrowserSurfacePrompt(surface),
    "Never run broad recursive filesystem scans from drive or system roots (for example Get-ChildItem C:\\\\ -Recurse, find /, du -sh /, or tree from C:\\\\ or /) unless the user explicitly requests it and you can narrow the target path and depth.",
    "Prefer targeted listings in the relevant project or workspace directory with a small depth limit instead of full-disk enumeration.",
    "Before setting shell_command.cwd for a known external project, prefer recalled project paths from memory; if the path is missing or stale, verify nearby candidate directories with a narrow listing.",
    "Git may be used for status, diff, log, branch, add, commit, and other non-destructive workflows. Do not run commands that discard uncommitted changes, including git checkout --, git restore, git reset --hard, or git clean, unless the user explicitly asks to restore, reset, discard, or clean those changes.",
    "Before changing files in a dirty worktree, inspect relevant diffs and preserve user edits. To fix generated corruption, apply the smallest targeted patch instead of restoring whole files.",
    "For shell_command: do not rely on timeoutMs. Commands are not stopped by fixed time and should finish by process exit, explicit error, or user interruption.",
    "Avoid starting long-lived dev servers such as vite, webpack, or npm run dev with shell_command unless the user explicitly wants that process to occupy the current run.",
    `Primary model: ${primaryConfig.name} / ${primaryConfig.model}.`,
    `Resolved context budget: window=${budgetConfig.contextWindowTokens}, input=${budgetConfig.maxInputTokens}, compact=${budgetConfig.autoCompactTokenLimit}, source=${resolvedBudget.contextWindowSource ?? "default"}.`,
    "You are the orchestrator. Route specialist work by capability instead of asking the user for a model name.",
    'Use invoke_model with capability="vision" only when you need a separate specialist vision model; use capability="image_generation" for text-to-image, capability="image_editing" for editing existing images, capability="speech_to_text" for transcription, and capability="text_to_speech" for spoken audio generation.',
    "Use invoke_model with a capability when a configured specialist model is better suited for a sub-task.",
    "Use recall_memory when prior durable context could materially improve the answer.",
    `Configured specialist capabilities:\n${formatCapabilitySummary(capabilitySummary)}`,
    ...(auxiliaryPrompt ? [auxiliaryPrompt] : []),
  ].join("\n");

  const summarizeOlderContext = async (transcript: string) => {
    const summaryInstruction = [
      "Summarize the earlier conversation so a new model call can continue with less context.",
      "Preserve user preferences, project constraints, decisions already made, pending tasks, file paths, commands, tool results, errors, attempts, and unfinished work.",
      "Treat tool results as the only proof that a browser action, shell command, file edit, network request, or verification actually happened.",
      "If the transcript only contains a plan, intention, or assistant claim without a corresponding tool result, record it as unverified or planned rather than completed.",
      "Do not invent details or convert planned work into finished work. Keep the summary concise but operational.",
    ].join("\n");

    const summaryLlm = createLangChainChatModel(primaryConfig, effectiveApiKey, settings, {
      temperature: 0,
      maxTokens: 900,
      streaming: false,
    });
    const response = await summaryLlm.invoke([
      new SystemMessage(summaryInstruction),
      new HumanMessage(transcript),
    ], { signal: getRunAbortSignal(requestId) } as any);
    return messageContentToText(response.content).trim() || JSON.stringify(response.content);
  };

  const conversationContext = await buildBudgetAwareConversationContext(
    settings,
    session,
    summarizeOlderContext,
    [
      { key: "system", label: "System prompt", content: systemPrompt },
      ...trimmedAuxiliarySections.map((section) => ({ key: section.key, label: section.label, content: section.content })),
    ],
    budgetConfig
  );
  const currentUserMessageId = [...conversationContext.recentRawMessages]
    .reverse()
    .find((message) => message.role === "user")?.id ?? "";
  const currentUserContent = await buildCurrentUserMultimodalContent(lastUserMsg, attachments);
  const runtimeContentForMessage = (message: ChatMessage) =>
    message.role === "user" && message.id === currentUserMessageId ? currentUserContent : message.content;
  const recentRuntimeMessages: BaseMessage[] = conversationContext.recentRawMessages.map((message) =>
    message.role === "user"
      ? new HumanMessage({ content: runtimeContentForMessage(message) as any })
      : new AIMessage(message.content)
  );

  const lcMessages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...(conversationContext.compactedSummary
      ? [new SystemMessage(`Earlier conversation summary from automatic context compaction:\n${conversationContext.compactedSummary}`)]
      : []),
    ...recentRuntimeMessages,
  ];
  let turnSnapshotCreated = false;
  let fullContent = "";
  const persistentToolCalls: ToolCallTrace[] = [];
  const persistentMessageBlocks: MessageBlock[] = [];
  const appendPersistentText = (content: string) => {
    if (!content) return;
    const last = persistentMessageBlocks[persistentMessageBlocks.length - 1];
    if (last?.type === "text") {
      last.content += content;
    } else {
      persistentMessageBlocks.push({ type: "text", content });
    }
  };
  const emitToken = (content: string) => {
    if (!content) return;
    appendPersistentText(content);
    pushEvent(requestId, { type: "token", content });
  };
  const recordPersistentToolCall = (id: string, name: string, input: unknown) => {
    persistentToolCalls.push({ id, name, input, status: "running" });
    persistentMessageBlocks.push({ type: "tool", id });
  };
  const recordPersistentToolResult = (id: string, boundedOutput: BoundedToolOutput, elapsed: number, isError: boolean) => {
    const existing = persistentToolCalls.find((toolCall) => toolCall.id === id);
    if (existing) {
      existing.output = boundedOutput.displayOutput;
      existing.outputSummary = boundedOutput.outputSummary;
      existing.outputPreview = boundedOutput.outputPreview;
      existing.rawOutput = boundedOutput.rawOutput;
      existing.outputStats = boundedOutput.outputStats;
      existing.elapsed = elapsed;
      existing.status = isError ? "error" : "done";
    }
  };
  const compactionNotice = conversationContext.compacted ? CONTEXT_COMPACTION_NOTICE : "";
  if (compactionNotice) {
    fullContent += compactionNotice;
    emitToken(compactionNotice);
  }

  const llm = createLangChainChatModel(primaryConfig, effectiveApiKey, settings, {
    maxTokens: resolvedBudget.reservedOutputTokens ?? 2048,
    streaming: true,
  });
  const modelCallOptions = primaryConfig.providerId === "openai-compatible" ? openAiThinkingOptions : {};

  const enabledToolMap = new Map(enabledToolDefs.map((tool) => [tool.name, tool]));
  const toolCapableLlm = llm as any;
  const llmRunner = enabledToolDefs.length > 0
    ? toolCapableLlm.bindTools(enabledToolDefs.map(toLcTool), modelCallOptions)
    : toolCapableLlm.withConfig(modelCallOptions);
  const llmNoTools = toolCapableLlm.withConfig(modelCallOptions);
  const toolCtx: ToolExecutionContext = {
    settings,
    apiKey: effectiveApiKey,
    apiBase,
    requestId,
    capabilitySummary,
  };

  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  const assistantAttachments: ChatAttachment[] = [];
  let browserResolveAttempted = false;
  let interruptedByUser = false;
  let breakerInfo: ReturnType<typeof circuitBreakerInfoFromDecision> | undefined;
  const circuitBreaker = settings.circuitBreakerEnabled ? createAgentLoopCircuitBreaker(settings) : null;
  let currentStep = 0;

  try {
    for (let step = 0; ; step++) {
      currentStep = step + 1;
      if (isRunInterrupted(requestId)) {
        interruptedByUser = true;
        break;
      }

      let turnContent = "";
      const toolCallBuffer: BufferedToolCall[] = [];
      const dsmlBuffer = createDsmlStreamBuffer();
      let terminalSummary = "";
      let streamChunks = 0;
      let streamTextChars = 0;
      let streamToolChunks = 0;

      serverLog(`INFO AI stream start ${requestLogBase} step=${currentStep} lcMessages=${lcMessages.length} accumulatedChars=${fullContent.length}`);
      const chunks = await collectStreamWithAiRequestRetries<AIMessageChunk>(() =>
        llmRunner.stream(lcMessages, { signal: getRunAbortSignal(requestId) } as any)
      , {
        label: `AI stream ${requestLogBase} step=${currentStep} model=${model}`,
        shouldRetry: () => !isRunInterrupted(requestId),
      });
      for (const chunk of chunks) {
        streamChunks += 1;
        if (isRunInterrupted(requestId)) {
          interruptedByUser = true;
          break;
        }
        const c = chunk as AIMessageChunk;
        const token = messageContentToText(c.content);
        streamTextChars += token.length;
        if (token) {
          const dsmlChunk = dsmlBuffer.push(token);
          if (dsmlChunk.visibleText) {
            turnContent += dsmlChunk.visibleText;
            fullContent += dsmlChunk.visibleText;
            emitToken(dsmlChunk.visibleText);
          }
          toolCallBuffer.push(...dsmlChunk.calls);
        }
        if (c.tool_call_chunks?.length) {
          streamToolChunks += c.tool_call_chunks.length;
          for (const tc of c.tool_call_chunks) {
            const key = typeof tc.index === "number"
              ? `index:${tc.index}`
              : tc.id
                ? `id:${tc.id}`
                : `fallback:${toolCallBuffer.length}`;
            const existing = toolCallBuffer.find((b) => b.key === key || (tc.id && b.id === tc.id));
            if (existing) {
              existing.id = existing.id || tc.id || "";
              existing.name = existing.name || tc.name || "";
              existing.args += tc.args ?? "";
            } else {
              toolCallBuffer.push({
                key,
                id: tc.id ?? `call_${step}_${toolCallBuffer.length}`,
                name: tc.name ?? "",
                args: tc.args ?? "",
                index: tc.index,
              });
            }
          }
        }
        if (c.usage_metadata) {
          promptTokens = c.usage_metadata.input_tokens;
          completionTokens = c.usage_metadata.output_tokens;
        }
      }
      serverLog(
        `INFO AI stream complete ${requestLogBase} step=${currentStep} chunks=${streamChunks} textChars=${streamTextChars} toolChunks=${streamToolChunks} interrupted=${interruptedByUser}`,
      );

      if (interruptedByUser) break;

      const finalDsmlChunk = dsmlBuffer.flush();
      if (finalDsmlChunk.visibleText) {
        turnContent += finalDsmlChunk.visibleText;
        fullContent += finalDsmlChunk.visibleText;
        emitToken(finalDsmlChunk.visibleText);
      }
      toolCallBuffer.push(...finalDsmlChunk.calls);
      turnContent = stripDsmlArtifacts(turnContent);
      const parsedToolCalls: ParsedBufferedToolCall[] = toolCallBuffer.map((toolCall) => {
        const parsed = safeParseToolArgs(toolCall.args);
        return { toolCall, args: parsed.args, parseError: parsed.error };
      });
      serverLog(
        `INFO AI model turn parsed ${requestLogBase} step=${currentStep} visibleChars=${turnContent.length} toolCalls=${
          parsedToolCalls.length ? parsedToolCalls.map(({ toolCall }) => toolCall.name || "(unnamed)").join(",") : "none"
        } parseErrors=${parsedToolCalls.filter(({ parseError }) => Boolean(parseError)).length}`,
      );

      circuitBreaker?.recordModelTurn({
        step: step + 1,
        visibleText: turnContent,
        toolCalls: parsedToolCalls.map(({ toolCall, args, parseError }) => ({
          name: toolCall.name,
          args: parseError ? { parseError: parseError.message, rawArgsPreview: parseError.preview } : args,
        })),
        usage: { promptTokens, completionTokens },
      });

      if (parsedToolCalls.length === 0) break;

      const aiMsg = new AIMessage({
        content: turnContent,
        tool_calls: parsedToolCalls.map(({ toolCall, args, parseError }) => ({
          id: toolCall.id,
          name: toolCall.name,
          args: parseError ? {} : args,
          type: "tool_call" as const,
        })),
      });
      lcMessages.push(aiMsg);

      // Create snapshot before first tool execution in this turn
      if (!turnSnapshotCreated && turnId) {
        const workspaceRoot = getWorkspaceRoot(settings);
        const hasShellCmd = parsedToolCalls.some(({ toolCall }) => toolCall.name === "shell_command");
        if (hasShellCmd && workspaceRoot) {
          const snapshot = await createSnapshot(session.id, turnId, workspaceRoot).catch(() => null);
          turnSnapshotCreated = Boolean(snapshot);
        }
      }
      for (const { toolCall: tc, args: parsedArgs, parseError } of parsedToolCalls) {
        if (isRunInterrupted(requestId)) {
          interruptedByUser = true;
          break;
        }
        const displayedArgs = parseError
          ? { parseError: parseError.message, rawArgsPreview: parseError.preview }
          : parsedArgs;
        recordPersistentToolCall(tc.id, tc.name, displayedArgs);
        pushEvent(requestId, { type: "tool_call", id: tc.id, name: tc.name, input: displayedArgs });
        serverLog(`INFO Tool start ${requestLogBase} step=${currentStep} tool=${tc.name || "(unnamed)"} id=${tc.id}`);

        const toolFn = enabledToolMap.get(tc.name);
        const t0 = Date.now();
        let output: string;
        if (parseError) {
          output = toolArgsParseErrorOutput(tc.name, parseError);
        } else try {
          const domFirstRedirect = browserDomFirstRedirect(
            tc.name,
            parsedArgs,
            [lastUserMsg, turnContent, fullContent].join("\n"),
            browserResolveAttempted,
          );
          if (domFirstRedirect) {
            output = domFirstRedirect;
          } else {
            output = toolFn
              ? await toolFn.execute(parsedArgs, toolCtx)
              : `Tool is not enabled or unknown: ${tc.name}`;
          }
        } catch (error) {
          output = `Error: ${toErrorMessage(error)}`;
        }
        if (isRunInterrupted(requestId)) {
          interruptedByUser = true;
        }
        if (tc.name === "browser_action" && parsedArgs.action === "resolve") {
          browserResolveAttempted = true;
        }
        const elapsed = (Date.now() - t0) / 1000;
        const rawOutputText = String(output);
        appendUniqueAttachment(
          assistantAttachments,
          browserScreenshotAttachmentFromToolResult(tc.name, parsedArgs, rawOutputText),
        );
        for (const attachment of generatedAttachmentsFromToolResult(tc.name, parsedArgs, rawOutputText)) {
          appendUniqueAttachment(assistantAttachments, attachment);
        }

        const boundedOutput = await normalizeToolOutputForModel({
          toolName: tc.name,
          args: displayedArgs,
          output: rawOutputText,
        });
        const isError = rawOutputText.trim().startsWith("Error:");

        recordPersistentToolResult(tc.id, boundedOutput, elapsed, isError);
        serverLog(
          [
            `${isError ? "WARN" : "INFO"} Tool complete ${requestLogBase}`,
            `step=${currentStep}`,
            `tool=${tc.name || "(unnamed)"}`,
            `id=${tc.id}`,
            `status=${isError ? "error" : "done"}`,
            `elapsed=${elapsed.toFixed(3)}s`,
            `outputChars=${rawOutputText.length}`,
            `truncated=${boundedOutput.outputStats?.truncated ? "yes" : "no"}`,
          ].join(" "),
        );
        pushEvent(requestId, {
          type: "tool_result",
          id: tc.id,
          output: boundedOutput.displayOutput,
          elapsed,
          outputSummary: boundedOutput.outputSummary,
          outputPreview: boundedOutput.outputPreview,
          rawOutput: boundedOutput.rawOutput,
          outputStats: boundedOutput.outputStats,
        });
        circuitBreaker?.recordToolResult({
          name: tc.name,
          args: displayedArgs,
          output: boundedOutput.modelOutput,
          elapsedSeconds: elapsed,
        });
        lcMessages.push(new ToolMessage({
          content: truncateTextToTokenBudget(boundedOutput.modelOutput, Math.max(128, Math.floor(budgetConfig.maxInputTokens * 0.08))),
          tool_call_id: tc.id,
        }));

        const summary = summarizeTerminalToolOutput(tc.name, boundedOutput.modelOutput);
        if (summary) {
          terminalSummary = summary;
        }
      }

      if (interruptedByUser) break;

      if (terminalSummary) {
        const finalToken = `\n\n${terminalSummary}`;
        fullContent += finalToken;
        emitToken(finalToken);
        break;
      }

      const decision = circuitBreaker?.evaluate();
      if (decision?.action === "stop") {
        breakerInfo = circuitBreakerInfoFromDecision(decision);
        break;
      }
    }

    if (!interruptedByUser && breakerInfo) {
      const finalMessages = [
        ...lcMessages,
        new SystemMessage(
          breakerInfo
            ? `The run was stopped by the circuit breaker (${breakerInfo.reason}: ${breakerInfo.detail}). Do not call tools. Based on the available tool results, give the user a concise final response in their language. If work is incomplete, say exactly what remains.`
            : "Do not call tools. Based on the available tool results, give the user a concise final response in their language. If work is incomplete, say exactly what remains."
        ),
      ];
      serverLog(`INFO AI final stream start ${requestLogBase} step=${currentStep} reason=circuit_breaker`);
      const finalChunks = await collectStreamWithAiRequestRetries<AIMessageChunk>(() =>
        llmNoTools.stream(finalMessages, { signal: getRunAbortSignal(requestId) } as any)
      , {
        label: `AI final stream ${requestLogBase} model=${model}`,
        shouldRetry: () => !isRunInterrupted(requestId),
      });
      let finalContent = "";
      let finalStreamChunks = 0;
      let finalStreamTextChars = 0;
      const finalDsmlBuffer = createDsmlStreamBuffer();
      for (const chunk of finalChunks) {
        finalStreamChunks += 1;
        if (isRunInterrupted(requestId)) {
          interruptedByUser = true;
          break;
        }
        const c = chunk as AIMessageChunk;
        const token = messageContentToText(c.content);
        finalStreamTextChars += token.length;
        if (token) {
          const dsmlChunk = finalDsmlBuffer.push(token);
          if (dsmlChunk.visibleText) {
            finalContent += dsmlChunk.visibleText;
            fullContent += dsmlChunk.visibleText;
            emitToken(dsmlChunk.visibleText);
          }
        }
        if (c.usage_metadata) {
          promptTokens = c.usage_metadata.input_tokens;
          completionTokens = c.usage_metadata.output_tokens;
        }
      }
      serverLog(`INFO AI final stream complete ${requestLogBase} chunks=${finalStreamChunks} textChars=${finalStreamTextChars} interrupted=${interruptedByUser}`);
      if (!interruptedByUser) {
        const finalDsmlChunk = finalDsmlBuffer.flush();
        if (finalDsmlChunk.visibleText) {
          finalContent += finalDsmlChunk.visibleText;
          fullContent += finalDsmlChunk.visibleText;
          emitToken(finalDsmlChunk.visibleText);
        }
        finalContent = stripDsmlArtifacts(finalContent);
        if (!finalContent.trim()) {
          fullContent += LOOP_GUARD_FALLBACK_MESSAGE;
          emitToken(LOOP_GUARD_FALLBACK_MESSAGE);
        }
      }
    }
  } catch (error) {
    serverLog(
      [
        `ERROR AI run failed ${requestLogBase}`,
        `step=${currentStep}`,
        `interrupted=${interruptedByUser || isRunInterrupted(requestId)}`,
        `contentChars=${fullContent.length}`,
        `toolCalls=${persistentToolCalls.length}`,
        `tools=${formatToolNamesForLog(persistentToolCalls)}`,
        `error=${toErrorLog(error)}`,
      ].join(" "),
    );
    return buildDoneEvent(requestId, {
      type: "done",
      hasSnapshot: turnSnapshotCreated,
      content: interruptedByUser || isRunInterrupted(requestId) ? interruptedContent(fullContent) : toErrorMessage(error),
      status: interruptedByUser || isRunInterrupted(requestId) ? "interrupted" : "failed",
      stopReason: interruptedByUser || isRunInterrupted(requestId) ? "user_interrupt" : "runtime_error",
      attachments: assistantAttachments.length ? assistantAttachments : undefined,
      toolCalls: persistentToolCalls.length ? persistentToolCalls : undefined,
      messageBlocks: persistentMessageBlocks.length ? persistentMessageBlocks : undefined,
    });
  }

  const doneEvent: Extract<StreamEvent, { type: "done" }> = {
    type: "done",
    hasSnapshot: turnSnapshotCreated,
    content: interruptedByUser
      ? interruptedContent(fullContent)
      : fullContent || EMPTY_RESPONSE_FALLBACK_MESSAGE,
    status: interruptedByUser
      ? "interrupted"
      : breakerInfo
        ? "needs_input"
        : "completed",
    usage: { promptTokens, completionTokens },
    attachments: assistantAttachments.length ? assistantAttachments : undefined,
    toolCalls: persistentToolCalls.length ? persistentToolCalls : undefined,
    messageBlocks: persistentMessageBlocks.length ? persistentMessageBlocks : undefined,
    ...(interruptedByUser
      ? { stopReason: "user_interrupt" as const }
      : breakerInfo
        ? { stopReason: "circuit_breaker" as const, circuitBreaker: breakerInfo }
        : { stopReason: "completed" as const }),
    contextBudget: {
      contextWindowTokens: budgetConfig.contextWindowTokens,
      maxInputTokens: budgetConfig.maxInputTokens,
      autoCompactTokenLimit: budgetConfig.autoCompactTokenLimit,
      estimatedPromptTokens: conversationContext.estimatedPromptTokens,
      source: resolvedBudget.contextWindowSource,
    },
  };
  serverLog(
    [
      `INFO AI run done ${requestLogBase}`,
      `status=${doneEvent.status}`,
      `stopReason=${doneEvent.stopReason ?? ""}`,
      `contentChars=${doneEvent.content.length}`,
      `toolCalls=${persistentToolCalls.length}`,
      `tools=${formatToolNamesForLog(persistentToolCalls)}`,
    ].join(" "),
  );
  return buildDoneEvent(requestId, doneEvent);
}

export async function extractMemoryAfterChat(
  userMessage: string,
  assistantContent: string,
  sessionId: string,
  settings: AgentSettings,
  storedApiKey: string,
  requestId?: string
) {
  const webSettings = getWebSettings();
  const fallbackApiKey = settings.apiKey || storedApiKey || webSettings.apiKey || "";
  const fallbackApiBase = (settings.apiBase || webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
  const fallbackModel = settings.model || webSettings.model || "gpt-4o-mini";
  const primaryConfig = await resolvePrimaryModelConfig(
    { ...settings, apiBase: fallbackApiBase, model: fallbackModel, apiKey: fallbackApiKey },
    fallbackApiKey
  );
  const embeddingProviderName = normalizeServiceProviderName("", primaryConfig.apiBase, primaryConfig.providerId)
    || normalizeServiceProviderName(settings.providerName, primaryConfig.apiBase, primaryConfig.providerId)
    || getDefaultServiceProviderName(primaryConfig.providerId);
  const memoryEmbeddingSettings = await resolveMemoryEmbeddingSettings({
    providerId: primaryConfig.providerId,
    providerName: embeddingProviderName,
    apiKey: primaryConfig.apiKey || fallbackApiKey,
    apiBase: primaryConfig.apiBase,
    model: primaryConfig.model,
    temperature: primaryConfig.temperature,
  });

  const durableMemoryInstruction = [
    "Extract only durable memory candidates.",
    "Prefer stable preferences, recurring workflows, project conventions, and long-lived facts.",
    "Exclude temporary debugging details, one-off command output, transient file paths, and task-local dead ends.",
  ].join("\n");

  await extractAndStore(
    userMessage,
    assistantContent,
    sessionId,
    primaryConfig.apiKey || fallbackApiKey,
    primaryConfig.apiBase,
    async (prompt) => {
      const llm = createLangChainChatModel(primaryConfig, primaryConfig.apiKey || fallbackApiKey, settings, {
        temperature: 0,
        maxTokens: 800,
        streaming: false,
      });
      const res = await llm.invoke([
        new SystemMessage(durableMemoryInstruction),
        new HumanMessage(prompt),
      ], { signal: getRunAbortSignal(requestId) } as any);
      return messageContentToText(res.content);
    },
    {
      model: primaryConfig.model,
      embeddingSettings: memoryEmbeddingSettings,
    }
  );
}

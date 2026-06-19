import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { AgentSettings, ChatMessage } from "../../src/shared/types";
import { recallMemory, extractAndStore } from "../memory";
import { loadAttachmentContext } from "./attachments";
import { retrieveKnowledgeContext } from "./knowledge";
import { getEnabledModelCapabilitySummary } from "./model-profiles";
import { callChatCompletion, resolvePrimaryModelConfig } from "./model-runtime";
import { pushEvent } from "./sse";
import { getWebSettings } from "./settings";
import { getEnabledSkillInstructions } from "./skills";
import type { ChatAttachment, StreamEvent, ToolExecutionContext } from "./types";
import { decodeHtml, parseToolArgs, toErrorMessage } from "./utils";
import { getAllowedFileRoots, getWorkspaceRoot, isPathInsideWorkspace, workspaceBoundaryError } from "./workspace";
import { getEnabledToolDefs, toLcTool } from "./tools/registry";
import type { ToolDef } from "./types";

const FILE_TOOL_NAMES = new Set(["file_read", "file_write"]);

function formatCapabilitySummary(summary: Awaited<ReturnType<typeof getEnabledModelCapabilitySummary>>) {
  const lines = Object.entries(summary)
    .filter(([, profiles]) => profiles.length > 0)
    .map(([capability, profiles]) => `- ${capability}: ${profiles.join("; ")}`);
  return lines.length ? lines.join("\n") : "No specialist model profiles are configured.";
}

function withSettingsAwareToolDefs(tools: ToolDef[], settings: AgentSettings): ToolDef[] {
  const roots = getAllowedFileRoots(settings).join("; ");
  return tools.map((tool) => {
    if (!FILE_TOOL_NAMES.has(tool.name)) {
      if (tool.name === "shell_command") {
        const timeoutSec = Math.round((settings.shellCommandTimeoutMs ?? 300_000) / 1000);
        return {
          ...tool,
          description: [
            tool.description,
            `Configured default timeout: ${timeoutSec}s (${settings.shellCommandTimeoutMs ?? 300_000}ms).`,
            "Omit timeoutMs to use that default.",
            "Never run vite/webpack/npm run dev via shell_command — use build or ask the user to start the dev server.",
          ].join(" "),
        };
      }
      return tool;
    }
    return {
      ...tool,
      description: [
        tool.description,
        `Current allowed roots: ${roots}.`,
        "If the target path is outside these roots, do NOT call this tool — it will always fail and waste a tool step.",
        "Use shell_command for paths outside allowed roots.",
      ].join(" "),
    };
  });
}

function getFileToolPath(args: Record<string, unknown>) {
  const raw = args.path ?? args.file_path;
  return typeof raw === "string" ? raw.trim() : "";
}

function summarizeTerminalToolOutput(name: string, output: string) {
  const cleaned = output.replace(/\r/g, "").trim();
  if (!cleaned || cleaned.startsWith("Error:")) return "";

  const firstLine = cleaned.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (name === "install_skill") {
    const match = firstLine.match(/^Installed skill:\s*(.+?)\s*\((.+?)\)$/i);
    if (!match) return "";
    const marketplace = cleaned.match(/^Marketplace:\s*(.+)$/im)?.[1]?.trim();
    return `已安装：${match[1]}（${match[2]}）${marketplace ? `，来源：${marketplace}` : ""}。`;
  }

  if (name === "create_skill") {
    const match = firstLine.match(/^Saved skill:\s*(.+?)\s*\((.+?)\)$/i);
    if (!match) return "";
    return `已创建：${match[1]}（${match[2]}）。`;
  }

  return "";
}

type BufferedToolCall = {
  key: string;
  id: string;
  name: string;
  args: string;
  index?: number;
};

const DSML_TAG = String.raw`(?:｜｜DSML｜｜|\|\|DSML\|\|)`;
const DSML_TOOL_BLOCK_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>([\s\S]*?)<\/\s*${DSML_TAG}tool_calls\s*>`, "g");
const DSML_TOOL_START_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>`);
const DSML_INVOKE_RE = new RegExp(String.raw`<\s*${DSML_TAG}invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\s*${DSML_TAG}invoke\s*>`, "g");
const DSML_PARAMETER_RE = new RegExp(String.raw`<\s*${DSML_TAG}parameter\s+name="([^"]+)"(?:\s+string="([^"]+)")?\s*>([\s\S]*?)<\/\s*${DSML_TAG}parameter\s*>`, "g");

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
  const danglingStart = visibleText.search(DSML_TOOL_START_RE);
  if (danglingStart >= 0) {
    visibleText = visibleText.slice(0, danglingStart);
  }
  return { visibleText, calls };
}

function normalizePositiveInteger(value: number | undefined, fallback: number, min = 1) {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) ? Math.max(min, normalized) : fallback;
}

function trimForPrompt(text: string, maxChars: number) {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean;
  const half = Math.floor((maxChars - 32) / 2);
  return `${clean.slice(0, half)}\n...[truncated]...\n${clean.slice(-half)}`;
}

function formatMessageForCompaction(message: ChatMessage, index: number) {
  const role = message.role === "assistant" ? "Assistant" : "User";
  const attachmentText = message.attachments?.length
    ? `\nAttachments: ${message.attachments.map((attachment) => `${attachment.name} (${attachment.type}, ${attachment.url})`).join("; ")}`
    : "";
  return `#${index + 1} ${role} at ${message.createdAt}\n${trimForPrompt(message.content, 2400)}${attachmentText}`;
}

function buildCompactionTranscript(messages: ChatMessage[], maxChars = 28_000) {
  const entries = messages.map(formatMessageForCompaction);
  const selected: string[] = [];
  let used = 0;

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    const nextUsed = used + entry.length + 2;
    if (selected.length > 0 && nextUsed > maxChars) break;
    selected.unshift(entry);
    used = nextUsed;
  }

  if (selected.length < entries.length) {
    selected.unshift(`[${entries.length - selected.length} earlier message(s) were omitted before compaction because the transcript was very large.]`);
  }

  return selected.join("\n\n");
}

function fallbackCompactMessages(messages: ChatMessage[]) {
  const transcript = buildCompactionTranscript(messages, 7000);
  return [
    "Automatic summary of earlier conversation:",
    trimForPrompt(transcript, 4000),
  ].join("\n");
}

async function compactOlderMessages(messages: ChatMessage[], summarize: (transcript: string) => Promise<string>) {
  if (messages.length === 0) return "";

  try {
    const transcript = buildCompactionTranscript(messages);
    const content = await summarize(transcript);
    return content || fallbackCompactMessages(messages);
  } catch {
    return fallbackCompactMessages(messages);
  }
}

async function buildConversationContextMessages(
  settings: AgentSettings,
  messages: ChatMessage[],
  summarize: (transcript: string) => Promise<string>
) {
  const conversationMessages = messages.filter((message) => message.role !== "system");
  const recentWindow = normalizePositiveInteger(settings.maxContextTurns, 12);
  const threshold = Math.max(
    recentWindow + 1,
    normalizePositiveInteger(settings.contextCompactionThreshold, 24, 6)
  );
  const shouldCompact = Boolean(settings.enableContextCompaction) && conversationMessages.length > threshold;
  const recentMessages = shouldCompact
    ? conversationMessages.slice(-recentWindow)
    : conversationMessages.slice(-(settings.enableContextCompaction ? threshold : recentWindow));
  const olderMessages = shouldCompact
    ? conversationMessages.slice(0, -recentWindow)
    : [];
  const compactedSummary = shouldCompact ? await compactOlderMessages(olderMessages, summarize) : "";

  return {
    compactedSummary,
    messages: recentMessages.map((message) =>
      message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content)
    ),
  };
}

export async function streamFromLLM(
  settings: AgentSettings,
  messages: ChatMessage[],
  requestId: string,
  storedApiKey: string,
  attachments: ChatAttachment[] = []
): Promise<Extract<StreamEvent, { type: "done" }> | null> {
  const webSettings = getWebSettings();
  const fallbackApiKey = settings.apiKey || storedApiKey || webSettings.apiKey || "";
  const fallbackApiBase = (settings.apiBase || webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
  const fallbackModel = settings.model || webSettings.model || "gpt-4o-mini";
  const primaryConfig = await resolvePrimaryModelConfig(
    { ...settings, apiBase: fallbackApiBase, model: fallbackModel, apiKey: fallbackApiKey },
    fallbackApiKey
  );
  const effectiveApiKey = primaryConfig.apiKey || fallbackApiKey;

  if (!effectiveApiKey) {
    const demo =
      "已收到您的请求。当前未配置 API 密钥，这是演示响应。\n\n请前往**设置**页面配置模型 API 密钥后使用完整功能。";
    for (const char of demo) {
      pushEvent(requestId, { type: "token", content: char });
      await new Promise((r) => setTimeout(r, 12));
    }
    const doneEvent: Extract<StreamEvent, { type: "done" }> = { type: "done", content: demo };
    pushEvent(requestId, doneEvent);
    return doneEvent;
  }

  const apiBase = primaryConfig.apiBase;
  const model = primaryConfig.model;
  const capabilitySummary = await getEnabledModelCapabilitySummary();
  const skillInstructions = await getEnabledSkillInstructions();

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let memoryContext = "";
  if (settings.enableMemory) {
    memoryContext = await recallMemory(lastUserMsg, effectiveApiKey, apiBase);
  }
  const knowledgeContext = settings.enableKnowledge
    ? await retrieveKnowledgeContext(lastUserMsg)
    : "";
  const attachmentContext = await loadAttachmentContext(attachments);

  const systemPrompt = [
    "You are Nexo Agent, a helpful AI assistant.",
    "Answer in the user's language. Be concise and action-oriented.",
    `Planning mode: ${settings.planningMode}. Max steps: ${settings.maxSteps}.`,
    `Workspace root for file tools: ${getWorkspaceRoot(settings)}.`,
    `Allowed file roots: ${getAllowedFileRoots(settings).join("; ")}.`,
    "Tool budget matters: never call file_read or file_write unless you have verified the path is inside allowed roots.",
    "If a path is outside allowed roots, do NOT call file_read/file_write — use shell_command or ask the user to update Settings first.",
    "After one file-tool boundary failure, do not call file_read/file_write again in the same reply.",
    "Use tools when they are helpful. For web_search or http_request, cite useful result links in your answer when available.",
    "Never write DSML/XML-like tool call tags in the user-visible response. Use the provided tool-calling interface only.",
    "Use shell_command for terminal tasks and for listing or inspecting paths outside the workspace.",
    "For shell_command: omit timeoutMs to use the configured default script timeout (Settings). Do not pass timeoutMs: 6000 or other short values for npm install, build, or dev commands.",
    "Never use shell_command to start vite, webpack, or npm run dev — those processes do not exit and will block until timeout.",
    `Primary model: ${primaryConfig.name} / ${primaryConfig.model}.`,
    "You are the orchestrator. Route specialist work by capability instead of asking the user for a model name.",
    "Use analyze_image for image recognition or visual question answering.",
    "Use generate_image for text-to-image requests and edit_image when the user wants to modify an existing image.",
    "Use transcribe_audio for speech-to-text and synthesize_speech for text-to-speech.",
    "Use invoke_model with a capability when a configured specialist model is better suited for a non-media sub-task.",
    `Configured specialist capabilities:\n${formatCapabilitySummary(capabilitySummary)}`,
    "For file_write, only write files when the user explicitly asks you to create or modify files.",
    "When the user wants to create, search, or install a skill, prefer the dedicated search_skills, install_skill, and create_skill tools instead of sending them to the Skills page UI.",
    "When the user asks to find a skill, treat internet skill marketplaces as the default search surface unless they explicitly ask for local-only skills.",
    ...(skillInstructions ? [`\nEnabled skills:\n${skillInstructions}`] : []),
    ...(memoryContext ? [`\nRelevant memories about the user:\n${memoryContext}`] : []),
    ...(knowledgeContext ? [`\nRelevant knowledge base notes:\n${knowledgeContext}`] : []),
    ...(attachmentContext ? [`\nCurrent user attachments:\n${attachmentContext}`] : []),
  ].join("\n");

  const summarizeOlderContext = async (transcript: string) => {
    const summaryInstruction = [
      "Summarize the earlier conversation so a new model call can continue with less context.",
      "Preserve user preferences, project constraints, decisions already made, pending tasks, file paths, commands/results, errors, and any commitments.",
      "Do not invent details. Keep the summary concise but operational.",
    ].join("\n");

    if (primaryConfig.providerId === "anthropic-compatible") {
      const result = await callChatCompletion(primaryConfig, [
        { role: "system", content: summaryInstruction },
        { role: "user", content: transcript },
      ], { temperature: 0, maxTokens: 900 });
      return result.content;
    }

    const summaryLlm = new ChatOpenAI({
      apiKey: effectiveApiKey,
      model,
      temperature: 0,
      configuration: { baseURL: apiBase },
    });
    const response = await summaryLlm.invoke([
      new SystemMessage(summaryInstruction),
      new HumanMessage(transcript),
    ]);
    return typeof response.content === "string" ? response.content.trim() : JSON.stringify(response.content);
  };

  const conversationContext = await buildConversationContextMessages(settings, messages, summarizeOlderContext);

  const lcMessages = [
    new SystemMessage(systemPrompt),
    ...(conversationContext.compactedSummary
      ? [new SystemMessage(`Earlier conversation summary from automatic context compaction:\n${conversationContext.compactedSummary}`)]
      : []),
    ...conversationContext.messages,
  ];

  if (primaryConfig.providerId === "anthropic-compatible") {
    try {
      const result = await callChatCompletion(primaryConfig, [
        { role: "system", content: systemPrompt },
        ...(conversationContext.compactedSummary
          ? [{ role: "system" as const, content: `Earlier conversation summary from automatic context compaction:\n${conversationContext.compactedSummary}` }]
          : []),
        ...messages
          .filter((message) => message.role !== "system")
          .slice(-(settings.maxContextTurns ?? 12))
          .map((message) => ({
            role: message.role === "assistant" ? "assistant" as const : "user" as const,
            content: message.content,
          })),
      ], { temperature: primaryConfig.temperature ?? settings.temperature ?? 0.4, maxTokens: 2048 });
      for (const char of result.content) {
        pushEvent(requestId, { type: "token", content: char });
      }
      const doneEvent: Extract<StreamEvent, { type: "done" }> = {
        type: "done",
        content: result.content,
        usage: {
          promptTokens: result.usage?.prompt_tokens,
          completionTokens: result.usage?.completion_tokens,
        },
      };
      pushEvent(requestId, doneEvent);
      return doneEvent;
    } catch (error) {
      pushEvent(requestId, { type: "error", message: toErrorMessage(error) });
      return null;
    }
  }

  const llm = new ChatOpenAI({
    apiKey: effectiveApiKey,
    model,
    temperature: primaryConfig.temperature ?? settings.temperature ?? 0.4,
    configuration: { baseURL: apiBase },
    streaming: true,
  });

  const enabledToolDefs = withSettingsAwareToolDefs(getEnabledToolDefs(), settings);
  const enabledToolMap = new Map(enabledToolDefs.map((tool) => [tool.name, tool]));
  const llmRunner = enabledToolDefs.length > 0
    ? llm.bindTools(enabledToolDefs.map(toLcTool))
    : llm;
  const toolCtx: ToolExecutionContext = {
    settings,
    apiKey: effectiveApiKey,
    apiBase,
    capabilitySummary,
  };

  let fullContent = "";
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  const maxSteps = settings.maxSteps ?? 20;
  let reachedToolStepLimit = false;
  let fileToolsBlocked = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      let turnContent = "";
      let rawTurnContent = "";
      const toolCallBuffer: BufferedToolCall[] = [];
      let terminalSummary = "";

      const stream = await llmRunner.stream(lcMessages);
      for await (const chunk of stream) {
        const c = chunk as AIMessageChunk;
        const token = typeof c.content === "string" ? c.content : "";
        if (token) {
          rawTurnContent += token;
        }
        if (c.tool_call_chunks?.length) {
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

      const parsedDsml = parseDsmlToolCalls(rawTurnContent);
      turnContent = parsedDsml.visibleText;
      if (turnContent) {
        fullContent += turnContent;
        pushEvent(requestId, { type: "token", content: turnContent });
      }
      toolCallBuffer.push(...parsedDsml.calls);

      if (toolCallBuffer.length === 0) break;

      const aiMsg = new AIMessage({
        content: turnContent,
        tool_calls: toolCallBuffer.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: parseToolArgs(tc.args),
          type: "tool_call" as const,
        })),
      });
      lcMessages.push(aiMsg);

      for (const tc of toolCallBuffer) {
        const parsedArgs = parseToolArgs(tc.args);

        pushEvent(requestId, { type: "tool_call", id: tc.id, name: tc.name, input: parsedArgs });

        const toolFn = enabledToolMap.get(tc.name);
        const t0 = Date.now();
        let output: string;
        try {
          if (FILE_TOOL_NAMES.has(tc.name)) {
            if (fileToolsBlocked) {
              output = [
                "[BLOCKED] file_read/file_write skipped to avoid wasting tool steps.",
                "A previous file-tool call already failed the workspace boundary check in this reply.",
                "Use shell_command instead, or ask the user to add the folder in Settings.",
              ].join(" ");
            } else {
              const requestedPath = getFileToolPath(parsedArgs);
              if (!requestedPath) {
                output = "Error: Missing required argument: path";
              } else if (!isPathInsideWorkspace(requestedPath, settings)) {
                output = workspaceBoundaryError(requestedPath, settings);
                fileToolsBlocked = true;
              } else {
                output = toolFn
                  ? await toolFn.execute(parsedArgs, toolCtx)
                  : `Tool is not enabled or unknown: ${tc.name}`;
              }
            }
          } else {
            output = toolFn
              ? await toolFn.execute(parsedArgs, toolCtx)
              : `Tool is not enabled or unknown: ${tc.name}`;
          }
        } catch (error) {
          output = `Error: ${toErrorMessage(error)}`;
          if (FILE_TOOL_NAMES.has(tc.name) && output.includes("outside allowed file roots")) {
            fileToolsBlocked = true;
          }
        }
        const elapsed = (Date.now() - t0) / 1000;

        pushEvent(requestId, { type: "tool_result", id: tc.id, output: String(output), elapsed });
        lcMessages.push(new ToolMessage({ content: String(output), tool_call_id: tc.id }));

        const summary = summarizeTerminalToolOutput(tc.name, String(output));
        if (summary) {
          terminalSummary = summary;
        }
      }

      if (terminalSummary) {
        const finalToken = `\n\n${terminalSummary}`;
        fullContent += finalToken;
        pushEvent(requestId, { type: "token", content: finalToken });
        break;
      }

      if (step === maxSteps - 1) {
        reachedToolStepLimit = true;
      }
    }

    if (reachedToolStepLimit) {
      const finalStream = await llm.stream([
        ...lcMessages,
        new SystemMessage(
          "The tool step limit has been reached. Do not call tools. Based on the available tool results, give the user a concise final response in their language. If work is incomplete, say exactly what remains."
        ),
      ]);
      let finalContent = "";
      let rawFinalContent = "";
      for await (const chunk of finalStream) {
        const c = chunk as AIMessageChunk;
        const token = typeof c.content === "string" ? c.content : "";
        if (token) {
          rawFinalContent += token;
        }
        if (c.usage_metadata) {
          promptTokens = c.usage_metadata.input_tokens;
          completionTokens = c.usage_metadata.output_tokens;
        }
      }
      finalContent = parseDsmlToolCalls(rawFinalContent).visibleText;
      if (finalContent) {
        fullContent += finalContent;
        pushEvent(requestId, { type: "token", content: finalContent });
      }
      if (!finalContent.trim()) {
        const fallback = "\n\n已达到工具调用步数上限。我已经执行了上面的工具步骤，但还没有拿到模型的最终总结。请继续发送“继续”，我会基于已有结果接着处理。";
        fullContent += fallback;
        pushEvent(requestId, { type: "token", content: fallback });
      }
    }
  } catch (e) {
    pushEvent(requestId, { type: "error", message: String(e) });
    return null;
  }

  const doneEvent: Extract<StreamEvent, { type: "done" }> = {
    type: "done",
    content: fullContent || "我没有生成有效回复。请再发一次，或降低工具步数/切换模型后重试。",
    usage: { promptTokens, completionTokens },
  };
  pushEvent(requestId, doneEvent);
  return doneEvent;
}

export async function extractMemoryAfterChat(
  userMessage: string,
  assistantContent: string,
  sessionId: string,
  settings: AgentSettings,
  storedApiKey: string
) {
  const webSettings = getWebSettings();
  const fallbackApiKey = settings.apiKey || storedApiKey || webSettings.apiKey || "";
  const fallbackApiBase = (settings.apiBase || webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
  const fallbackModel = settings.model || webSettings.model || "gpt-4o-mini";
  const primaryConfig = await resolvePrimaryModelConfig(
    { ...settings, apiBase: fallbackApiBase, model: fallbackModel, apiKey: fallbackApiKey },
    fallbackApiKey
  );

  await extractAndStore(
    userMessage,
    assistantContent,
    sessionId,
    primaryConfig.apiKey || fallbackApiKey,
    primaryConfig.apiBase,
    async (prompt) => {
      if (primaryConfig.providerId === "anthropic-compatible") {
        const res = await callChatCompletion(primaryConfig, [
          { role: "user", content: prompt },
        ], { temperature: 0, maxTokens: 800 });
        return res.content;
      }

      const llm = new ChatOpenAI({
        apiKey: primaryConfig.apiKey || fallbackApiKey,
        model: primaryConfig.model,
        temperature: 0,
        configuration: { baseURL: primaryConfig.apiBase },
      });
      const res = await llm.invoke([new HumanMessage(prompt)]);
      return typeof res.content === "string" ? res.content : "";
    },
    { model: primaryConfig.model }
  );
}

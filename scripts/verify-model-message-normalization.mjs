import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distModulePath = path.join(repoRoot, "dist-electron", "electron", "server", "model-message-normalization.js");

if (!fs.existsSync(distModulePath)) {
  throw new Error("dist-electron/electron/server/model-message-normalization.js not found. Run `tsc -p tsconfig.electron.json` first.");
}

const {
  normalizeBaseMessagesForStrictChatTransports,
  normalizeChatCompletionMessages,
} = await import(pathToFileURL(distModulePath));

const chatMessages = normalizeChatCompletionMessages([
  { role: "system", content: "root instruction" },
  { role: "user", content: "latest user request" },
  { role: "system", content: "dynamic auxiliary context" },
  { role: "assistant", content: "assistant history" },
]);

assert.deepEqual(chatMessages.map((message) => message.role), ["system", "user", "user", "assistant"]);
assert.equal(chatMessages.filter((message) => message.role === "system").length, 1);
assert.equal(chatMessages[0].content, "root instruction");
assert.doesNotMatch(chatMessages[0].content, /dynamic auxiliary context/);
assert.match(chatMessages[2].content, /dynamic auxiliary context/);

const humanMessage = new HumanMessage("hello");
const aiMessage = new AIMessage("assistant turn");
const toolMessage = new ToolMessage({ content: "tool result", tool_call_id: "call_1" });
const baseMessages = normalizeBaseMessagesForStrictChatTransports([
  new SystemMessage("root system"),
  humanMessage,
  new SystemMessage("late system"),
  aiMessage,
  toolMessage,
]);

assert.deepEqual(baseMessages.map((message) => message._getType()), ["system", "human", "human", "ai", "tool"]);
assert.equal(baseMessages[1], humanMessage);
assert.equal(baseMessages[3], aiMessage);
assert.equal(baseMessages[4], toolMessage);
assert.equal(String(baseMessages[0].content), "root system");
assert.doesNotMatch(String(baseMessages[0].content), /late system/);
assert.match(String(baseMessages[2].content), /late system/);

console.log("model message normalization verification passed");

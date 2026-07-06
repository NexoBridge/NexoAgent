import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempDataDir = path.join(repoRoot, ".tmp-verify-tool-output-bounds");
process.env.NEXO_DATA_DIR = tempDataDir;

const distRoot = path.join(repoRoot, "dist-electron", "electron", "server");

async function cleanupTempDataDir() {
  await fs.rm(tempDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

await cleanupTempDataDir();

try {
  const { normalizeToolOutputForModel } = await import(pathToFileURL(path.join(distRoot, "tool-output.js")));

  {
    const output = "small output";
    const bounded = await normalizeToolOutputForModel({
      toolName: "shell_command",
      args: {},
      output,
    });
    assert.equal(bounded.modelOutput, output);
    assert.equal(bounded.displayOutput, output);
    assert.equal(bounded.rawOutput, undefined);
    assert.equal(bounded.outputStats.truncated, false);
  }

  {
    const payload = {
      ok: true,
      action: "script",
      url: "http://127.0.0.1/example",
      title: "Large script result",
      history: Array.from({ length: 180 }, (_, index) => ({
        url: `http://127.0.0.1/page-${index}`,
        title: `Page ${index}`,
        timestamp: new Date(0).toISOString(),
        action: index % 2 === 0 ? "navigate" : "script",
      })),
      elements: [],
      script: {
        durationMs: 42,
        result: {
          format: "json",
          type: "object",
          value: Array.from({ length: 200 }, (_, index) => ({ index, body: "x".repeat(120) })),
        },
      },
    };
    const output = JSON.stringify(payload, null, 2);
    assert.ok(output.length > 8_000);

    const bounded = await normalizeToolOutputForModel({
      toolName: "browser_action",
      args: { action: "script" },
      output,
    });

    assert.ok(bounded.modelOutput.length < output.length);
    assert.ok(bounded.displayOutput.includes("[bounded tool output]"));
    assert.ok(bounded.outputSummary?.includes("history entries: 180"));
    assert.ok(bounded.rawOutput?.url.startsWith("/uploads/generated/tool-output-browser_action-"));
    assert.equal(bounded.rawOutput?.truncated, false);
    assert.equal(bounded.outputStats.truncated, true);

    const relative = bounded.rawOutput.url.replace(/^\/uploads\//, "uploads/");
    const rawPath = path.join(tempDataDir, relative);
    const rawText = await fs.readFile(rawPath, "utf8");
    assert.equal(rawText, output);
  }

  {
    const payload = {
      ok: true,
      url: "http://127.0.0.1/example",
      title: "Compact script result",
      elements: [],
      text: "",
      script: {
        durationMs: 12,
        result: {
          format: "json",
          type: "object",
          value: Array.from({ length: 200 }, (_, index) => ({ index, body: "x".repeat(120) })),
        },
      },
    };
    const output = JSON.stringify(payload, null, 2);
    assert.ok(output.length > 8_000);

    const bounded = await normalizeToolOutputForModel({
      toolName: "browser_action",
      args: { action: "script" },
      output,
    });

    assert.ok(bounded.outputSummary?.includes("script duration: 12ms"));
    assert.ok(bounded.outputSummary?.includes("script result type: object"));
    assert.equal(bounded.outputSummary?.includes("snapshot elements: 0"), false);
  }
} finally {
  await cleanupTempDataDir();
}

console.log("tool output bounds verification passed");

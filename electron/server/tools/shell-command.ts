import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import type { ToolExecutionContext } from "../types";
import { DEFAULT_AGENT_SETTINGS } from "../settings";
import { getWorkspaceRoot, resolveWorkspacePath } from "../workspace";

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 12_000;

function trimOutput(value: string) {
  const normalized = value.replace(/\r/g, "").trim();
  if (normalized.length <= MAX_OUTPUT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated by Nexo]`;
}

function resolveShellTimeoutMs(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const configuredDefault =
    ctx.settings.shellCommandTimeoutMs ?? DEFAULT_AGENT_SETTINGS.shellCommandTimeoutMs;
  const requested = getOptionalNumberArg(args, "timeoutMs", configuredDefault);
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, requested));
}

export async function runShellCommand(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const command = getStringArg(args, "command");
  const requestedCwd = getOptionalStringArg(args, "cwd");
  const timeoutMs = resolveShellTimeoutMs(args, ctx);
  let cwd = getWorkspaceRoot(ctx.settings);
  if (requestedCwd) {
    const { target } = resolveWorkspacePath(requestedCwd, ctx.settings);
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      throw new Error(`cwd is not a directory: ${requestedCwd}`);
    }
    cwd = target;
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: { ...process.env },
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const output = [stdout.trim() ? `stdout:\n${trimOutput(stdout)}` : "", stderr.trim() ? `stderr:\n${trimOutput(stderr)}` : ""]
        .filter(Boolean)
        .join("\n\n");

      if (timedOut) {
        resolve([
          `exit_code: timeout`,
          `cwd: ${cwd}`,
          `timed_out_after_ms: ${timeoutMs}`,
          output || "(no output before timeout)",
          "",
          "The command was stopped after the configured timeout. Do not retry long-running dev servers (vite, npm run dev) with shell_command — they never exit. Use build/preview commands or ask the user to start the dev server manually.",
        ].join("\n\n"));
        return;
      }

      resolve([
        `exit_code: ${code ?? 0}`,
        `cwd: ${cwd}`,
        output || "(no output)",
      ].join("\n\n"));
    });
  });
}

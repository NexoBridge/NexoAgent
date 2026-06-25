import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import type { ToolExecutionContext } from "../types";
import { DEFAULT_AGENT_SETTINGS } from "../settings";
import { getWorkspaceRoot, resolveWorkspacePath } from "../workspace";

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 12_000;
const WINDOWS_UTF8_PREAMBLE = [
  "$__nexoUtf8 = [System.Text.UTF8Encoding]::new($false)",
  "[Console]::InputEncoding = $__nexoUtf8",
  "[Console]::OutputEncoding = $__nexoUtf8",
  "$OutputEncoding = $__nexoUtf8",
  "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
  "chcp 65001 > $null",
].join("; ");

function trimOutput(value: string) {
  const normalized = value.replace(/\r/g, "").trim();
  if (normalized.length <= MAX_OUTPUT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated by Nexo]`;
}

function decodeOutput(chunk: Buffer | string) {
  if (typeof chunk === "string") return chunk;
  const utf8 = chunk.toString("utf8");
  if (process.platform !== "win32" || !utf8.includes("\uFFFD")) return utf8;

  try {
    return new TextDecoder("gb18030").decode(chunk);
  } catch {
    return utf8;
  }
}

function findPowerShellCommandArg(command: string): string | undefined {
  const match = command.match(
    /^\s*(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b(?:\s+-(?!Command\b)[A-Za-z]+(?:\s+(?!-)\S+)*)*\s+-Command\s+/i,
  );
  if (!match) return undefined;

  const scriptStart = match[0].length;
  const rawScript = command.slice(scriptStart).trim();
  if (!rawScript) return undefined;

  const quote = rawScript[0];
  if ((quote === "\"" || quote === "'") && rawScript.endsWith(quote)) {
    return rawScript.slice(1, -1);
  }
  return rawScript;
}

function normalizeWindowsCommand(command: string) {
  const nestedScript = findPowerShellCommandArg(command);
  if (!nestedScript) return command;

  return nestedScript
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'");
}

async function writeWindowsCommandFile(command: string) {
  const file = path.join(os.tmpdir(), `nexo-shell-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  const script = [
    WINDOWS_UTF8_PREAMBLE,
    normalizeWindowsCommand(command),
    "",
  ].join("\r\n");

  // PowerShell 5.1 is more reliable with non-ASCII scripts when UTF-8 has a BOM.
  await fs.writeFile(file, `\uFEFF${script}`, "utf8");
  return file;
}

async function buildSpawnOptions(command: string) {
  if (process.platform === "win32") {
    const scriptFile = await writeWindowsCommandFile(command);
    return {
      file: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile],
      cleanupFile: scriptFile,
    };
  }

  return {
    file: command,
    args: [] as string[],
    cleanupFile: undefined,
  };
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

  const spawnOptions = await buildSpawnOptions(command);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(spawnOptions.file, spawnOptions.args, {
      cwd,
      env: { ...process.env },
      shell: process.platform === "win32" ? false : true,
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
      stdout += decodeOutput(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += decodeOutput(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (spawnOptions.cleanupFile) {
        void fs.unlink(spawnOptions.cleanupFile).catch(() => undefined);
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (spawnOptions.cleanupFile) {
        void fs.unlink(spawnOptions.cleanupFile).catch(() => undefined);
      }
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

import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { getOptionalStringArg, getStringArg } from "../utils";
import type { ToolExecutionContext } from "../types";
import { isRunInterrupted } from "../run-control";
import { getWorkspaceRoot, resolveWorkspacePath } from "../workspace";

const WINDOWS_UTF8_PREAMBLE = [
  "$__nexoUtf8 = [System.Text.UTF8Encoding]::new($false)",
  "[Console]::InputEncoding = $__nexoUtf8",
  "[Console]::OutputEncoding = $__nexoUtf8",
  "$OutputEncoding = $__nexoUtf8",
  "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
  "chcp 65001 > $null",
].join("; ");

function trimOutput(value: string) {
  return value.replace(/\r/g, "").trim();
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

function stopChildProcess(child: ReturnType<typeof spawn>) {
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => {
      child.kill();
    });
    return;
  }
  child.kill();
}

export async function runShellCommand(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const command = getStringArg(args, "command");
  const requestedCwd = getOptionalStringArg(args, "cwd");
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
    let interrupted = false;
    const interruptPoll = ctx.requestId
      ? setInterval(() => {
          if (!ctx.requestId || !isRunInterrupted(ctx.requestId) || interrupted) return;
          interrupted = true;
          stopChildProcess(child);
        }, 250)
      : undefined;
    interruptPoll?.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += decodeOutput(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += decodeOutput(chunk);
    });

    child.on("error", (error) => {
      if (interruptPoll) clearInterval(interruptPoll);
      if (spawnOptions.cleanupFile) {
        void fs.unlink(spawnOptions.cleanupFile).catch(() => undefined);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (interruptPoll) clearInterval(interruptPoll);
      if (spawnOptions.cleanupFile) {
        void fs.unlink(spawnOptions.cleanupFile).catch(() => undefined);
      }
      const output = [stdout.trim() ? `stdout:\n${trimOutput(stdout)}` : "", stderr.trim() ? `stderr:\n${trimOutput(stderr)}` : ""]
        .filter(Boolean)
        .join("\n\n");

      if (interrupted) {
        resolve([
          "exit_code: interrupted",
          `cwd: ${cwd}`,
          output || "(no output before interruption)",
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

import fs from "node:fs/promises";
import type { McpServerConfig } from "../../src/shared/types";
import { DATA_DIR, MCP_SERVERS_FILE } from "./config";

async function readServers(): Promise<McpServerConfig[]> {
  try {
    const raw = await fs.readFile(MCP_SERVERS_FILE, "utf8");
    const parsed = JSON.parse(raw) as McpServerConfig[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeServers(servers: McpServerConfig[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MCP_SERVERS_FILE, JSON.stringify(servers, null, 2), "utf8");
}

export async function listMcpServers() {
  return readServers();
}

export async function saveMcpServers(servers: McpServerConfig[]) {
  const normalized = servers.map((server) => ({
    name: server.name.trim(),
    command: server.command.trim(),
    args: Array.isArray(server.args) ? server.args.map((arg) => String(arg)) : [],
  })).filter((server) => server.name && server.command);
  await writeServers(normalized);
  return normalized;
}

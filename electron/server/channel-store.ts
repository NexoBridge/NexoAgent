import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config";

export type ChannelId = "feishu" | "dingtalk" | "wechat" | "wecom";

export interface ChannelConfig {
  id: ChannelId;
  enabled: boolean;
  values: Record<string, string>;
  updatedAt: string;
}

const CHANNELS_FILE = path.join(DATA_DIR, "channels.json");
const CHANNEL_IDS = new Set<ChannelId>(["feishu", "dingtalk", "wechat", "wecom"]);

const channelConfigs = new Map<ChannelId, ChannelConfig>();

const loadChannelsPromise = (async () => {
  try {
    const raw = await fs.readFile(CHANNELS_FILE, "utf8");
    const parsed = JSON.parse(raw) as ChannelConfig[];
    for (const item of parsed) {
      if (CHANNEL_IDS.has(item.id)) {
        channelConfigs.set(item.id, {
          id: item.id,
          enabled: Boolean(item.enabled),
          values: item.values ?? {},
          updatedAt: item.updatedAt ?? new Date().toISOString(),
        });
      }
    }
  } catch {
    // First run.
  }
})();

export async function ensureChannelsLoaded() {
  await loadChannelsPromise;
}

export async function saveChannels() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CHANNELS_FILE, JSON.stringify([...channelConfigs.values()], null, 2), "utf8");
}

export function isChannelId(value: string): value is ChannelId {
  return CHANNEL_IDS.has(value as ChannelId);
}

export async function listChannelConfigs() {
  await ensureChannelsLoaded();
  return [...CHANNEL_IDS].map((id) => getChannelConfig(id));
}

export function getChannelConfig(id: ChannelId): ChannelConfig {
  return channelConfigs.get(id) ?? {
    id,
    enabled: false,
    values: {},
    updatedAt: new Date(0).toISOString(),
  };
}

export async function saveChannelConfig(id: ChannelId, input: { enabled?: unknown; values?: Record<string, unknown> }) {
  await ensureChannelsLoaded();
  const current = getChannelConfig(id);
  const values: Record<string, string> = { ...current.values };

  for (const [key, value] of Object.entries(input.values ?? {})) {
    values[key] = value == null ? "" : String(value).trim();
  }

  const next: ChannelConfig = {
    id,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    values,
    updatedAt: new Date().toISOString(),
  };
  channelConfigs.set(id, next);
  await saveChannels();
  return next;
}

import fs from "node:fs/promises";
import path from "node:path";
import { isMemoryKind, recallMemory, type MemoryKind } from "../../memory";
import type { ToolExecutionContext } from "../types";
import type { SkillDefinition, SkillMarketplaceSearchResult } from "../../../src/shared/types";
import { createHash } from "node:crypto";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import { resolveWorkspacePath } from "../workspace";
import { MAX_FILE_READ_BYTES, MAX_FILE_WRITE_BYTES } from "../knowledge";
import { evaluateExpression } from "./calculator";
import { httpRequest } from "./http-request";
import { invokeModel } from "./model-call";
import { analyzeImage, editImage, generateImage, synthesizeSpeech, transcribeAudio } from "./multimodal";
import { webSearch } from "./web-search";
import { runShellCommand } from "./shell-command";
import { resolveMarketplaceId } from "../skill-marketplaces";
import { installMarketplaceSkill, listMarketplaces, saveSkill, searchLocalSkills, searchSkillsInMarketplaces } from "../skills";
import { createScheduledTask } from "../task-store";

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : undefined;
}

function readMemoryKinds(value: unknown): MemoryKind[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const kinds = raw.map((item) => String(item).trim()).filter(isMemoryKind);
  return kinds.length ? kinds : undefined;
}

function formatLocalSkill(skill: SkillDefinition, index: number) {
  return [
    `${index + 1}. ${skill.name} (${skill.key})`,
    `   source=${skill.source}${skill.marketplaceName ? `, marketplace=${skill.marketplaceName}` : ""}, category=${skill.category}, enabled=${skill.enabled ? "yes" : "no"}`,
    `   ${skill.description}`,
  ].join("\n");
}

function formatMarketplaceSkill(skill: SkillMarketplaceSearchResult, index: number) {
  return [
    `${index + 1}. ${skill.name}`,
    `   marketplace=${skill.marketplaceName}, installSpec=${skill.installSpec}`,
    `   ${skill.description}`,
    `   command: ${skill.installCommandPreview}`,
  ].join("\n");
}

function fallbackKey(name: string, description: string) {
  const normalized = `${name}\n${description}`.trim().toLowerCase();
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 8);
  return `${name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "skill"}-${hash}`;
}

async function resolveMarketplaceIdsFromSource(source: string) {
  const normalized = source.trim().toLowerCase();
  if (!normalized) return { ids: undefined as string[] | undefined, warning: "" };

  const marketplaces = await listMarketplaces();
  const matches = marketplaces.filter((marketplace) => {
    const haystack = [
      marketplace.id,
      marketplace.name,
      marketplace.homepage,
      marketplace.cli ?? "",
    ].join("\n").toLowerCase();
    return haystack.includes(normalized) || normalized.includes(marketplace.id) || normalized.includes(marketplace.name.toLowerCase());
  });

  if (!matches.length) {
    return {
      ids: undefined,
      warning: `Requested source "${source}" is not a configured skill marketplace. Use web_search or http_request against that exact website if the user wants a general website search.`,
    };
  }

  const searchable = matches.filter((marketplace) => marketplace.searchEnabled || marketplace.directSpecOnly);
  if (!searchable.length) {
    return {
      ids: matches.map((marketplace) => marketplace.id),
      warning: `Requested source "${source}" is known, but it does not currently expose a searchable adapter in Nexo.`,
    };
  }

  return { ids: searchable.map((marketplace) => marketplace.id), warning: "" };
}

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  web_search: async (args) => webSearch(args),
  http_request: async (args) => httpRequest(args),
  invoke_model: async (args, ctx) => invokeModel(args, ctx),
  analyze_image: async (args, ctx) => analyzeImage(args, ctx),
  generate_image: async (args, ctx) => generateImage(args, ctx),
  edit_image: async (args, ctx) => editImage(args, ctx),
  transcribe_audio: async (args, ctx) => transcribeAudio(args, ctx),
  synthesize_speech: async (args, ctx) => synthesizeSpeech(args, ctx),
  create_scheduled_task: async (args) => {
    const task = await createScheduledTask(args);
    return [
      `Created scheduled task: ${task.name}`,
      `ID: ${task.id}`,
      `Cron: ${task.cron}`,
      `Enabled: ${task.enabled ? "yes" : "no"}`,
      `Run once: ${task.runOnce ? "yes" : "no"}`,
      `Prompt: ${task.prompt}`,
      "",
      "The task is saved in Nexo Tasks and will appear in the Tasks panel.",
    ].join("\n");
  },
  shell_command: async (args, ctx) => runShellCommand(args, ctx),
  calculator: async (args) => String(evaluateExpression(getStringArg(args, "expression"))),
  file_read: async (args, ctx) => {
    const requestedPath = getStringArg(args, "path", ["file_path"]);
    const { root, target } = resolveWorkspacePath(requestedPath, ctx.settings);
    const stat = await fs.stat(target);
    const relative = path.relative(root, target) || ".";

    if (stat.isDirectory()) {
      const entries = await fs.readdir(target, { withFileTypes: true });
      const lines = entries
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, 200)
        .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`);
      return `Directory: ${relative}\n${lines.join("\n") || "(empty)"}`;
    }

    if (!stat.isFile()) throw new Error(`Path is not a regular file: ${requestedPath}`);
    if (stat.size > MAX_FILE_READ_BYTES) {
      const handle = await fs.open(target, "r");
      try {
        const buffer = Buffer.alloc(MAX_FILE_READ_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_READ_BYTES, 0);
        return [
          `File: ${relative}`,
          `Size: ${stat.size} bytes (showing first ${bytesRead} bytes)`,
          "",
          buffer.subarray(0, bytesRead).toString("utf8"),
        ].join("\n");
      } finally {
        await handle.close();
      }
    }

    return [`File: ${relative}`, "", await fs.readFile(target, "utf8")].join("\n");
  },
  file_write: async (args, ctx) => {
    const requestedPath = getStringArg(args, "path", ["file_path"]);
    const rawContent = args.content;
    if (rawContent === undefined || rawContent === null) throw new Error("Missing required argument: content");
    const content = typeof rawContent === "string" ? rawContent : String(rawContent);
    const append = args.append === true || args.append === "true";
    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength > MAX_FILE_WRITE_BYTES) {
      throw new Error(`Content is too large: ${byteLength} bytes. Limit is ${MAX_FILE_WRITE_BYTES} bytes.`);
    }

    const { root, target } = resolveWorkspacePath(requestedPath, ctx.settings);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (append) await fs.appendFile(target, content, "utf8");
    else await fs.writeFile(target, content, "utf8");
    return `${append ? "Appended" : "Wrote"} ${byteLength} bytes to ${path.relative(root, target)}`;
  },
  recall_memory: async (args, ctx) => {
    const query = getStringArg(args, "query", ["q"]);
    const kinds = readMemoryKinds(args.kinds ?? args.kind);
    const dayKey = getOptionalStringArg(args, "dayKey") || getOptionalStringArg(args, "day_key");
    const k = getOptionalNumberArg(args, "k", 6);
    const result = await recallMemory(query, ctx.apiKey, ctx.apiBase, k, kinds, dayKey || undefined);
    return result || "No relevant memory found.";
  },
  search_skills: async (args) => {
    const query = getStringArg(args, "query", ["q"]);
    const scope = getOptionalStringArg(args, "scope", "marketplace").toLowerCase();
    const requestedSource = getOptionalStringArg(args, "source") || getOptionalStringArg(args, "website");
    const sourceResolution = requestedSource ? await resolveMarketplaceIdsFromSource(requestedSource) : { ids: undefined, warning: "" };
    const marketplaceIds = sourceResolution.ids ?? readStringArray(args.marketplaceIds);

    if (requestedSource && sourceResolution.warning && !sourceResolution.ids?.length) {
      return sourceResolution.warning;
    }

    if (scope === "local") {
      const localResults = await searchLocalSkills(query);
      return localResults.length
        ? ["Local skills:", ...localResults.map(formatLocalSkill)].join("\n")
        : "No matching local skills found.";
    }

    if (scope === "marketplace") {
      const marketplaceResults = await searchSkillsInMarketplaces(query, marketplaceIds);
      const marketplaceItems = marketplaceResults.results as SkillMarketplaceSearchResult[];
      return marketplaceItems.length
        ? [
          "Marketplace skills:",
          ...marketplaceItems.map(formatMarketplaceSkill),
          ...([sourceResolution.warning, ...marketplaceResults.warnings].filter(Boolean).length ? ["", `Warnings: ${[sourceResolution.warning, ...marketplaceResults.warnings].filter(Boolean).join(" | ")}`] : []),
        ].join("\n")
        : ([sourceResolution.warning, ...marketplaceResults.warnings].filter(Boolean).length
          ? `No marketplace skills found. Warnings: ${[sourceResolution.warning, ...marketplaceResults.warnings].filter(Boolean).join(" | ")}`
          : "No marketplace skills found.");
    }

    const [localResults, marketplaceResults] = await Promise.all([
      searchLocalSkills(query),
      searchSkillsInMarketplaces(query, marketplaceIds),
    ]);
    const marketplaceItems = marketplaceResults.results as SkillMarketplaceSearchResult[];

    return [
      localResults.length
        ? ["Local skills:", ...localResults.map(formatLocalSkill)].join("\n")
        : "Local skills: none found.",
      "",
      marketplaceItems.length
        ? ["Marketplace skills:", ...marketplaceItems.map(formatMarketplaceSkill)].join("\n")
        : "Marketplace skills: none found.",
      ...([sourceResolution.warning, ...marketplaceResults.warnings].filter(Boolean).length ? ["", `Warnings: ${[sourceResolution.warning, ...marketplaceResults.warnings].filter(Boolean).join(" | ")}`] : []),
    ].join("\n");
  },
  install_skill: async (args) => {
    const marketplaceId = getStringArg(args, "marketplaceId");
    const installSpec = getStringArg(args, "installSpec");
    const name = getOptionalStringArg(args, "name");
    const homepage = getOptionalStringArg(args, "homepage");
    const resolvedMarketplaceId = resolveMarketplaceId(marketplaceId) || marketplaceId;

    const installed = await installMarketplaceSkill({
      marketplaceId: resolvedMarketplaceId,
      installSpec,
      ...(name ? { name } : {}),
      ...(homepage ? { homepage } : {}),
    });

    return [
      `Installed skill: ${installed.name} (${installed.key})`,
      `Marketplace: ${installed.marketplaceName || installed.marketplaceId || resolvedMarketplaceId}`,
      `Enabled: ${installed.enabled ? "yes" : "no"}`,
      ...(installed.path ? [`Path: ${installed.path}`] : []),
      "",
      installed.description,
    ].join("\n");
  },
  create_skill: async (args) => {
    const name = getStringArg(args, "name");
    const description = getStringArg(args, "description");
    const instruction = getStringArg(args, "instruction");
    const key = getOptionalStringArg(args, "key", fallbackKey(name, description));
    const category = getOptionalStringArg(args, "category", "custom");
    const enabled = args.enabled !== false && args.enabled !== "false";

    const saved = await saveSkill({
      key,
      name,
      category,
      description,
      instruction,
      enabled,
      source: "workspace",
    });

    return [
      `Saved skill: ${saved.name} (${saved.key})`,
      `Category: ${saved.category}`,
      `Enabled: ${saved.enabled ? "yes" : "no"}`,
      `Path: ${saved.path ?? "(managed storage)"}`,
      "",
      saved.description,
    ].join("\n");
  },
};

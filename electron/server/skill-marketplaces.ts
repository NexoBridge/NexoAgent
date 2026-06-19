import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  SkillInstallRequest,
  SkillMarketplace,
  SkillMarketplaceSearchResult,
  SkillSearchResponse,
} from "../../src/shared/types";
import { toErrorMessage } from "./utils";

interface MarketplaceInstallStaging {
  tempDir: string;
  cleanup: () => Promise<void>;
}

interface MarketplaceAdapter extends SkillMarketplace {
  search?: (query: string) => Promise<SkillMarketplaceSearchResult[]>;
  install?: (request: SkillInstallRequest) => Promise<MarketplaceInstallStaging>;
}

const TRUSTED_MARKETPLACE_IDS = new Set([
  "skills-sh",
  "agent-skills-hub",
  "heurist-mesh",
  "skillshub",
]);
const MARKETPLACE_ALIASES = new Map<string, string>([
  ["skills.sh", "skills-sh"],
  ["skills_sh", "skills-sh"],
  ["skillssh", "skills-sh"],
  ["skills-hub", "skillshub"],
  ["skills_hub", "skillshub"],
  ["skillshub", "skillshub"],
  ["@nodeskai/skillshub", "skillshub"],
  ["agentskillshub", "agent-skills-hub"],
  ["agent-skills-hub", "agent-skills-hub"],
  ["heurist", "heurist-mesh"],
  ["heurist mesh", "heurist-mesh"],
  ["heurist-mesh", "heurist-mesh"],
]);
const SKILLS_SH_REPO_CACHE = new Map<string, Promise<Set<string>>>();
const SKILLSHUB_INSPECT_CACHE = new Map<string, Promise<boolean>>();
const HEURIST_INFO_CACHE = new Map<string, Promise<boolean>>();

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

function npxBin() {
  return "npx";
}

function stripTerminalNoise(value: string) {
  return value
    .replace(ANSI_PATTERN, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "")
    .replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function humanizeSlug(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeMarketplaceKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function runCommand(command: string, args: string[], cwd: string, timeoutMs = 120_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        CI: "1",
      },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
      if (timedOut) {
        reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
        return;
      }
      if (code !== 0) {
        const output = stripTerminalNoise([stdout, stderr].filter(Boolean).join("\n"));
        reject(new Error(output || `Command failed with exit code ${code}`));
        return;
      }
      resolve({ stdout: stripTerminalNoise(stdout), stderr: stripTerminalNoise(stderr) });
    });
  });
}

async function createTempWorkspace(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function stageWithCleanup(prefix: string, install: (tempDir: string) => Promise<void>) {
  const tempDir = await createTempWorkspace(prefix);
  try {
    await install(tempDir);
    return {
      tempDir,
      cleanup: () => fs.rm(tempDir, { recursive: true, force: true }),
    } satisfies MarketplaceInstallStaging;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function splitSkillsShSpec(spec: string) {
  const trimmed = spec.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex < 0) {
    return { source: trimmed, skill: "" };
  }
  return {
    source: trimmed.slice(0, atIndex),
    skill: trimmed.slice(atIndex + 1),
  };
}

function directInstallResult(marketplace: SkillMarketplace, query: string): SkillMarketplaceSearchResult {
  return {
    id: `${marketplace.id}:${query}`,
    marketplaceId: marketplace.id,
    marketplaceName: marketplace.name,
    name: query,
    description: `${marketplace.name} supports direct installation by slug/spec. Use this when you already know the skill identifier.`,
    installSpec: query,
    installCommandPreview: marketplace.installHint.replace("<query>", query).replace("<slug>", query).replace("<spec>", query),
    homepage: marketplace.homepage,
  };
}

function parseSkillsShResults(output: string): SkillMarketplaceSearchResult[] {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const results: SkillMarketplaceSearchResult[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    if (!current.includes("@") || current.startsWith("Install with")) continue;

    const installsMatch = current.match(/^(?<spec>[^\s]+)\s+(?<installs>[\d.]+\s*[KM]?)\s+installs$/i);
    if (!installsMatch?.groups) continue;

    const spec = installsMatch.groups.spec.trim();
    const installs = installsMatch.groups.installs.trim();
    const link = lines[index + 1]?.replace(/^└\s*/, "").trim();
    const { skill } = splitSkillsShSpec(spec);

    results.push({
      id: `skills-sh:${spec}`,
      marketplaceId: "skills-sh",
      marketplaceName: "skills.sh",
      name: humanizeSlug(skill || spec),
      description: "Top-rated skill package discovered from skills.sh.",
      installSpec: spec,
      installCommandPreview: `npx skills add ${splitSkillsShSpec(spec).source} --skill ${skill} --agent claude-code --copy -y`,
      homepage: link,
      installs,
      verified: true,
    });
  }

  return results;
}

function parseSkillsShAvailableSkills(output: string) {
  const marker = "Available Skills";
  const start = output.lastIndexOf(marker);
  if (start < 0) return new Set<string>();

  let section = output.slice(start + marker.length);
  const endMarker = "Use --skill";
  const end = section.indexOf(endMarker);
  if (end >= 0) {
    section = section.slice(0, end);
  }

  const skills = new Set<string>();
  for (const line of section.split("\n")) {
    const normalized = line.replace(/^\|+\s*/, "").trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
      skills.add(normalized);
    }
  }
  return skills;
}

function parseHeuristResults(output: string): SkillMarketplaceSearchResult[] {
  const lines = output.split("\n");
  const results: SkillMarketplaceSearchResult[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const match = line.match(/^([a-z0-9._:/-]+)(?:\s+\[(.+?)\])?$/i);
    if (!match) continue;
    const description = lines[index + 1]?.trim();
    if (!description || description.startsWith("|") || description.startsWith("-")) continue;

    results.push({
      id: `heurist-mesh:${match[1]}`,
      marketplaceId: "heurist-mesh",
      marketplaceName: "Heurist Mesh",
      name: humanizeSlug(match[1]),
      description,
      installSpec: match[1],
      installCommandPreview: `npx @heurist-network/skills add ${match[1]} --agent claude-code --copy -y`,
      homepage: "https://mesh.heurist.xyz",
      author: match[2],
      verified: true,
    });
  }

  return results;
}

function parseSkillshubResults(output: string): SkillMarketplaceSearchResult[] {
  const lines = output.split("\n");
  const results: SkillMarketplaceSearchResult[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const match = line.match(/^([a-z0-9._:/-]+)\s+by\s+(.+)$/i);
    if (!match) continue;

    const title = lines[index + 1]?.trim() ?? "";
    const description = lines[index + 2]?.trim() ?? "";
    results.push({
      id: `skillshub:${match[1]}`,
      marketplaceId: "skillshub",
      marketplaceName: "SkillsHub",
      name: title || humanizeSlug(match[1]),
      description: description || "Published skill from SkillsHub.",
      installSpec: match[1],
      installCommandPreview: `npx @nodeskai/skillshub install ${match[1]} --dir <target-dir>`,
      homepage: "https://www.npmjs.com/package/@nodeskai/skillshub",
      author: match[2],
      verified: true,
    });
  }

  return results;
}

async function filterResults<T>(
  results: T[],
  isValid: (result: T) => Promise<boolean>,
  limit = 8,
) {
  const checked = await Promise.all(
    results.map(async (result) => ({ result, valid: await isValid(result) })),
  );

  return checked
    .filter((entry) => entry.valid)
    .map((entry) => entry.result)
    .slice(0, limit);
}

async function listSkillsShRepositorySkills(source: string) {
  const key = source.trim().toLowerCase();
  const cached = SKILLS_SH_REPO_CACHE.get(key);
  if (cached) return cached;

  const task = (async () => {
    const { stdout } = await runCommand(
      npxBin(),
      ["skills", "add", source, "--list", "-y"],
      process.cwd(),
      120_000,
    );
    return parseSkillsShAvailableSkills(stdout);
  })();

  SKILLS_SH_REPO_CACHE.set(key, task);
  try {
    return await task;
  } catch (error) {
    SKILLS_SH_REPO_CACHE.delete(key);
    throw error;
  }
}

async function skillshubSkillExists(slug: string) {
  const key = slug.trim().toLowerCase();
  const cached = SKILLSHUB_INSPECT_CACHE.get(key);
  if (cached) return cached;

  const task = runCommand(npxBin(), ["@nodeskai/skillshub", "inspect", slug], process.cwd(), 90_000)
    .then(() => true)
    .catch(() => false);

  SKILLSHUB_INSPECT_CACHE.set(key, task);
  return task;
}

async function heuristSkillExists(slug: string) {
  const key = slug.trim().toLowerCase();
  const cached = HEURIST_INFO_CACHE.get(key);
  if (cached) return cached;

  const task = runCommand(npxBin(), ["@heurist-network/skills", "info", slug], process.cwd(), 90_000)
    .then(() => true)
    .catch(() => false);

  HEURIST_INFO_CACHE.set(key, task);
  return task;
}

async function searchSkillsSh(query: string) {
  const { stdout } = await runCommand(npxBin(), ["skills", "find", query], process.cwd(), 90_000);
  const results = parseSkillsShResults(stdout);
  return filterResults(results, async (result) => {
    const { source, skill } = splitSkillsShSpec(result.installSpec);
    if (!source || !skill) return false;
    const available = await listSkillsShRepositorySkills(source);
    return available.has(skill.trim().toLowerCase());
  });
}

async function searchHeurist(query: string) {
  const { stdout } = await runCommand(npxBin(), ["@heurist-network/skills", "find", query], process.cwd(), 90_000);
  const results = parseHeuristResults(stdout);
  return filterResults(results, (result) => heuristSkillExists(result.installSpec));
}

async function searchSkillshub(query: string) {
  const { stdout } = await runCommand(npxBin(), ["@nodeskai/skillshub", "search", query], process.cwd(), 90_000);
  const results = parseSkillshubResults(stdout);
  return filterResults(results, (result) => skillshubSkillExists(result.installSpec));
}

async function installSkillsSh(request: SkillInstallRequest) {
  const { source, skill } = splitSkillsShSpec(request.installSpec);
  if (!source || !skill) {
    throw new Error("skills.sh install spec must look like owner/repo@skill-name");
  }

  const available = await listSkillsShRepositorySkills(source);
  if (!available.has(skill.trim().toLowerCase())) {
    throw new Error(`skills.sh repository ${source} does not currently contain skill "${skill}"`);
  }

  return stageWithCleanup("nexo-skillssh-", async (tempDir) => {
    await runCommand(
      npxBin(),
      ["skills", "add", source, "--skill", skill, "--agent", "claude-code", "--copy", "-y"],
      tempDir,
      120_000,
    );
  });
}

async function installAgentSkillsHub(request: SkillInstallRequest) {
  if (!request.installSpec.trim()) {
    throw new Error("agent-skills-hub install requires a skill slug");
  }

  return stageWithCleanup("nexo-agenthub-", async (tempDir) => {
    await runCommand(
      npxBin(),
      ["agent-skills-hub", "install", request.installSpec.trim(), "--path", tempDir],
      process.cwd(),
      120_000,
    );
  });
}

async function installHeurist(request: SkillInstallRequest) {
  if (!request.installSpec.trim()) {
    throw new Error("Heurist install requires a skill slug");
  }

  return stageWithCleanup("nexo-heurist-", async (tempDir) => {
    await runCommand(
      npxBin(),
      ["@heurist-network/skills", "add", request.installSpec.trim(), "--agent", "claude-code", "--copy", "-y"],
      tempDir,
      120_000,
    );
  });
}

async function installSkillshub(request: SkillInstallRequest) {
  if (!request.installSpec.trim()) {
    throw new Error("SkillsHub install requires a skill slug");
  }

  return stageWithCleanup("nexo-skillshub-", async (tempDir) => {
    await runCommand(
      npxBin(),
      ["@nodeskai/skillshub", "install", request.installSpec.trim(), "--dir", tempDir],
      process.cwd(),
      120_000,
    );
  });
}

const MARKETPLACES: MarketplaceAdapter[] = [
  {
    id: "skills-sh",
    name: "skills.sh",
    description: "Vercel's curated multi-agent skill store with strong engineering and product skills.",
    homepage: "https://www.skills.sh",
    cli: "npx skills",
    installHint: "npx skills add <owner/repo> --skill <slug> --agent claude-code --copy -y",
    searchEnabled: true,
    installEnabled: true,
    search: searchSkillsSh,
    install: installSkillsSh,
  },
  {
    id: "agent-skills-hub",
    name: "Agent Skills Hub",
    description: "Project-oriented open skill registry that can install a named skill directly into a target directory.",
    homepage: "https://www.npmjs.com/package/agent-skills-hub",
    cli: "npx agent-skills-hub",
    installHint: "npx agent-skills-hub install <slug> --path <target-dir>",
    searchEnabled: false,
    installEnabled: true,
    directSpecOnly: true,
    notes: "Use a known skill slug. The upstream CLI does not expose a searchable listing in this environment.",
    install: installAgentSkillsHub,
  },
  {
    id: "heurist-mesh",
    name: "Heurist Mesh",
    description: "Verified skill marketplace with a strong crypto/finance tilt and a maintained CLI.",
    homepage: "https://mesh.heurist.xyz",
    cli: "npx @heurist-network/skills",
    installHint: "npx @heurist-network/skills add <slug> --agent claude-code --copy -y",
    searchEnabled: true,
    installEnabled: true,
    search: searchHeurist,
    install: installHeurist,
  },
  {
    id: "skillshub",
    name: "SkillsHub",
    description: "Searchable skill registry with install, update, publish, and version-aware workflows.",
    homepage: "https://www.npmjs.com/package/@nodeskai/skillshub",
    cli: "npx @nodeskai/skillshub",
    installHint: "npx @nodeskai/skillshub install <slug> --dir <target-dir>",
    searchEnabled: true,
    installEnabled: true,
    search: searchSkillshub,
    install: installSkillshub,
  },
  {
    id: "skillsmp",
    name: "SkillsMP",
    description: "Large GitHub-managed marketplace focused on discovery across many open-source skills.",
    homepage: "https://github.com",
    installHint: "Search on GitHub and install according to the skill repository instructions.",
    searchEnabled: false,
    installEnabled: false,
    notes: "Catalogued for reference. No verified machine-searchable CLI was detected in this environment.",
  },
  {
    id: "osm",
    name: "OSM",
    description: "Open registry with package-manager style commands such as search, install, and update.",
    homepage: "https://github.com",
    cli: "osm",
    installHint: "osm search <query>; osm install <slug>",
    searchEnabled: false,
    installEnabled: false,
    notes: "Catalogued for reference until a stable CLI/API path is wired into Nexo.",
  },
  {
    id: "agensi",
    name: "Agensi",
    description: "Multi-agent marketplace organized by category, with a GitHub-managed distribution model.",
    homepage: "https://github.com",
    installHint: "Follow the upstream repository instructions for the chosen skill.",
    searchEnabled: false,
    installEnabled: false,
  },
  {
    id: "skillforge",
    name: "SkillForge",
    description: "Experimental decentralized MCP skill market focused on autonomous agent transactions.",
    homepage: "https://github.com",
    installHint: "Follow the upstream Node 18+ installation guide for the selected skill.",
    searchEnabled: false,
    installEnabled: false,
  },
  {
    id: "mekaskill",
    name: "mekaskill",
    description: "CLI-based marketplace that downloads skill repositories into the current directory.",
    homepage: "https://github.com",
    cli: "mekaskill-cli",
    installHint: "mekaskill-cli install <repo-or-skill>",
    searchEnabled: false,
    installEnabled: false,
  },
  {
    id: "itismyskillmarket",
    name: "itismyskillmarket",
    description: "Cross-platform skill manager with both CLI and GUI flows for multi-agent setups.",
    homepage: "https://github.com",
    cli: "skm",
    installHint: "skm install <npm-package-or-github-repo>",
    searchEnabled: false,
    installEnabled: false,
  },
];

const MARKETPLACE_MAP = new Map(MARKETPLACES.map((marketplace) => [marketplace.id, marketplace]));

export function listSkillMarketplaces(): SkillMarketplace[] {
  return MARKETPLACES.map(({ search, install, ...marketplace }) => marketplace);
}

export async function searchMarketplaceSkills(
  query: string,
  marketplaceIds?: string[],
): Promise<SkillSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: "", results: [], warnings: [] };
  }

  const selected = MARKETPLACES.filter((marketplace) =>
    TRUSTED_MARKETPLACE_IDS.has(marketplace.id)
    && (!marketplaceIds?.length || marketplaceIds.includes(marketplace.id)),
  );
  const warnings: string[] = [];
  const searchTasks = selected
    .filter((marketplace) => marketplace.searchEnabled && marketplace.search)
    .map(async (marketplace) => {
      try {
        return await marketplace.search!(trimmed);
      } catch (error) {
        warnings.push(`${marketplace.name}: ${toErrorMessage(error)}`);
        return [];
      }
    });

  const searchableResults = (await Promise.all(searchTasks)).flat();

  return {
    query: trimmed,
    results: searchableResults,
    warnings,
  };
}

export async function stageMarketplaceSkillInstall(request: SkillInstallRequest) {
  const marketplaceId = resolveMarketplaceId(request.marketplaceId);
  if (!marketplaceId || !TRUSTED_MARKETPLACE_IDS.has(marketplaceId)) {
    throw new Error(`Marketplace is not trusted for installation: ${request.marketplaceId}`);
  }
  const marketplace = MARKETPLACE_MAP.get(marketplaceId);
  if (!marketplace?.installEnabled || !marketplace.install) {
    throw new Error(`Marketplace install is not available for ${request.marketplaceId}`);
  }
  return marketplace.install({ ...request, marketplaceId });
}

export function getMarketplaceById(id: string) {
  const marketplaceId = resolveMarketplaceId(id);
  return marketplaceId && TRUSTED_MARKETPLACE_IDS.has(marketplaceId) ? MARKETPLACE_MAP.get(marketplaceId) : undefined;
}

export function resolveMarketplaceId(value: string) {
  const normalized = normalizeMarketplaceKey(value);
  if (!normalized) return "";
  if (TRUSTED_MARKETPLACE_IDS.has(normalized)) return normalized;
  return MARKETPLACE_ALIASES.get(normalized) ?? "";
}

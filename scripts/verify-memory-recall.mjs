import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distMemoryPath = path.join(repoRoot, "dist-electron", "electron", "memory.js");

function parseArgs(argv) {
  const args = {
    k: 5,
    total: 300,
    queries: 60,
    keep: false,
    isolated: false,
    json: false,
    minRecall: null,
    providerId: undefined,
    providerName: undefined,
    apiBase: undefined,
    apiKey: undefined,
    model: undefined,
  };

  for (const raw of argv) {
    if (raw === "--keep") args.keep = true;
    else if (raw === "--isolated") args.isolated = true;
    else if (raw === "--json") args.json = true;
    else if (raw.startsWith("--k=")) args.k = Math.max(1, Number.parseInt(raw.slice("--k=".length), 10) || args.k);
    else if (raw.startsWith("--total=")) args.total = Math.max(300, Number.parseInt(raw.slice("--total=".length), 10) || args.total);
    else if (raw.startsWith("--queries=")) args.queries = Math.max(1, Number.parseInt(raw.slice("--queries=".length), 10) || args.queries);
    else if (raw.startsWith("--min-recall=")) args.minRecall = Number.parseFloat(raw.slice("--min-recall=".length));
    else if (raw.startsWith("--provider-id=")) args.providerId = raw.slice("--provider-id=".length);
    else if (raw.startsWith("--provider-name=")) args.providerName = raw.slice("--provider-name=".length);
    else if (raw.startsWith("--api-base=")) args.apiBase = raw.slice("--api-base=".length);
    else if (raw.startsWith("--api-key=")) args.apiKey = raw.slice("--api-key=".length);
    else if (raw.startsWith("--model=")) args.model = raw.slice("--model=".length);
    else if (raw === "--help" || raw === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }

  args.apiKey = args.apiKey || process.env.NEXO_RECALL_API_KEY || process.env.OPENAI_API_KEY || "";
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/verify-memory-recall.mjs [options]

This is an AMB-style local adapter benchmark for Nexo memory retrieval:
it seeds a corpus, runs categorized retrieval queries, and scores recall@k/MRR.

Options:
  --k=5                         Max result count used for recall@k.
  --total=300                   Total seeded memories. Values below 300 are raised to 300.
  --queries=60                  Number of target memories to query and score.
  --isolated                    Use a temporary NEXO_DATA_DIR instead of your real memory DB.
  --keep                        Keep seeded test memories for UI inspection.
  --json                        Print machine-readable JSON.
  --min-recall=1                Exit non-zero when recall@k is below this threshold.
  --provider-id=openai-compatible
  --provider-name=OpenAI
  --api-base=https://api.openai.com/v1
  --api-key=...                 Defaults to NEXO_RECALL_API_KEY or OPENAI_API_KEY.
  --model=text-embedding-3-small

Examples:
  npm run verify:memory-recall
  npm run verify:memory-recall -- --keep
  npm run verify:memory-recall -- --total=1000 --queries=120
  npm run verify:memory-recall -- --isolated --k=10
  npm run verify:memory-recall -- --api-base=https://api.openai.com/v1 --model=text-embedding-3-small
`);
}

function buildEmbeddingSettings(args) {
  const settings = {
    providerId: args.providerId,
    providerName: args.providerName,
    apiBase: args.apiBase,
    apiKey: args.apiKey,
    model: args.model,
  };
  return Object.values(settings).some((value) => typeof value === "string" && value.trim()) ? settings : {};
}

function containsExpected(entry, expected) {
  const content = `${entry.key || ""}\n${entry.content || ""}`;
  return expected.every((token) => content.includes(token));
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const args = parseArgs(process.argv.slice(2));
let tempRoot = "";
if (args.isolated) {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-memory-recall-"));
  process.env.NEXO_DATA_DIR = path.join(tempRoot, ".nexo-data");
}

if (!fs.existsSync(distMemoryPath)) {
  throw new Error("dist-electron/electron/memory.js not found. Run `npm run build:electron` first.");
}

const memory = await import(pathToFileURL(distMemoryPath));
const runId = `recall-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const marker = `NEXO_RECALL_EVAL_${runId}`;
const maxK = args.k;
const recallCuts = [1, 3, 5, maxK].filter((value, index, array) => value <= maxK && array.indexOf(value) === index);
const embeddingSettings = buildEmbeddingSettings(args);
const hasEmbeddingConfig = Object.values(embeddingSettings).some((value) => typeof value === "string" && value.trim());

const baseCases = [
  {
    category: "fact_recall",
    key: "secret-code",
    content: `${marker} User memory recall test secret code is BLUE-PANDA-7391.`,
    query: "What is the user memory recall test secret code?",
    expected: ["BLUE-PANDA-7391"],
  },
  {
    category: "fact_recall",
    key: "workspace-root",
    content: `${marker} Nexo Agent memory test project root is D:\\company\\nexoAgent.`,
    query: "nexoAgent project root memory",
    expected: ["D:\\company\\nexoAgent"],
  },
  {
    category: "preference",
    key: "reply-style",
    content: `${marker} User preference: answer in Chinese and keep conclusions concise.`,
    query: "Chinese concise answer preference",
    expected: ["Chinese", "concise"],
  },
  {
    category: "tool_memory",
    key: "tool-trace-meta",
    content: `${marker} Tool execution traces should persist into assistant message meta.`,
    query: "tool execution trace assistant meta",
    expected: ["Tool execution traces", "meta"],
  },
  {
    category: "temporal",
    key: "release-tag",
    content: `${marker} Release test versions should use semantic tags such as v0.0.6.`,
    query: "release version tag v0.0.6",
    expected: ["v0.0.6"],
  },
  {
    category: "semantic",
    key: "vision-direct",
    content: `${marker} Multimodal images should be sent directly with the current user message, not through invoke_model just to inspect the image.`,
    query: "multimodal image direct message invoke_model",
    expected: ["Multimodal images", "invoke_model"],
  },
];

const subjects = [
  "scheduler", "invoice", "browser", "handoff", "workspace", "release", "snapshot", "plugin", "profile", "knowledge",
  "attachment", "terminal", "dashboard", "agent", "session", "vector", "cache", "provider", "artifact", "channel",
];
const actions = [
  "prefers", "tracks", "stores", "validates", "routes", "indexes", "summarizes", "checks", "persists", "loads",
  "syncs", "filters", "backs up", "labels", "compacts", "streams", "renders", "normalizes", "searches", "groups",
];
const objects = [
  "alpha policy", "beta workspace", "gamma artifact", "delta memory", "epsilon session", "zeta setting",
  "eta model", "theta browser", "iota upload", "kappa context", "lambda trace", "mu document",
];
const distractorTemplates = [
  "Coffee beans should be stored away from direct sunlight.",
  "A calendar note mentions Thursday afternoon but has no project secret.",
  "The sample dashboard color palette uses green and amber.",
  "Keyboard shortcuts can improve navigation speed.",
  "A meeting room projector supports HDMI and USB-C inputs.",
  "Travel notes recommend checking luggage weight before leaving.",
  "A recipe reminder says soup should simmer for twenty minutes.",
  "Office plants need water every few days during summer.",
  "A generic task says review documentation before deployment.",
  "The weather note mentions wind speed and humidity.",
];
const categories = [
  "fact_recall",
  "semantic",
  "preference",
  "conflict_resolution",
  "cross_session",
  "temporal",
  "tool_memory",
  "multi_hop",
];

function generatedCase(index) {
  const category = categories[index % categories.length];
  const subject = subjects[index % subjects.length];
  const action = actions[Math.floor(index / subjects.length) % actions.length];
  const object = objects[Math.floor(index / (subjects.length * actions.length)) % objects.length];
  const code = `MEM-${String(index + 1).padStart(4, "0")}-${subject.toUpperCase()}-${object.split(" ")[0].toUpperCase()}`;
  const user = `test-user-${index % 17}`;
  return {
    category,
    key: `synthetic-target-${String(index + 1).padStart(4, "0")}`,
    content: `${marker} Synthetic target ${index + 1}: ${subject} ${action} ${object}; recall code ${code}; owner ${user}; category ${category}.`,
    query: buildSyntheticQuery(category, subject, action, object, user),
    expected: [code],
  };
}

function buildSyntheticQuery(category, subject, action, object, user) {
  switch (category) {
    case "semantic":
      return `Find the memory about ${subject} and ${object} using related meaning for ${action}`;
    case "preference":
      return `What preference was stored for ${subject} ${action} ${object}?`;
    case "conflict_resolution":
      return `Which latest target should be used for ${subject} ${action} ${object}?`;
    case "cross_session":
      return `For ${user}, what was remembered about ${subject} ${action} ${object}?`;
    case "temporal":
      return `What temporal memory mentions ${subject} ${action} ${object}?`;
    case "tool_memory":
      return `What tool-related memory exists for ${subject} ${action} ${object}?`;
    case "multi_hop":
      return `Connect the owner and target for ${subject} ${action} ${object}`;
    case "fact_recall":
    default:
      return `What is the stored fact for ${subject} ${action} ${object}?`;
  }
}

const desiredCaseCount = Math.min(Math.max(1, args.queries), args.total);
const generatedCaseCount = Math.max(0, desiredCaseCount - baseCases.length);
const cases = [
  ...baseCases.slice(0, desiredCaseCount),
  ...Array.from({ length: generatedCaseCount }, (_, index) => generatedCase(index)),
];
const totalSeededMemories = Math.max(300, args.total, cases.length);
const distractorCount = Math.max(0, totalSeededMemories - cases.length);
const distractors = Array.from({ length: distractorCount }, (_, index) => {
  const template = distractorTemplates[index % distractorTemplates.length];
  const subject = subjects[(index * 7) % subjects.length];
  const object = objects[(index * 11) % objects.length];
  return {
    key: `distractor-${String(index + 1).padStart(4, "0")}`,
    content: `${marker} Distractor ${index + 1}: ${template} Topic ${subject} references ${object} without any target recall code.`,
  };
});

const storedIds = [];
try {
  for (const item of [...cases, ...distractors]) {
    const id = await memory.storeScriptMemory(`${marker}:${item.key}`, item.content, {
      scope: "memory-recall-eval",
      metadata: { runId, marker, expected: Boolean(item.expected) },
      embeddingSettings,
    });
    if (id) storedIds.push(id);
  }

  const evaluations = [];
  for (const testCase of cases) {
    const results = await memory.searchMemories(testCase.query, embeddingSettings, {
      kinds: ["script"],
      k: maxK,
    });
    const rank = results.findIndex((entry) => containsExpected(entry, testCase.expected)) + 1;
    evaluations.push({
      category: testCase.category,
      key: testCase.key,
      query: testCase.query,
      expected: testCase.expected,
      rank: rank || null,
      hitAt: Object.fromEntries(recallCuts.map((cut) => [`recall@${cut}`, rank > 0 && rank <= cut])),
      topResults: results.slice(0, maxK).map((entry) => ({
        key: entry.key,
        kind: entry.kind,
        content: entry.content,
      })),
    });
  }

  const metrics = {
    total: evaluations.length,
    maxK,
    mrr: average(evaluations.map((item) => item.rank ? 1 / item.rank : 0)),
    recall: Object.fromEntries(
      recallCuts.map((cut) => [
        `recall@${cut}`,
        evaluations.filter((item) => item.rank && item.rank <= cut).length / evaluations.length,
      ]),
    ),
    byCategory: Object.fromEntries(
      [...new Set(evaluations.map((item) => item.category))].sort().map((category) => {
        const items = evaluations.filter((item) => item.category === category);
        return [category, {
          total: items.length,
          recall: Object.fromEntries(
            recallCuts.map((cut) => [
              `recall@${cut}`,
              items.filter((item) => item.rank && item.rank <= cut).length / items.length,
            ]),
          ),
          mrr: average(items.map((item) => item.rank ? 1 / item.rank : 0)),
        }];
      }),
    ),
  };

  const output = {
    runId,
    marker,
    dataDir: process.env.NEXO_DATA_DIR || "default",
    mode: hasEmbeddingConfig ? "embedding+fallback" : "sqlite-fallback",
    benchmark: {
      name: "amb-style-memory-recall",
      flow: "ingest -> retrieve -> local exact-match judge",
      note: "Uses AMB-style provider flow locally because the official AMB CLI/source download was not available in this environment.",
    },
    corpus: {
      seeded: totalSeededMemories,
      targets: cases.length,
      distractors: distractors.length,
    },
    metrics,
    evaluations,
    cleanup: args.keep ? "kept" : "pending",
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log("Memory recall evaluation");
    console.log(`Run ID: ${runId}`);
    console.log(`Data dir: ${output.dataDir}`);
    console.log(`Mode: ${output.mode}`);
    console.log(`Benchmark: ${output.benchmark.name} (${output.benchmark.flow})`);
    console.log(`Seeded memories: ${output.corpus.seeded} (${output.corpus.targets} targets + ${output.corpus.distractors} distractors)`);
    console.log(`Queries: ${metrics.total}`);
    console.log("");
    for (const [name, value] of Object.entries(metrics.recall)) {
      const hits = evaluations.filter((item) => item.rank && item.rank <= Number(name.split("@")[1])).length;
      console.log(`${name}: ${percent(value)} (${hits}/${metrics.total})`);
    }
    console.log(`MRR: ${metrics.mrr.toFixed(3)}`);
    console.log("");
    console.log("By category:");
    for (const [category, categoryMetrics] of Object.entries(metrics.byCategory)) {
      const score = categoryMetrics.recall[`recall@${maxK}`] ?? 0;
      console.log(`- ${category}: recall@${maxK} ${percent(score)} (${categoryMetrics.total} queries), MRR ${categoryMetrics.mrr.toFixed(3)}`);
    }
    console.log("");
    console.log("Details:");
    for (const item of evaluations) {
      const status = item.rank ? "PASS" : "MISS";
      const rank = item.rank ? `rank ${item.rank}` : "not found";
      console.log(`- ${status} [${rank}] [${item.category}] ${item.key}: ${item.query}`);
    }
  }

  const finalRecall = metrics.recall[`recall@${maxK}`] ?? 0;
  if (typeof args.minRecall === "number" && finalRecall < args.minRecall) {
    process.exitCode = 1;
  }
} finally {
  if (!args.keep) {
    for (const id of storedIds.reverse()) {
      await memory.deleteMemory(id).catch(() => undefined);
    }
    if (!args.json) {
      console.log("");
      console.log(`Cleaned up ${storedIds.length} seeded test memories.`);
    }
  } else if (!args.json) {
    console.log("");
    console.log(`Kept ${storedIds.length} seeded test memories. Search marker: ${marker}`);
  }
}

process.exit(process.exitCode ?? 0);

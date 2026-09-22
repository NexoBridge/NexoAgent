import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distKnowledgePath = path.join(repoRoot, "dist-electron", "electron", "server", "knowledge.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-knowledge-lexical-"));
const dataDir = path.join(tempRoot, ".nexo-data");
const knowledgeDir = path.join(dataDir, "knowledge");
process.env.NEXO_DATA_DIR = dataDir;
fs.mkdirSync(knowledgeDir, { recursive: true });

fs.writeFileSync(path.join(knowledgeDir, "支付认证排障.md"), [
  "# 支付认证排障",
  "",
  "支付宝登录失败时检查网关。错误码 PAY-AUTH-7391 表示令牌过期。",
  "认证服务配置位于 auth/config.yaml。",
].join("\n"));
fs.writeFileSync(path.join(knowledgeDir, "普通运维手册.md"), [
  "# 普通运维手册",
  "",
  "这份文档介绍常规部署、监控、配置和日常检查。",
  "出现一般错误时先检查日志。",
].join("\n"));
fs.writeFileSync(path.join(knowledgeDir, "StreamingGuide.md"), [
  "# Streaming Guide",
  "",
  "The response stream should flush incremental tokens immediately.",
].join("\n"));

if (!fs.existsSync(distKnowledgePath)) {
  throw new Error("dist knowledge module missing; run npm run build:app first");
}

const knowledge = await import(pathToFileURL(distKnowledgePath));
const lexicalOnly = { semanticEnabled: false };

const codeResult = await knowledge.retrieveKnowledgeContextWithSources("PAY-AUTH-7391 是什么错误", lexicalOnly, 3);
assert.equal(codeResult.sources[0]?.rel, "支付认证排障.md");
assert.equal(codeResult.sources[0]?.method, "keyword");

const synonymResult = await knowledge.retrieveKnowledgeContextWithSources("支付宝登陆鉴权失败", lexicalOnly, 3);
assert.equal(synonymResult.sources[0]?.rel, "支付认证排障.md");

const titleResult = await knowledge.retrieveKnowledgeContextWithSources("Streaming Guide", lexicalOnly, 3);
assert.equal(titleResult.sources[0]?.rel, "StreamingGuide.md");

const indexFile = path.join(dataDir, "knowledge-lexical-index.json");
assert.equal(fs.existsSync(indexFile), true);
const stored = JSON.parse(fs.readFileSync(indexFile, "utf8"));
assert.equal(stored.version, 1);
assert.equal(Object.keys(stored.files).length, 3);

console.log(JSON.stringify({
  ok: true,
  mode: "lexical-only",
  checks: ["bm25", "title-boost", "exact-identifier", "synonym-expansion", "persistent-index"],
  topSources: {
    code: codeResult.sources[0]?.rel,
    synonym: synonymResult.sources[0]?.rel,
    title: titleResult.sources[0]?.rel,
  },
}, null, 2));

fs.rmSync(tempRoot, { recursive: true, force: true });
process.exit(0);

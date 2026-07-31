import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const routingModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/planner-executor-routing.js")));

const { classifyPlannerExecutorRoute, evaluateExecutorQuality } = routingModule;

{
  const decision = classifyPlannerExecutorRoute({
    latestUserMessage: "What is JSON?",
    planningMode: "balanced",
  });
  assert.equal(decision.routeClass, "simple");
  assert.equal(decision.executionMode, "fast_executor");
  assert.equal(decision.riskLevel, "low");
  assert.equal(decision.verificationLevel, "none");
  assert.equal(decision.needsPlannerBrief, false);
  assert.equal(decision.needsIterativeReplan, false);
}

{
  const decision = classifyPlannerExecutorRoute({
    latestUserMessage: "Summarize this attached meeting note.",
    attachments: [{ name: "notes.txt", type: "file", url: "file://notes.txt" }],
    planningMode: "balanced",
  });
  assert.equal(decision.routeClass, "medium");
  assert.equal(decision.executionMode, "fast_executor");
  assert.equal(decision.riskLevel, "low");
  assert.equal(decision.needsPlannerBrief, false);
}

{
  const decision = classifyPlannerExecutorRoute({
    latestUserMessage: "Review this TypeScript component, identify the bug, patch the file, then run tests.",
    planningMode: "deep",
  });
  assert.equal(decision.routeClass, "agentic");
  assert.equal(decision.executionMode, "iterative_orchestration");
  assert.equal(decision.riskLevel, "medium");
  assert.equal(decision.needsPlannerBrief, true);
  assert.equal(decision.needsIterativeReplan, true);
  assert.ok(decision.replanTriggers.includes("tool_action"));
}

{
  const decision = classifyPlannerExecutorRoute({
    latestUserMessage: "Analyze the security risk of deleting these production database rows and explain the rollback plan.",
    planningMode: "balanced",
  });
  assert.equal(decision.routeClass, "reasoning");
  assert.equal(decision.executionMode, "primary_takeover");
  assert.equal(decision.riskLevel, "high");
  assert.equal(decision.verificationLevel, "primary");
  assert.equal(decision.needsPlannerBrief, false);
  assert.ok(decision.escalationTriggers.includes("risk"));
}

{
  const quality = evaluateExecutorQuality({
    content: "The answer is complete.",
    toolCalls: [],
    routeClass: "simple",
    threshold: 0.72,
  });
  assert.equal(quality.needsFallback, false);
}

{
  const quality = evaluateExecutorQuality({
    content: "I am not sure; TODO verify this later.",
    toolCalls: [{ id: "t1", name: "shell_command", input: {}, output: "Error: failed", status: "error" }],
    routeClass: "agentic",
    threshold: 0.72,
  });
  assert.equal(quality.needsFallback, true);
  assert.ok(quality.reasons.includes("tool_error"));
  assert.ok(quality.reasons.includes("unresolved_marker"));
}

console.log("planner/executor routing verification passed");

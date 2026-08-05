import type {
  AgentSettings,
  ChatMessage,
  PlannerExecutorExecutionMode,
  PlannerExecutorRouteClass,
  PlannerExecutorVerificationLevel,
  ToolCallTrace,
} from "../../src/shared/types";

export interface PlannerExecutorRouteDecision {
  routeClass: PlannerExecutorRouteClass;
  executionMode: PlannerExecutorExecutionMode;
  verificationLevel: PlannerExecutorVerificationLevel;
  score: number;
  reasons: string[];
  needsPlannerBrief: boolean;
  needsIterativeReplan: boolean;
  replanTriggers: string[];
}

export interface ExecutorQualityResult {
  score: number;
  reasons: string[];
  needsFallback: boolean;
}

const TOOL_ACTION_PATTERN = /\b(search|browse|open|click|download|read|write|edit|fix|run|execute|terminal|shell|install|build|test|deploy|commit|inspect|compare|scrape|crawl|query|fetch)\b|搜索|浏览|打开|点击|下载|读取|写入|修改|修复|运行|执行|安装|构建|测试|部署|提交|检查|抓取|查询/iu;
const CODE_CHANGE_PATTERN = /\b(code|bug|fix|refactor|implement|typescript|javascript|react|electron|api|compile|repo|repository|file|patch|diff)\b|代码|修复|实现|重构|文件|组件|接口|编译|仓库|补丁/iu;
const MULTI_STEP_PATTERN = /\b(first|then|next|after that|finally|step by step|multi[- ]step|plan|workflow)\b|先.+再|步骤|分步|多步|计划|流程|然后|最后/isu;
const REASONING_PATTERN = /\b(analyze|reason|prove|derive|debug|root cause|trade[- ]off|architecture|design|security|legal|financial|medical)\b|分析|推理|证明|根因|权衡|架构|设计|安全|法律|财务|医疗/iu;
const VERIFICATION_PATTERN = /\b(verify|validate|check|test|review|audit|confirm|evidence)\b|验证|校验|检查|测试|审查|确认|证据/iu;
const UNCERTAINTY_PATTERN = /\b(i am not sure|i'm not sure|cannot verify|can't verify|not enough evidence|unsure|uncertain|failed|error)\b|不确定|无法确认|不能确认|证据不足|失败|错误/iu;
const UNRESOLVED_PATTERN = /\b(TODO|FIXME|not implemented|unresolved|pending)\b|未完成|待办|未解决|尚未实现/iu;

function clampScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function hasPattern(pattern: RegExp, text: string) {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

export function plannerBriefNeeded(routeClass: PlannerExecutorRouteClass) {
  return routeClass === "complex" || routeClass === "reasoning" || routeClass === "agentic";
}

function resolveExecutionMode(
  routeClass: PlannerExecutorRouteClass,
  reasons: string[],
): PlannerExecutorExecutionMode {
  if (routeClass === "agentic" && (reasons.includes("multi_step") || reasons.includes("verification") || reasons.includes("attachments"))) {
    return "iterative_orchestration";
  }
  if (routeClass === "reasoning" || reasons.includes("verification")) return "verified_executor";
  if (plannerBriefNeeded(routeClass)) return "planned_executor";
  return "fast_executor";
}

function resolveVerificationLevel(
  executionMode: PlannerExecutorExecutionMode,
): PlannerExecutorVerificationLevel {
  if (executionMode === "verified_executor") return "primary";
  if (executionMode === "planned_executor" || executionMode === "iterative_orchestration") return "deterministic";
  return "none";
}

export function classifyPlannerExecutorRoute(input: {
  latestUserMessage: string;
  currentSessionContext?: string;
  attachments?: ChatMessage["attachments"];
  planningMode?: AgentSettings["planningMode"];
}): PlannerExecutorRouteDecision {
  const text = [input.latestUserMessage, input.currentSessionContext ?? ""].filter(Boolean).join("\n\n");
  const latestText = input.latestUserMessage.trim();
  const reasons: string[] = [];
  let complexity = 0;

  if (latestText.length > 280) {
    complexity += 1;
    reasons.push("long_prompt");
  }
  if (latestText.length > 1200) {
    complexity += 1;
    reasons.push("very_long_prompt");
  }
  if ((input.attachments?.length ?? 0) > 0) {
    complexity += 1;
    reasons.push("attachments");
  }
  if (hasPattern(TOOL_ACTION_PATTERN, text)) {
    complexity += 2;
    reasons.push("tool_action");
  }
  if (hasPattern(CODE_CHANGE_PATTERN, text)) {
    complexity += 1;
    reasons.push("code_or_change");
  }
  if (hasPattern(MULTI_STEP_PATTERN, text)) {
    complexity += 1;
    reasons.push("multi_step");
  }
  if (hasPattern(VERIFICATION_PATTERN, text)) {
    complexity += 1;
    reasons.push("verification");
  }
  if (hasPattern(REASONING_PATTERN, text)) {
    complexity += 2;
    reasons.push("reasoning");
  }
  if (input.planningMode === "deep" && (reasons.includes("multi_step") || reasons.includes("code_or_change") || reasons.includes("tool_action"))) {
    complexity += 1;
    reasons.push("deep_planning_mode");
  }
  if (input.planningMode === "fast" && complexity > 0) {
    complexity -= 1;
    reasons.push("fast_planning_mode");
  }

  let routeClass: PlannerExecutorRouteClass = "simple";
  if (reasons.includes("tool_action") && (reasons.includes("code_or_change") || reasons.includes("multi_step") || reasons.includes("verification"))) {
    routeClass = "agentic";
  } else if (reasons.includes("reasoning") && complexity >= 3) {
    routeClass = "reasoning";
  } else if (complexity >= 4) {
    routeClass = "complex";
  } else if (complexity >= 2) {
    routeClass = "medium";
  }

  if (input.planningMode === "deep" && routeClass === "medium" && !reasons.includes("fast_planning_mode")) {
    routeClass = "complex";
  }
  if (routeClass === "simple" && reasons.includes("attachments")) {
    routeClass = "medium";
  }

  const executionMode = resolveExecutionMode(routeClass, reasons);
  const verificationLevel = resolveVerificationLevel(executionMode);
  const needsIterativeReplan = executionMode === "iterative_orchestration";
  const replanTriggers = needsIterativeReplan
    ? reasons.filter((reason) => ["tool_action", "multi_step", "verification", "attachments", "reasoning"].includes(reason))
    : [];

  return {
    routeClass,
    executionMode,
    verificationLevel,
    score: complexity,
    reasons: reasons.length ? reasons : ["short_direct_prompt"],
    needsPlannerBrief: executionMode === "planned_executor"
      || executionMode === "verified_executor"
      || executionMode === "iterative_orchestration",
    needsIterativeReplan,
    replanTriggers,
  };
}

export function evaluateExecutorQuality(input: {
  content: string;
  toolCalls: ToolCallTrace[];
  routeClass: PlannerExecutorRouteClass;
  threshold: number;
  contextOverflow?: boolean;
  circuitBreaker?: boolean;
}): ExecutorQualityResult {
  const reasons: string[] = [];
  let score = 1;
  const content = input.content.trim();
  const toolErrors = input.toolCalls.filter((toolCall) => toolCall.status === "error" || String(toolCall.output ?? "").trim().startsWith("Error:"));

  if (!content) {
    score -= 0.55;
    reasons.push("empty_output");
  }
  if (toolErrors.length) {
    score -= 0.35;
    reasons.push("tool_error");
  }
  if (input.contextOverflow) {
    score -= 0.5;
    reasons.push("context_overflow");
  }
  if (input.circuitBreaker) {
    score -= 0.45;
    reasons.push("circuit_breaker");
  }
  if (hasPattern(UNCERTAINTY_PATTERN, content)) {
    score -= 0.18;
    reasons.push("explicit_uncertainty");
  }
  if (hasPattern(UNRESOLVED_PATTERN, content)) {
    score -= 0.22;
    reasons.push("unresolved_marker");
  }
  if (input.routeClass === "agentic" && input.toolCalls.length === 0) {
    score -= 0.25;
    reasons.push("missing_expected_tool_evidence");
  }
  if (input.routeClass === "reasoning" && hasPattern(UNCERTAINTY_PATTERN, content)) {
    score -= 0.08;
    reasons.push("reasoning_uncertainty");
  }

  const normalizedScore = clampScore(score);
  const threshold = Math.max(0, Math.min(1, input.threshold));
  return {
    score: normalizedScore,
    reasons,
    needsFallback: normalizedScore < threshold,
  };
}

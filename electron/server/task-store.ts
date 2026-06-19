import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DATA_DIR, TASKS_FILE } from "./config";
import type { ScheduledTask } from "./types";

export const taskStore: ScheduledTask[] = [];

const loadTasksPromise = (async () => {
  try {
    const raw = await fs.readFile(TASKS_FILE, "utf8");
    const parsed = JSON.parse(raw) as ScheduledTask[];
    taskStore.splice(0, taskStore.length, ...parsed);
  } catch {
    // No persisted tasks yet.
  }
})();

export async function ensureTasksLoaded() {
  await loadTasksPromise;
}

export async function saveTasks() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TASKS_FILE, JSON.stringify(taskStore, null, 2), "utf8");
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return NaN;
}

function readBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function validateCronField(field: string, min: number, max: number) {
  return field.split(",").every((part) => {
    const item = part.trim();
    if (!item) return false;

    const [rangePart, stepPart] = item.split("/");
    if (stepPart !== undefined) {
      const step = Number(stepPart);
      if (!Number.isInteger(step) || step <= 0) return false;
    }

    if (rangePart === "*") return true;

    if (rangePart.includes("-")) {
      const [start, end] = rangePart.split("-").map(Number);
      return Number.isInteger(start) && Number.isInteger(end) && start <= end && start >= min && end <= max;
    }

    const value = Number(rangePart);
    return Number.isInteger(value) && value >= min && value <= max;
  });
}

export function validateCronExpression(cron: string) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return validateCronField(minute, 0, 59)
    && validateCronField(hour, 0, 23)
    && validateCronField(dayOfMonth, 1, 31)
    && validateCronField(month, 1, 12)
    && validateCronField(dayOfWeek, 0, 7);
}

function cronFromDate(date: Date) {
  return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
}

function parseRunAt(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("runAt must be an ISO 8601 datetime or another Date-parseable value.");
  }
  return parsed;
}

export async function createScheduledTask(input: Record<string, unknown>) {
  await ensureTasksLoaded();

  const prompt = readString(input.prompt);
  if (!prompt) throw new Error("Missing required argument: prompt");

  const name = readString(input.name) || `Reminder: ${prompt.slice(0, 24)}${prompt.length > 24 ? "..." : ""}`;
  const explicitCron = readString(input.cron);
  const delayMinutes = readNumber(input.delayMinutes ?? input.delay_minutes);
  const runAt = parseRunAt(input.runAt ?? input.run_at);
  const target = runAt ?? (Number.isFinite(delayMinutes) ? new Date(Date.now() + delayMinutes * 60_000) : null);

  let cron = explicitCron;
  let inferredRunOnce = false;

  if (!cron) {
    if (!target) {
      throw new Error("Provide either cron, runAt, or delayMinutes.");
    }
    if (target.getTime() <= Date.now()) {
      throw new Error("runAt or delayMinutes must point to a future time.");
    }
    cron = cronFromDate(target);
    inferredRunOnce = true;
  }

  if (!validateCronExpression(cron)) {
    throw new Error("Cron expression must have 5 valid fields: minute hour day-of-month month day-of-week.");
  }

  const task: ScheduledTask = {
    id: randomUUID(),
    name,
    cron,
    prompt,
    enabled: readBoolean(input.enabled, true),
    runOnce: readBoolean(input.runOnce ?? input.run_once, inferredRunOnce),
    ...(target && !explicitCron ? { runAt: target.toISOString() } : {}),
    createdAt: new Date().toISOString(),
  };

  taskStore.push(task);
  await saveTasks();
  return task;
}

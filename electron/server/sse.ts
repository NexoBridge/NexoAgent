import type { StreamEvent } from "./types";

const sseQueues = new Map<string, StreamEvent[]>();
const sseWaiters = new Map<string, (() => void)[]>();
const sseCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SSE_QUEUE_RETAIN_MS = 60_000;

export function createSseQueue(requestId: string) {
  const timer = sseCleanupTimers.get(requestId);
  if (timer) {
    clearTimeout(timer);
    sseCleanupTimers.delete(requestId);
  }
  sseQueues.set(requestId, []);
  sseWaiters.set(requestId, []);
}

export function scheduleSseCleanup(requestId: string) {
  if (sseCleanupTimers.has(requestId)) return;
  const timer = setTimeout(() => {
    sseQueues.delete(requestId);
    sseWaiters.delete(requestId);
    sseCleanupTimers.delete(requestId);
  }, SSE_QUEUE_RETAIN_MS);
  timer.unref?.();
  sseCleanupTimers.set(requestId, timer);
}

export function pushEvent(requestId: string, event: StreamEvent) {
  const queue = sseQueues.get(requestId) ?? [];
  queue.push(event);
  sseQueues.set(requestId, queue);

  const waiters = sseWaiters.get(requestId) ?? [];
  sseWaiters.set(requestId, []);
  waiters.forEach((fn) => fn());
}

export function hasSseQueue(requestId: string) {
  return sseQueues.has(requestId);
}

export function getSseQueue(requestId: string) {
  return sseQueues.get(requestId) ?? [];
}

export function getSseWaiters(requestId: string) {
  return sseWaiters.get(requestId) ?? [];
}

export function setSseWaiters(requestId: string, waiters: (() => void)[]) {
  sseWaiters.set(requestId, waiters);
}

export function deleteSseWaiters(requestId: string) {
  sseWaiters.delete(requestId);
}

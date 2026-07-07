const interruptedRuns = new Set<string>();
const runControllers = new Map<string, AbortController>();

export function registerRun(requestId: string) {
  interruptedRuns.delete(requestId);
  runControllers.get(requestId)?.abort();
  runControllers.set(requestId, new AbortController());
}

export function interruptRun(requestId: string) {
  interruptedRuns.add(requestId);
  runControllers.get(requestId)?.abort();
}

export function isRunInterrupted(requestId: string) {
  return interruptedRuns.has(requestId);
}

export function getRunAbortSignal(requestId?: string) {
  if (!requestId) return undefined;
  return runControllers.get(requestId)?.signal;
}

export function clearRun(requestId: string) {
  interruptedRuns.delete(requestId);
  runControllers.delete(requestId);
}

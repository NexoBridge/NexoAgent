import { serverLog } from "./logger";
import { toErrorLog, toErrorMessage } from "./utils";

export const AI_REQUEST_MAX_RETRIES = 5;

function errorMessage(error: unknown) {
  return toErrorMessage(error);
}

function errorAfterRetries(error: unknown, attempts: number) {
  return new Error(`${errorMessage(error)} (after ${attempts} AI request attempts)`);
}

type RetryOptions = {
  maxRetries?: number;
  label?: string;
  shouldRetry?: (error: unknown) => boolean;
};

function resolveRetryOptions(
  maxRetriesOrOptions: number | RetryOptions | undefined,
  fallbackLabel: string,
): { maxRetries: number; label: string; shouldRetry: (error: unknown) => boolean } {
  if (typeof maxRetriesOrOptions === "number") {
    return { maxRetries: maxRetriesOrOptions, label: fallbackLabel, shouldRetry: () => true };
  }
  return {
    maxRetries: maxRetriesOrOptions?.maxRetries ?? AI_REQUEST_MAX_RETRIES,
    label: maxRetriesOrOptions?.label || fallbackLabel,
    shouldRetry: maxRetriesOrOptions?.shouldRetry ?? (() => true),
  };
}

export async function withAiRequestRetries<T>(
  operation: () => Promise<T>,
  maxRetriesOrOptions: number | RetryOptions = AI_REQUEST_MAX_RETRIES,
): Promise<T> {
  const { maxRetries, label, shouldRetry } = resolveRetryOptions(maxRetriesOrOptions, "AI request");
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error)) throw error;
      if (attempt < maxRetries) {
        serverLog(`WARN ${label} failed on attempt ${attempt + 1}/${maxRetries + 1}; retrying. ${errorMessage(error)}`);
      }
    }
  }
  serverLog(`ERROR ${label} exhausted ${maxRetries + 1} attempt(s). ${toErrorLog(lastError)}`);
  throw errorAfterRetries(lastError, maxRetries + 1);
}

export async function* streamWithAiRequestRetries<T>(
  createStream: () => Promise<AsyncIterable<T>>,
  maxRetriesOrOptions: number | RetryOptions = AI_REQUEST_MAX_RETRIES,
): AsyncGenerator<T> {
  const chunks = await collectStreamWithAiRequestRetries(createStream, maxRetriesOrOptions);
  for (const chunk of chunks) {
    yield chunk;
  }
}

export async function collectStreamWithAiRequestRetries<T>(
  createStream: () => Promise<AsyncIterable<T>>,
  maxRetriesOrOptions: number | RetryOptions = AI_REQUEST_MAX_RETRIES,
): Promise<T[]> {
  const { maxRetries, label, shouldRetry } = resolveRetryOptions(maxRetriesOrOptions, "AI stream request");
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const chunks: T[] = [];
    try {
      const stream = await createStream();
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      if (attempt > 0) {
        serverLog(`INFO ${label} succeeded on attempt ${attempt + 1}/${maxRetries + 1} after retry.`);
      }
      return chunks;
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error)) throw error;
      if (attempt < maxRetries) {
        serverLog(
          `WARN ${label} failed on attempt ${attempt + 1}/${maxRetries + 1} after ${chunks.length} buffered chunk(s); retrying. ${errorMessage(error)}`,
        );
      }
    }
  }
  serverLog(`ERROR ${label} exhausted ${maxRetries + 1} attempt(s). ${toErrorLog(lastError)}`);
  throw errorAfterRetries(lastError, maxRetries + 1);
}

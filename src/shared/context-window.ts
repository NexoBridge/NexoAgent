export const CONTEXT_WINDOW_256K = 256_000;
export const CONTEXT_WINDOW_500K = 500_000;
export const CONTEXT_WINDOW_PRESETS = [CONTEXT_WINDOW_256K, CONTEXT_WINDOW_500K] as const;
export const CONTEXT_ARCHIVE_SOURCE = "context_window_archive";

export type ContextWindowPreset = (typeof CONTEXT_WINDOW_PRESETS)[number];

export function isContextWindowPreset(value: unknown): value is ContextWindowPreset {
  return value === CONTEXT_WINDOW_256K || value === CONTEXT_WINDOW_500K;
}

export function normalizeContextWindowTokens(value: unknown): ContextWindowPreset {
  return value === CONTEXT_WINDOW_500K ? CONTEXT_WINDOW_500K : CONTEXT_WINDOW_256K;
}

export function isContextWindowArchiveMetadata(metadata?: Record<string, unknown> | null) {
  return metadata?.source === CONTEXT_ARCHIVE_SOURCE;
}

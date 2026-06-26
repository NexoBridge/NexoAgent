import path from "node:path";
import { serverLog } from "./logger";

const BROWSER_SEMANTIC_MODEL = "Xenova/all-MiniLM-L6-v2" as const;
const EMBEDDING_TIMEOUT_MS = 900;
const BROWSER_MODEL_DIR = path.join(process.cwd(), "nexo", "models", "browser-resolver");

type FeatureExtractionPipeline = (
  input: string | string[],
  options?: { pooling?: "mean"; normalize?: boolean }
) => Promise<unknown>;

type EmbedResult = {
  vectors: Map<string, number[]>;
  ready: boolean;
  pending: boolean;
  error?: string;
};

function dynamicImport<T = unknown>(specifier: string): Promise<T> {
  const importer = new Function("specifier", "return import(specifier)") as (value: string) => Promise<T>;
  return importer(specifier);
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
  ]);
}

function coerceVectors(output: unknown, expectedCount: number): number[][] {
  const candidate = output as {
    data?: Iterable<number>;
    dims?: number[];
    tolist?: () => unknown;
  };

  const listed = typeof candidate?.tolist === "function" ? candidate.tolist() : undefined;
  if (Array.isArray(listed)) {
    if (listed.length > 0 && Array.isArray(listed[0])) {
      return (listed as unknown[][]).map((row) => row.map((value) => Number(value)));
    }
    if (expectedCount === 1) {
      return [(listed as unknown[]).map((value) => Number(value))];
    }
  }

  const data = candidate?.data ? Array.from(candidate.data, Number) : [];
  if (!data.length) return [];
  const dims = candidate?.dims ?? [];
  const width = dims.length >= 2
    ? Math.max(1, Math.floor(dims[dims.length - 1] ?? 0))
    : Math.max(1, Math.floor(data.length / Math.max(1, expectedCount)));
  const vectors: number[][] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    vectors.push(data.slice(index * width, (index + 1) * width));
  }
  return vectors;
}

class BrowserEmbeddingService {
  readonly model = BROWSER_SEMANTIC_MODEL;
  private extractor: FeatureExtractionPipeline | null = null;
  private loadingPromise: Promise<FeatureExtractionPipeline | null> | null = null;
  private vectorCache = new Map<string, number[]>();
  private lastError = "";

  warmup() {
    void this.load();
  }

  status() {
    return {
      model: this.model,
      ready: Boolean(this.extractor),
      pending: Boolean(this.loadingPromise && !this.extractor),
      error: this.lastError || undefined,
    };
  }

  private async load(): Promise<FeatureExtractionPipeline | null> {
    if (this.extractor) return this.extractor;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        const mod = await dynamicImport<{
          env?: {
            allowLocalModels?: boolean;
            allowRemoteModels?: boolean;
            localModelPath?: string;
            cacheDir?: string;
          };
          pipeline?: (task: string, model: string) => Promise<FeatureExtractionPipeline>;
        }>("@xenova/transformers");
        if (!mod.pipeline) {
          throw new Error("@xenova/transformers did not expose pipeline()");
        }
        if (mod.env) {
          mod.env.allowLocalModels = true;
          mod.env.allowRemoteModels = true;
          mod.env.localModelPath = BROWSER_MODEL_DIR;
          mod.env.cacheDir = BROWSER_MODEL_DIR;
        }
        this.extractor = await mod.pipeline("feature-extraction", BROWSER_SEMANTIC_MODEL);
        this.lastError = "";
        return this.extractor;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        serverLog(`[browser-resolver] MiniLM unavailable, falling back to DOM scoring: ${this.lastError}`);
        return null;
      } finally {
        this.loadingPromise = null;
      }
    })();

    return this.loadingPromise;
  }

  async embed(texts: string[], waitMs = EMBEDDING_TIMEOUT_MS): Promise<EmbedResult> {
    const uniqueTexts = [...new Set(texts.map((text) => text.trim()).filter(Boolean))];
    const vectors = new Map<string, number[]>();
    for (const text of uniqueTexts) {
      const cached = this.vectorCache.get(text);
      if (cached) vectors.set(text, cached);
    }

    const missing = uniqueTexts.filter((text) => !vectors.has(text));
    if (!missing.length) {
      return { vectors, ready: Boolean(this.extractor), pending: false, error: this.lastError || undefined };
    }

    const extractorOrTimeout = await timeout(this.load(), waitMs);
    if (extractorOrTimeout === "timeout") {
      return { vectors, ready: false, pending: true, error: this.lastError || undefined };
    }
    if (!extractorOrTimeout) {
      return { vectors, ready: false, pending: false, error: this.lastError || "MiniLM is unavailable." };
    }

    try {
      const output = await extractorOrTimeout(missing, { pooling: "mean", normalize: true });
      const nextVectors = coerceVectors(output, missing.length);
      missing.forEach((text, index) => {
        const vector = nextVectors[index];
        if (!vector?.length) return;
        this.vectorCache.set(text, vector);
        vectors.set(text, vector);
      });
      this.lastError = "";
      return { vectors, ready: true, pending: false };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      serverLog(`[browser-resolver] MiniLM embedding failed: ${this.lastError}`);
      return { vectors, ready: Boolean(this.extractor), pending: false, error: this.lastError };
    }
  }
}

export const browserEmbeddingService = new BrowserEmbeddingService();

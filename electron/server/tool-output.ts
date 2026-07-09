import { Buffer } from "node:buffer";
import type { ToolOutputStats, ToolRawOutputRef } from "../../src/shared/types";

export interface BoundedToolOutput {
  modelOutput: string;
  displayOutput: string;
  outputSummary?: string;
  outputPreview?: string;
  rawOutput?: ToolRawOutputRef;
  outputStats: ToolOutputStats;
}

interface NormalizeToolOutputOptions {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
}

function byteLength(text: string) {
  return Buffer.byteLength(text, "utf8");
}

export async function normalizeToolOutputForModel(options: NormalizeToolOutputOptions): Promise<BoundedToolOutput> {
  const output = options.output;
  const originalBytes = byteLength(output);
  const outputStats: ToolOutputStats = {
    originalChars: output.length,
    originalBytes,
    inlineChars: output.length,
    previewChars: output.length,
    truncated: false,
    reason: "inline",
  };

  return {
    modelOutput: output,
    displayOutput: output,
    outputPreview: output,
    outputStats,
  };
}

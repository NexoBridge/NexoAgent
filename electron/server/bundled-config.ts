import fs from "node:fs/promises";
import path from "node:path";

const BUNDLED_DIR_NAME = "nexo";

function bundledDirCandidates() {
  return [
    path.join(process.cwd(), BUNDLED_DIR_NAME),
    path.join(__dirname, "..", "..", "..", BUNDLED_DIR_NAME),
  ];
}

export async function resolveBundledFile(filename: string) {
  for (const dir of bundledDirCandidates()) {
    const fullPath = path.join(dir, filename);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Bundled config not found: ${filename}`);
}

export async function readBundledJson<T>(filename: string): Promise<T> {
  const fullPath = await resolveBundledFile(filename);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw) as T;
}

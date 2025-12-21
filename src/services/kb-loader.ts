/**
 * Knowledge Base Loader
 *
 * Provides access to the bundled KB files and utilities for seeding
 * the database. The actual file content comes from the auto-generated
 * kb-manifest.ts (created by scripts/generate-kb-manifest.ts).
 */

import { Env } from "../index";
import { buildKB } from "./kb-builder";
import { kbFiles } from "./kb-manifest";

/**
 * Seeds the Knowledge Base by building it from bundled markdown files.
 * This is typically called once during initial setup or when KB content updates.
 */
export async function seedKB(
  env: Env
): Promise<{ chunks: number; files: number }> {
  const result = await buildKB(env, kbFiles);

  return {
    chunks: result.chunks,
    files: kbFiles.size,
  };
}

/**
 * Returns the map of KB files (path -> content).
 * Useful for inspection or custom processing.
 */
export function loadKBFiles(): Map<string, string> {
  return kbFiles;
}

/**
 * Returns statistics about the loaded KB files.
 * Useful for the demo UI and debugging.
 */
export function getKBStats(): {
  totalFiles: number;
  byCategory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};

  for (const filePath of kbFiles.keys()) {
    // The category is the first folder in the path
    const category = filePath.split("/")[0] || "unknown";
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  return {
    totalFiles: kbFiles.size,
    byCategory,
  };
}

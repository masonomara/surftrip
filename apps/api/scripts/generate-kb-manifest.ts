/**
 * KB Manifest Generator
 *
 * Scans the /kb directory for markdown files and generates a TypeScript
 * manifest file that imports them all. This lets us bundle KB content
 * directly into the worker.
 *
 * Run: npx tsx scripts/generate-kb-manifest.ts
 */

import { readdirSync, statSync, writeFileSync } from "fs";
import { join, relative } from "path";

const KB_DIRECTORY = join(process.cwd(), "kb");
const OUTPUT_PATH = join(process.cwd(), "src/services/kb-manifest.ts");

/**
 * Recursively finds all .md files in a directory
 */
function findMarkdownFiles(directory: string): string[] {
  const markdownFiles: string[] = [];

  const entries = readdirSync(directory);

  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      // Recurse into subdirectories
      const nestedFiles = findMarkdownFiles(fullPath);
      markdownFiles.push(...nestedFiles);
    } else if (entry.endsWith(".md")) {
      markdownFiles.push(fullPath);
    }
  }

  return markdownFiles;
}

/**
 * Generates the TypeScript import statement for a file
 */
function generateImport(filePath: string, index: number): string {
  const relativePath = relative(process.cwd(), filePath).replace(/\\/g, "/");
  return `import kb${index} from "../../${relativePath}";`;
}

/**
 * Generates a Map entry for a file (maps kb-relative path to content)
 */
function generateMapEntry(filePath: string, index: number): string {
  const kbRelativePath = relative(KB_DIRECTORY, filePath).replace(/\\/g, "/");
  return `  ["${kbRelativePath}", kb${index}],`;
}

// Find all markdown files
const files = findMarkdownFiles(KB_DIRECTORY);

// Generate import statements
const importStatements = files.map(generateImport).join("\n");

// Generate map entries
const mapEntries = files.map(generateMapEntry).join("\n");

// Assemble the output file
const outputContent = `// AUTO-GENERATED - Run: npx tsx scripts/generate-kb-manifest.ts

${importStatements}

export const kbFiles: Map<string, string> = new Map([
${mapEntries}
]);
`;

// Write the manifest
writeFileSync(OUTPUT_PATH, outputContent);
console.log(`Generated ${OUTPUT_PATH} with ${files.length} files`);

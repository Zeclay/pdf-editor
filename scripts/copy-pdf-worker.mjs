/**
 * Copies the pdf.js worker that matches the INSTALLED pdfjs-dist version
 * into /public, so it's served as a plain static file at /pdf.worker.min.mjs.
 *
 * Runs automatically via the predev/prebuild hooks in package.json.
 * This avoids bundler-specific `new URL(..., import.meta.url)` handling,
 * which 404s under Next.js webpack ("Setting up fake worker failed").
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let workerPath;
try {
  // Hoisted install (most common)
  workerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
} catch {
  // Nested under react-pdf's own node_modules
  const reactPdfDir = dirname(require.resolve("react-pdf/package.json"));
  workerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs", {
    paths: [reactPdfDir],
  });
}

const dest = join(process.cwd(), "public", "pdf.worker.min.mjs");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(workerPath, dest);
console.log(`✓ pdf.js worker copied: ${workerPath} -> ${dest}`);

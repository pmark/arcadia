#!/usr/bin/env node
// Arcadia's self-contained objective check for protected preservation.
//
// The preservation sandbox runs this against the immutable candidate tree with
// only Node's built-in modules: no network, no writes, and no installed
// dependencies. It therefore validates facts that are true of the tracked tree
// itself -- required control documents, parseable JSON, no unresolved merge
// conflicts, and resolvable relative imports. It is a preservation gate, not a
// replacement for `pnpm test` and the builds, which run outside the sandbox at
// Action completion. Exit 0 on success; exit 1 and print every failure otherwise.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED_FILES = [
  "CONSTITUTION.md",
  "AGENTS.md",
  "PROJECT.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml"
];

const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".turbo", ".cache", "node_modules", "dist", "build", "out", "coverage", "tmp", "temp"
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml"
]);

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) walk(full, files);
      continue;
    }
    if (entry.isFile()) files.push(full);
  }
}

const files = [];
walk(root, files);
const relative = (file) => path.relative(root, file).split(path.sep).join("/");

for (const required of REQUIRED_FILES) {
  if (!existsSync(path.join(root, required))) failures.push(`missing required file: ${required}`);
}

for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && !CODE_EXTENSIONS.has(extension)) continue;
  const contents = readFileSync(file, "utf8");
  if (/^(?:<{7}(?: |$)|\|{7}(?: |$)|>{7}(?: |$))/m.test(contents)) {
    failures.push(`unresolved merge conflict markers: ${relative(file)}`);
  }
}

for (const file of files) {
  if (path.extname(file).toLowerCase() !== ".json") continue;
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`invalid JSON: ${relative(file)} (${error instanceof Error ? error.message : String(error)})`);
  }
}

const RESOLUTION_SUFFIXES = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"];

function resolves(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base];
  if (/\.(?:js|mjs|cjs)$/.test(specifier)) {
    candidates.push(base.replace(/\.(?:js|mjs|cjs)$/, ".ts"), base.replace(/\.(?:js|mjs|cjs)$/, ".tsx"));
  }
  for (const suffix of RESOLUTION_SUFFIXES) candidates.push(`${base}${suffix}`);
  for (const suffix of RESOLUTION_SUFFIXES) candidates.push(path.join(base, `index${suffix}`));
  return candidates.some((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

for (const file of files) {
  if (!CODE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
  if (!/(^|\/)src\//.test(`/${relative(file)}`) && !relative(file).startsWith("apps/")) continue;
  const contents = readFileSync(file, "utf8");
  const specifiers = [
    ...contents.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g),
    ...contents.matchAll(/import\s*\(\s*["'](\.[^"']+)["']\s*\)/g)
  ].map((match) => match[1]);
  for (const specifier of new Set(specifiers)) {
    if (!resolves(file, specifier)) failures.push(`unresolved relative import: ${relative(file)} -> ${specifier}`);
  }
}

if (failures.length) {
  console.error(`preservation self-check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`preservation self-check passed (${files.length} files inspected)`);

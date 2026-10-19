#!/usr/bin/env node
// Deterministic, duration-balanced Vitest sharding for CI.
//
// `vitest --shard=N/M` splits by file-path hash, so one shard can draw several
// of the slow CLI-subprocess suites (observed 278s vs 420s for the same suite).
// This prints the files for shard N of M using a longest-processing-time
// greedy split over checked-in weights (scripts/ci-test-weights.json, seconds).
// Files without a weight take the median weight, so a new test file is still
// assigned to exactly one shard. Discovery uses `vitest list`, so the file set
// is exactly the set a plain `vitest run` would execute (no test is skipped).
//
// Usage: node scripts/ci-test-shard.mjs <index> <total>   (1-based, prints one path per line)
//        node scripts/ci-test-shard.mjs --check <total>   (every file in exactly one shard)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

export function listTestFiles() {
  const out = execFileSync("pnpm", ["exec", "vitest", "list", "--filesOnly"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024
  });
  return out.split("\n").map((l) => l.trim()).filter((l) => /\.test\.[cm]?[jt]sx?$/.test(l)).sort();
}

export function loadWeights() {
  return JSON.parse(readFileSync(path.join(root, "scripts", "ci-test-weights.json"), "utf8")).weights;
}

export function partition(files, weights, total) {
  const known = files.map((f) => weights[f]).filter((w) => typeof w === "number").sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weighted = files.map((file) => ({ file, weight: typeof weights[file] === "number" ? weights[file] : median }));
  // Heaviest first; ties by path so the result never depends on discovery order.
  weighted.sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : 1));
  const shards = Array.from({ length: total }, () => ({ load: 0, files: [] }));
  for (const item of weighted) {
    let target = shards[0];
    for (const shard of shards) if (shard.load < target.load) target = shard;
    target.files.push(item.file);
    target.load += item.weight;
  }
  return shards;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b] = process.argv.slice(2);
  const files = listTestFiles();
  const weights = loadWeights();
  if (a === "--check") {
    const total = Number(b);
    const shards = partition(files, weights, total);
    const seen = shards.flatMap((s) => s.files);
    if (seen.length !== files.length || new Set(seen).size !== files.length) {
      console.error("shard partition does not cover every test file exactly once");
      process.exit(1);
    }
    // Vitest treats positional arguments as substring filters, so no file path may contain another.
    for (const f of files) for (const g of files) if (f !== g && g.includes(f)) { console.error(`${g} also matches filter ${f}`); process.exit(1); }
    console.log(shards.map((s, i) => `shard ${i + 1}: ${s.files.length} files, ~${Math.round(s.load)}s`).join("\n"));
  } else {
    const index = Number(a);
    const total = Number(b);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
      console.error("usage: ci-test-shard.mjs <index> <total>");
      process.exit(2);
    }
    const shard = partition(files, weights, total)[index - 1];
    if (!shard.files.length) { console.error(`shard ${index}/${total} is empty`); process.exit(1); }
    console.log(shard.files.join("\n"));
  }
}

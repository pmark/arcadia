// Deterministic guard (#2488): tracked files over 1 MiB must be allowlisted at
// their recorded size, and the whole tracked tree must stay under its cap.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024;
export const FILE_LIMIT = MiB;
export const TREE_LIMIT = 62 * MiB; // under the 64 MiB host capture limit

export function evaluate(files, allowlist) {
  const errors = [];
  let total = 0;
  for (const { path: p, size } of files) {
    total += size;
    if (size <= FILE_LIMIT) continue;
    const recorded = allowlist[p];
    if (recorded === undefined) errors.push(`${p} is ${size} bytes (over 1 MiB) and not in the allowlist.`);
    else if (size > recorded) errors.push(`${p} grew to ${size} bytes; the allowlist records ${recorded}.`);
  }
  if (total > TREE_LIMIT) errors.push(`Tracked tree is ${(total / MiB).toFixed(1)} MiB, over the ${TREE_LIMIT / MiB} MiB cap.`);
  return { errors, total };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const allowlist = JSON.parse(readFileSync(path.join(root, "scripts/large-files-allowlist.json"), "utf8"));
  const names = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean);
  const files = names.flatMap((p) => {
    try { return [{ path: p, size: statSync(path.join(root, p)).size }]; } catch { return []; }
  });
  const { errors, total } = evaluate(files, allowlist);
  process.stdout.write(`tracked tree: ${(total / MiB).toFixed(2)} MiB (cap ${TREE_LIMIT / MiB} MiB)\n`);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\nStore large assets outside the repository; do not commit them. See #2488.\n`);
    process.exit(1);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();

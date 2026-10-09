import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The e2e fixture sets `ARCADIA_DASHBOARD_CLI=built`, so the dashboard spawns
 * `dist/src/cli.js`, not `src/`. Neither `package.json` nor Playwright builds
 * first, so a change made only in `src/` could pass e2e locally against an old
 * `dist` (#1106). CI builds before `pnpm test:e2e`, so there `dist` is always
 * newer than the checkout and this passes.
 *
 * Returns the refusal message when `dist/src/cli.js` is missing or older than
 * the newest file under `src/`, and `null` when it is fresh.
 */
export function staleBuiltCliMessage(repoRoot: string): string | null {
  const builtCli = path.join(repoRoot, "dist", "src", "cli.js");
  if (!existsSync(builtCli)) {
    return `e2e runs the built CLI but ${builtCli} does not exist. Run \`pnpm build\` first.`;
  }
  const newest = newestSourceFile(path.join(repoRoot, "src"));
  if (newest && newest.mtimeMs > statSync(builtCli).mtimeMs) {
    return [
      "e2e runs the built CLI (dist/), which is older than src/, so it would test stale code.",
      `Newest source: ${path.relative(repoRoot, newest.file)}.`,
      "Run `pnpm build` first."
    ].join(" ");
  }
  return null;
}

function newestSourceFile(directory: string): { file: string; mtimeMs: number } | null {
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const candidate = entry.isDirectory()
      ? newestSourceFile(full)
      : /\.(ts|tsx|mts|cts|json)$/.test(entry.name)
        ? { file: full, mtimeMs: statSync(full).mtimeMs }
        : null;
    if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) newest = candidate;
  }
  return newest;
}

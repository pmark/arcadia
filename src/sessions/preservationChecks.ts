/** Preservation checks run inside the host Seatbelt sandbox against the
 * immutable candidate tree: only the tracked regular files, no network, no
 * writes outside the private scratch, and a PATH of node plus the system
 * binaries. A declared check that needs an installed dependency tree cannot run
 * there, and refusing it before execution with a named remedy is clearer than
 * the misleading "ready, then failed" the sandbox would otherwise produce.
 *
 * This module only classifies a command string; it never executes anything and
 * it does not weaken the sandbox. Unknown commands are executed and still fail
 * closed. The dependency-aware host-side path is separate governed work. */

export const PRESERVATION_DEPENDENCY_CODE = "validation_requires_dependencies";

export const PRESERVATION_DEPENDENCY_REMEDY =
  "This declared preservation check needs installed dependencies the preservation sandbox's immutable tracked tree does not contain. " +
  "Declare a self-contained check that uses only tracked files and node or system tools (for example `node scripts/preservation-self-check.mjs`), " +
  "and run the dependency-requiring check outside the sandbox at Action completion.";

const DEPENDENCY_TOOLS = new Set([
  // Package managers and dependency-resolving toolchains.
  "pnpm", "npm", "yarn", "bun", "npx", "corepack",
  "cargo", "go", "poetry", "uv", "pip", "pip3", "gem", "composer",
  "make", "cmake", "gradle", "mvn", "gyp", "node-gyp",
  // Container and orchestration tools start from an image, not the tree.
  "docker", "podman", "docker-compose", "kubectl", "helm"
]);

const PROJECT_BINARIES = new Set([
  // Binaries installed under node_modules/.bin rather than the system PATH.
  "vitest", "tsc", "tsx", "ts-node", "eslint", "next", "vite", "vite-node",
  "jest", "playwright", "astro", "esbuild", "tsup", "turbo", "prettier",
  "nodemon", "concurrently", "rimraf", "cross-env", "husky", "lint-staged",
  "rollup", "webpack", "parcel"
]);

const NETWORK_OR_VCS_TOOLS = new Set([
  "curl", "wget", "ssh", "scp", "rsync", "git", "gh", "nc", "telnet", "ftp", "sftp"
]);

export interface PreservationCheckDependency {
  command: string;
  tool: string;
  remedy: string;
}

/** Return the first declared command that cannot run in the sandbox because it
 * needs installed dependencies, or null when every command is self-contained. */
export function dependencyRequiringPreservationCheck(commands: string[]): PreservationCheckDependency | null {
  for (const command of commands) {
    if (typeof command !== "string" || !command.trim()) continue;
    const tool = dependencyTool(command);
    if (!tool) continue;
    return {
      command,
      tool,
      remedy: `${PRESERVATION_DEPENDENCY_REMEDY} Offending command: \`${command}\` (needs ${tool}).`
    };
  }
  return null;
}

function dependencyTool(command: string): string | null {
  if (/node_modules/.test(command)) return "node_modules";
  const tokens = command.split(/[\s;|&()<>`'"]+/).filter(Boolean);
  for (const token of tokens) {
    const base = token.split("/").pop() ?? token;
    if (DEPENDENCY_TOOLS.has(base) || PROJECT_BINARIES.has(base) || NETWORK_OR_VCS_TOOLS.has(base)) return base;
  }
  return null;
}

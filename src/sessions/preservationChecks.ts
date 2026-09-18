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

/** Python modules that are installed rather than shipped with the interpreter.
 * `python -m <module>` is only a dependency signal for these; standard-library
 * modules stay self-contained. */
const DEPENDENCY_PYTHON_MODULES = new Set([
  "pytest", "coverage", "black", "ruff", "mypy", "isort", "flake8", "pylint",
  "pyright", "bandit", "tox", "nose", "nose2", "setuptools", "pip", "build",
  "wheel", "twine", "poetry", "pipenv", "sphinx", "mkdocs", "uvicorn", "gunicorn"
]);

/** Tokens that wrap another executable, so the command follows them. */
const LAUNCHER_TOKENS = new Set(["env", "sudo", "command", "nohup", "time", "exec", "nice", "stdbuf"]);

/** Launcher options that consume the next token, so `sudo -u user vitest`
 * resolves to `vitest` rather than to the value `user` or the flag `-u`. */
const LAUNCHER_VALUE_OPTIONS: Record<string, Set<string>> = {
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
  sudo: new Set(["-u", "--user", "-g", "--group", "-p", "--prompt", "-C", "--close-from",
    "-h", "--host", "-r", "--role", "-t", "--type", "-U", "--other-user"]),
  nice: new Set(["-n", "--adjustment"]),
  stdbuf: new Set(["-i", "--input", "-o", "--output", "-e", "--error"])
};

const SHELL_SEGMENT = /(?:&&|\|\||[;&|()`\n])/;

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
  // Only executable positions count. Scanning every token flagged a
  // self-contained check whose argument or filename merely happened to be
  // named `git`, `curl`, or `vitest`, which would refuse a runnable check.
  for (const segment of command.split(SHELL_SEGMENT)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const executable = firstExecutable(tokens);
    if (!executable) continue;
    const base = executable.split("/").pop() ?? executable;
    if (DEPENDENCY_TOOLS.has(base) || PROJECT_BINARIES.has(base) || NETWORK_OR_VCS_TOOLS.has(base)) return base;
    const pythonModule = dependencyPythonModule(base, tokens);
    if (pythonModule) return `python -m ${pythonModule}`;
  }
  return null;
}

function firstExecutable(tokens: string[]): string | null {
  let index = 0;
  let launcher: string | null = null;
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    if (LAUNCHER_TOKENS.has(token)) {
      launcher = token;
      index += 1;
      continue;
    }
    // Options belong to a launcher only until the wrapped executable appears;
    // after that they are arguments to the executable and must not be eaten.
    if (launcher && token.startsWith("-")) {
      index += 1;
      if (LAUNCHER_VALUE_OPTIONS[launcher]?.has(token) && index < tokens.length) index += 1;
      continue;
    }
    break;
  }
  return tokens[index] ?? null;
}

function dependencyPythonModule(executable: string, tokens: string[]): string | null {
  if (!/^python[0-9.]*$/.test(executable)) return null;
  const flag = tokens.indexOf("-m");
  if (flag < 0 || flag + 1 >= tokens.length) return null;
  const module = tokens[flag + 1].split(".")[0];
  return DEPENDENCY_PYTHON_MODULES.has(module) ? module : null;
}

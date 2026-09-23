import { execFileSync } from "node:child_process";
import path from "node:path";
import { validationError } from "../cli/errors.js";

/** Declared preservation checks execute code from the candidate tree, so binding
 * only the command text lets a candidate neuter its own check by rewriting the
 * script it runs (pmark/arcadia#326). This binds the check's *definition*: every
 * in-tree file a declared command names, plus the relative imports those files
 * reach, must be byte-identical (same Git blob, or equally absent) to the
 * authorized base revision. The base revision is part of the authorized binding
 * — the Session lease's `base_revision` or the manual binding's `baseRevision` —
 * so the check that judges a candidate is always the one that was authorized,
 * never one the candidate wrote.
 *
 * Security boundary: this covers the command's named script — resolved through
 * a leading launcher wrapper (`env`, `sudo`, …) or a known interpreter, never
 * every path-shaped argument — and that script's static relative
 * `import`/`export from`/`import()`/`require()` closure for JS/TS, or its
 * same-directory top-level `import`/`from … import` closure for a directly
 * invoked Python script, all read from the trusted base. It does not cover
 * data the check reads by design (the candidate content it judges), a
 * specifier computed at run time, a dynamic or dotted-package Python import,
 * interpreter configuration such as `package.json` "type", or a declared
 * command whose executed script this module cannot identify at all (inline
 * `-c` code, an unrecognized launcher, a bare system command) — such a check
 * runs exactly as before this binding existed. Changing a check therefore
 * needs the change landed on the base first, then a fresh authorization. */

export const PRESERVATION_CHECK_MODIFIED_CODE = "validation_check_modified";

export interface CheckDefinitionFile { path: string; blob: string | null }
export interface CheckDefinitionBinding { baseRevision: string; files: CheckDefinitionFile[] }

const SHELL_SEGMENT = /(?:&&|\|\||[;&|()`\n])/;
const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const PYTHON_EXTENSION = /\.py$/;
// CommonJS/ESM resolution probes these for an extensionless `require("./x")`
// or a directory import, in Node's own preference order.
const REQUIRE_PROBES = ["", ".js", ".cjs", ".mjs", ".json", "/index.js", "/index.cjs", "/index.mjs", "/index.json"];
// Tolerates a single `/* ... */` comment between the call/keyword and the
// specifier (`require(/* note */ "./judge.cjs")`), which a bare regex would
// otherwise silently fail to match — silence here means an unbound helper.
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(?:\/\*[\s\S]*?\*\/\s*)?["'](\.{1,2}\/[^"'\n]+)["']/g;
// `import x` / `from x import y`: a declared Python check always runs as a
// direct script (`python3 check.py`), where Python puts the script's own
// directory first on `sys.path` — a dotted relative import (`from .x import
// y`) does not even work there ("attempted relative import with no known
// parent package"), so an unqualified top-level name is the only form that
// actually resolves against the importing file's directory. A dotted
// package name (`import os.path`) is left unbound; it is stdlib/installed,
// not a same-directory file, and the existence check below drops it.
const PYTHON_IMPORT = /^\s*(?:from\s+(\w+)\s+import\b|import\s+(\w+))/gm;

export function bindCheckDefinitions(repository: string, baseRevision: string, candidateTree: string, commands: string[]): CheckDefinitionBinding {
  const base = blobs(repository, baseRevision);
  const candidate = blobs(repository, candidateTree);
  const bound = new Map<string, string | null>();
  const visit = (file: string) => {
    if (bound.has(file)) return;
    const blob = base.get(file) ?? null;
    bound.set(file, blob);
    if (!blob) return;
    if (PYTHON_EXTENSION.test(file)) {
      const source = execFileSync("git", ["cat-file", "blob", blob], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const dir = path.posix.dirname(file);
      for (const match of source.matchAll(PYTHON_IMPORT)) {
        const module = match[1] || match[2];
        if (!module) continue;
        visit(path.posix.join(dir, `${module}.py`));
      }
      return;
    }
    if (!SCRIPT_EXTENSIONS.test(file)) return;
    const source = execFileSync("git", ["cat-file", "blob", blob], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
      const target = inTree(path.posix.join(path.posix.dirname(file), match[1]));
      if (!target) continue;
      for (const probe of REQUIRE_PROBES) visit(target + probe);
    }
  };
  for (const command of commands) {
    for (const file of namedFiles(command, base, candidate)) visit(file);
  }
  const files = [...bound].map(([file, blob]) => ({ path: file, blob })).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const current = candidate.get(file.path) ?? null;
    if (current === file.blob) continue;
    const command = commands.find(c => namedFiles(c, base, candidate).includes(file.path)) ?? commands.join(" && ");
    throw validationError(
      `Candidate changed \`${file.path}\`, which declared preservation check \`${command}\` executes; a candidate cannot rewrite the check that judges it. ` +
      "Land the check change on the base branch first, then prepare and authorize a fresh handoff.",
      { code: PRESERVATION_CHECK_MODIFIED_CODE, path: file.path, baseRevision, authorizedBlob: file.blob, candidateBlob: current }
    );
  }
  return { baseRevision, files };
}

/** Interpreters that run a script named as their next positional argument.
 * Mirrors the self-contained tools `preservationChecks.ts` allows through the
 * sandbox: only these, plus a directly executed script, name a *check file*. */
const SCRIPT_INTERPRETERS = new Set(["node", "nodejs", "python3", "python", "sh", "bash", "zsh", "ruby", "deno", "bun"]);

/** Tokens that wrap another executable, so the real command follows them
 * (`env node check.mjs`). Mirrors `preservationChecks.ts`'s own launcher
 * handling: without skipping these, the launcher itself is mistaken for the
 * check's executable, no script is identified, nothing gets bound, and the
 * declared check runs with no protection at all — the silent gap this class
 * exists to close, not merely narrow. */
const LAUNCHER_TOKENS = new Set(["env", "sudo", "command", "nohup", "time", "exec", "nice", "stdbuf"]);
const LAUNCHER_VALUE_OPTIONS: Record<string, Set<string>> = {
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
  sudo: new Set(["-u", "--user", "-g", "--group", "-p", "--prompt", "-C", "--close-from",
    "-h", "--host", "-r", "--role", "-t", "--type", "-U", "--other-user"]),
  nice: new Set(["-n", "--adjustment"]),
  stdbuf: new Set(["-i", "--input", "-o", "--output", "-e", "--error"])
};

/** The script file each shell segment actually executes — its own path if run
 * directly, or the positional argument after a known interpreter, skipping a
 * leading launcher wrapper first — not every path-shaped token. A command's
 * data or output arguments (`> marker.txt`, a fixture path) are exactly what
 * the check inspects or writes, not what judges the candidate, and must stay
 * unbound or every check would be refused by its own test fixtures and
 * output files. A file only the candidate has is still bound — as absent at
 * the base — so the candidate cannot supply it. */
function namedFiles(command: string, base: Map<string, string>, candidate: Map<string, string>): string[] {
  const files: string[] = [];
  for (const segment of command.split(SHELL_SEGMENT)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean).map(raw => raw.replace(/^["']|["']$/g, ""));
    let index = 0;
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
    let launcher: string | null = null;
    while (index < tokens.length) {
      const token = tokens[index];
      if (!launcher && LAUNCHER_TOKENS.has(token)) { launcher = token; index += 1; continue; }
      if (launcher && token.startsWith("-")) {
        index += 1;
        if (LAUNCHER_VALUE_OPTIONS[launcher]?.has(token) && index < tokens.length) index += 1;
        continue;
      }
      break;
    }
    const executable = tokens[index];
    if (!executable) continue;
    const executableName = executable.split("/").pop() ?? executable;
    let target: string | null = null;
    if (SCRIPT_INTERPRETERS.has(executableName)) {
      for (let i = index + 1; i < tokens.length; i += 1) {
        if (tokens[i].startsWith("-")) continue;
        target = tokens[i];
        break;
      }
    } else {
      target = executable;
    }
    const file = target ? inTree(target) : null;
    if (file && (base.has(file) || candidate.has(file))) files.push(file);
  }
  return files;
}

function inTree(candidate: string): string | null {
  if (path.posix.isAbsolute(candidate)) return null;
  const normalized = path.posix.normalize(candidate);
  return normalized === "." || normalized.startsWith("../") || normalized === ".." ? null : normalized;
}

function blobs(repository: string, revision: string): Map<string, string> {
  const entries = execFileSync("git", ["ls-tree", "-rz", revision], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }).toString().split("\0");
  const map = new Map<string, string>();
  for (const entry of entries) {
    const match = /^\d+ blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

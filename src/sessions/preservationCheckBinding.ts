import path from "node:path";
import { ArcadiaError, validationError } from "../cli/errors.js";
import { boundedExec } from "./preservationStages.js";

/** Declared preservation checks execute code from the candidate tree, so binding
 * only the command text lets a candidate neuter its own check by rewriting the
 * script it runs (pmark/arcadia#326). This binds the check's *definition*: every
 * in-tree file a declared command names, plus the relative imports those files
 * reach, must be regular files, byte-identical (same Git blob, or equally absent) to the
 * authorized base revision. The base revision is part of the authorized binding
 * — the Session lease's `base_revision` or the manual binding's `baseRevision` —
 * so the check that judges a candidate is always the one that was authorized,
 * never one the candidate wrote.
 *
 * Security boundary: this covers the command's named script — resolved through
 * a leading launcher wrapper (`env`, `sudo`, …) or a known interpreter, never
 * every path-shaped argument — and that script's static relative
 * `import`/`export from`/`import()`/`require()` closure for JS/TS (including
 * a native `.node` addon and one level of directory-import `package.json`
 * "main" resolution), or its same-directory `import`/`from … import` closure
 * for a directly invoked Python script — including both a module and its
 * same-named package (`x.py` or `x/__init__.py`), and every entry of a
 * comma-separated, alias-tolerant `import` list — all read from the trusted
 * base. A Python `import` line this scanner cannot fully parse as that
 * supported shape (a line continuation, an unsupported construct) is
 * rejected outright rather than partially bound. A symlink at any discovered
 * executable path or ancestor in either tree is refused: its blob binds only
 * the link text, not the code an interpreter would follow and execute. A
 * declared path is walked as written, before `..` is removed, because the
 * shell resolves `linked/..` through the link, not lexically. Checks run in a
 * case-insensitive macOS checkout, so every path component is compared
 * case-insensitively too: a case-variant symlink, or any entry that differs
 * from the written path only by case, is refused rather than guessed at.
 * APFS also folds Unicode (`ſ`, `ß`, `ﬁ`, final sigma, normalization) in ways
 * no local table reproduces, so a non-ASCII path component, or any non-ASCII
 * entry in a directory such a path traverses, in either tree, is refused.
 * It does not cover data the
 * check reads by design (the candidate content it judges), a specifier
 * computed at run time, a dotted Python package import (`import os.path`,
 * resolved by its own stdlib/installed leading segment, not a same-directory
 * file), a "main" chain more than one `package.json` deep, interpreter
 * configuration such as `package.json` "type", or a declared command whose
 * executed script this module cannot identify at all (inline `-c` code, an
 * unrecognized launcher, a bare system command) — such a check runs exactly
 * as before this binding existed. Changing a check therefore needs the
 * change landed on the base first, then a fresh authorization. */

export const PRESERVATION_CHECK_MODIFIED_CODE = "validation_check_modified";

export interface CheckDefinitionFile { path: string; blob: string | null }
export interface CheckDefinitionBinding { baseRevision: string; files: CheckDefinitionFile[] }

const SHELL_SEGMENT = /(?:&&|\|\||[;&|()`\n])/;
const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const PYTHON_EXTENSION = /\.py$/;
// CommonJS/ESM resolution probes these for an extensionless `require("./x")`
// or a directory import, in Node's own preference order, including a native
// addon (`.node`) a directory or bare specifier may resolve to.
const REQUIRE_PROBES = ["", ".js", ".cjs", ".mjs", ".json", ".node",
  "/index.js", "/index.cjs", "/index.mjs", "/index.json", "/index.node"];
// Tolerates a single `/* ... */` comment between the call/keyword and the
// specifier (`require(/* note */ "./judge.cjs")`), which a bare regex would
// otherwise silently fail to match — silence here means an unbound helper.
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(?:\/\*[\s\S]*?\*\/\s*)?["'](\.{1,2}\/[^"'\n]+)["']/g;
// A declared Python check always runs as a direct script (`python3 check.py`),
// where Python puts the script's own directory first on `sys.path` — a dotted
// relative import (`from .x import y`) does not even work there ("attempted
// relative import with no known parent package"), so an unqualified top-level
// name is the only form that actually resolves against the importing file's
// directory. `from x import y` needs only x (the names pulled from it do not
// change which file is bound, regardless of how that line continues or
// groups them, so it is always fully handled). A bare `import …` line is
// matched in full and must be an exactly parseable comma list of dotted
// names with optional `as` aliases — anything else (a trailing line
// continuation, an unsupported construct) fails the full-line match and is
// rejected below rather than partially bound.
const PYTHON_FROM_IMPORT = /^\s*from\s+(\w+(?:\.\w+)*)\s+import\b/gm;
const PYTHON_BARE_IMPORT_LINE = /^\s*import\s+.*$/gm;
const PYTHON_BARE_IMPORT_SUPPORTED =
  /^\s*import\s+(\w+(?:\.\w+)*(?:\s+as\s+\w+)?(?:\s*,\s*\w+(?:\.\w+)*(?:\s+as\s+\w+)?)*)\s*(?:#.*)?$/;

export function bindCheckDefinitions(repository: string, baseRevision: string, candidateTree: string, commands: string[]): CheckDefinitionBinding {
  const base = blobs(repository, baseRevision);
  const candidate = blobs(repository, candidateTree);
  const entries = treeEntries(base, candidate);
  const bound = new Map<string, string | null>();
  const visit = (file: string) => {
    if (bound.has(file)) return;
    // Link text is not an executable definition. Refuse even unchanged base
    // links before parsing their blobs; following them would authorize code
    // outside this closure. Prefixes also catch imports through linked dirs.
    const hazard = executableHazard(file, entries);
    if (hazard) throw hazardRefusal(hazard, file, baseRevision);
    const blob = base.get(file)?.blob ?? null;
    bound.set(file, blob);
    if (!blob) return;
    if (PYTHON_EXTENSION.test(file)) {
      const source = boundedExec("git", ["cat-file", "blob", blob], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).toString();
      const dir = path.posix.dirname(file);
      const visitPythonModule = (dotted: string) => {
        // A same-directory import resolves to a plain module or, when that
        // file is absent, a regular package whose __init__.py Python executes
        // on import — bind both candidates unconditionally so a candidate
        // cannot introduce or swap either form unnoticed. A dotted name
        // (`helper.rule`) executes every parent package's initializer on the
        // way to the leaf, so each prefix is bound, not just the first
        // component or the leaf.
        const parts = dotted.split(".");
        for (let end = 1; end <= parts.length; end++) {
          const name = parts.slice(0, end).join("/");
          visit(path.posix.join(dir, `${name}.py`));
          visit(path.posix.join(dir, name, "__init__.py"));
        }
      };
      for (const match of source.matchAll(PYTHON_FROM_IMPORT)) visitPythonModule(match[1]);
      for (const match of source.matchAll(PYTHON_BARE_IMPORT_LINE)) {
        const supported = PYTHON_BARE_IMPORT_SUPPORTED.exec(match[0]);
        if (!supported) {
          throw validationError(
            `Cannot establish the Python import closure for \`${file}\`: the line \`${match[0].trim()}\` is not a plain, single-line, comma-separated import this binding can fully parse. ` +
            "Declare a simpler self-contained import, or land the check change on the base branch first and prepare a fresh authorization.",
            { code: PRESERVATION_CHECK_MODIFIED_CODE, path: file }
          );
        }
        for (const entry of supported[1].split(",")) {
          const module = entry.split(/\bas\b/)[0].trim();
          if (module) visitPythonModule(module);
        }
      }
      return;
    }
    if (!SCRIPT_EXTENSIONS.test(file)) return;
    const source = boundedExec("git", ["cat-file", "blob", blob], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).toString();
    for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
      const target = inTree(path.posix.join(path.posix.dirname(file), match[1]));
      if (!target) continue;
      visitDirectoryImport(target);
    }
  };
  // A bare `require("./rules")` (the string, not a real import — written this
  // way so Arcadia's own preservation-self-check does not mistake this
  // comment for an unresolved relative import) can resolve through a file
  // probe (`rules.js`, `rules/index.js`, …) or, if none of those exist,
  // through `rules/package.json`'s "main" field — Node's own directory-import
  // resolution. Binding only the file probes leaves that manifest and its
  // resolved entry free for a candidate to rewrite unnoticed. Resolves one
  // level of "main" (a package.json chaining to another package.json is not
  // followed further); the manifest itself is always bound, so a candidate
  // that added a chain the base never had is still refused as a changed file.
  const visitDirectoryImport = (target: string) => {
    for (const probe of REQUIRE_PROBES) visit(target + probe);
    const manifestPath = `${target}/package.json`;
    visit(manifestPath);
    const manifestBlob = base.get(manifestPath)?.blob;
    if (!manifestBlob) return;
    let main = "index.js";
    try {
      const manifest = JSON.parse(boundedExec("git", ["cat-file", "blob", manifestBlob], { cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).toString());
      if (typeof manifest.main === "string" && manifest.main.trim()) main = manifest.main;
    } catch (error) {
      // A timeout is not an unparsable manifest; it must surface as retryable.
      if (error instanceof ArcadiaError && error.code === "PRESERVATION_GIT_TIMEOUT") throw error;
      /* unparsable manifest is already bound; any candidate rewrite of it is still refused */
    }
    const mainTarget = inTree(path.posix.join(target, main));
    if (mainTarget) for (const probe of REQUIRE_PROBES) visit(mainTarget + probe);
  };
  for (const command of commands) {
    for (const file of namedFiles(command, base, candidate, entries, baseRevision)) visitDirectoryImport(file);
  }
  const files = [...bound].map(([file, blob]) => ({ path: file, blob })).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const current = candidate.get(file.path)?.blob ?? null;
    if (current === file.blob) continue;
    const command = commands.find(c => namedFiles(c, base, candidate, entries, baseRevision).includes(file.path)) ?? commands.join(" && ");
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
function namedFiles(command: string, base: Map<string, GitBlob>, candidate: Map<string, GitBlob>, entries: TreeEntries, baseRevision: string): string[] {
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
    if (!target) continue;
    const hazard = declaredHazard(target, entries);
    if (hazard) throw hazardRefusal(hazard, target, baseRevision);
    const file = inTree(target);
    if (file && (base.has(file) || candidate.has(file))) files.push(file);
  }
  return files;
}

/** The shell opens a declared path component by component, so `linked/../x`
 * follows `linked` before `..` applies, while `inTree`'s lexical normalization
 * would erase `linked` and bind the unrelated root `x`. Walk the path as
 * written and return the first hazardous prefix. Every earlier prefix is then
 * a real directory (or absent, so the shell fails), so popping `..` lexically
 * up to that point is exact. Import specifiers keep lexical normalization:
 * Node resolves those lexically itself. */
function declaredHazard(target: string, entries: TreeEntries): PathHazard | null {
  if (path.posix.isAbsolute(target)) return null;
  const stack: string[] = [];
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
    const hazard = pathHazard(stack.join("/"), entries);
    if (hazard) return hazard;
  }
  return null;
}

function hazardRefusal(hazard: PathHazard, executablePath: string, baseRevision: string): ArcadiaError {
  const details = { code: PRESERVATION_CHECK_MODIFIED_CODE, path: hazard.path, executablePath, baseRevision };
  if (hazard.kind === "non_ascii") {
    return validationError(
      `Declared preservation checks cannot execute \`${executablePath}\`: \`${hazard.path}\` has a non-ASCII name on a path the check traverses, and a case- and Unicode-insensitive macOS checkout may resolve it as a different entry than this binding checked. ` +
      "Use ASCII-only names along check paths on the base branch, then prepare and authorize a fresh handoff.",
      details
    );
  }
  if (hazard.kind === "symlink") {
    return validationError(
      `Declared preservation checks cannot execute symlink \`${hazard.path}\` (reached through \`${executablePath}\`); a link's blob does not bind the code it executes. ` +
      "Use regular check files and dependencies on the base branch, then prepare and authorize a fresh handoff.",
      details
    );
  }
  return validationError(
    `Declared preservation checks cannot execute \`${executablePath}\`: tree entry \`${hazard.path}\` differs from \`${hazard.written}\` only by letter case, so a case-insensitive checkout may run code this binding did not check. ` +
    "Use one exact-case path with no case-variant siblings on the base branch, then prepare and authorize a fresh handoff.",
    details
  );
}

function inTree(candidate: string): string | null {
  if (path.posix.isAbsolute(candidate)) return null;
  const normalized = path.posix.normalize(candidate);
  return normalized === "." || normalized.startsWith("../") || normalized === ".." ? null : normalized;
}

interface GitBlob { mode: string; blob: string }

function executableHazard(file: string, entries: TreeEntries): PathHazard | null {
  const parts = file.split("/");
  for (let end = 1; end <= parts.length; end++) {
    const hazard = pathHazard(parts.slice(0, end).join("/"), entries);
    if (hazard) return hazard;
  }
  return null;
}

/** `folded`: ASCII-lower-cased key -> every exact path (blob or implied
 * directory) in either tree with that key -> whether it is a symlink in
 * either tree. `nonAscii`: directory ("" for the root) -> a non-ASCII entry
 * it holds in either tree. */
interface TreeEntries { folded: Map<string, Map<string, boolean>>; nonAscii: Map<string, string> }
interface PathHazard { kind: "symlink" | "case" | "non_ascii"; path: string; written: string }

const NON_ASCII = /[\u0080-\uffff]/;
const fold = (file: string) => file.toLowerCase();

function treeEntries(...trees: Map<string, GitBlob>[]): TreeEntries {
  const folded = new Map<string, Map<string, boolean>>();
  const nonAscii = new Map<string, string>();
  const add = (file: string, link: boolean) => {
    const key = fold(file);
    const exact = folded.get(key) ?? new Map<string, boolean>();
    exact.set(file, (exact.get(file) ?? false) || link);
    folded.set(key, exact);
    const slash = file.lastIndexOf("/");
    const dir = slash < 0 ? "" : file.slice(0, slash);
    if (NON_ASCII.test(file.slice(slash + 1)) && !nonAscii.has(dir)) nonAscii.set(dir, file);
  };
  for (const tree of trees) {
    for (const [file, { mode }] of tree) {
      const parts = file.split("/");
      for (let end = 1; end < parts.length; end++) add(parts.slice(0, end).join("/"), false);
      add(file, mode === "120000");
    }
  }
  return { folded, nonAscii };
}

/** A prefix is hazardous when its own last component is non-ASCII, when the
 * directory it is looked up in holds any non-ASCII entry in either tree, when
 * any entry matching it ASCII-case-insensitively is a symlink in either tree,
 * or when a matching entry differs from the written prefix only by case. */
function pathHazard(written: string, entries: TreeEntries): PathHazard | null {
  const slash = written.lastIndexOf("/");
  if (NON_ASCII.test(written.slice(slash + 1))) return { kind: "non_ascii", path: written, written };
  const sibling = entries.nonAscii.get(slash < 0 ? "" : written.slice(0, slash));
  if (sibling) return { kind: "non_ascii", path: sibling, written };
  const matches = entries.folded.get(fold(written));
  if (!matches) return null;
  for (const [entry, link] of matches) if (link) return { kind: "symlink", path: entry, written };
  for (const entry of matches.keys()) if (entry !== written) return { kind: "case", path: entry, written };
  return null;
}

function blobs(repository: string, revision: string): Map<string, GitBlob> {
  const entries = boundedExec("git", ["ls-tree", "-rz", revision], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }).toString().split("\0");
  const map = new Map<string, GitBlob>();
  for (const entry of entries) {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (match) map.set(match[3], { mode: match[1], blob: match[2] });
  }
  return map;
}

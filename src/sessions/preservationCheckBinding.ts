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
 * A bare command (no slash, not an interpreter's script target) is resolved
 * on PATH and never walked for these hazards (#1053). Launchers may chain, a
 * `cd`/`pushd`/`env -C`/`sudo -D` before a script, or a script path the shell
 * expands (`$PWD/x`, globs, `~`), is refused because the root-relative file
 * bound may not be the file run (#1047). A sibling `.pyc`, native extension or
 * `__pycache__` entry for an imported Python module is refused in either
 * tree, as Python would load it ahead of the bound source (#1052). Python
 * resolves any import (including a stdlib module's own imports, such as
 * `subprocess` importing `selectors` or an optional `msvcrt`) against the
 * script's directory first, and a package import reaches submodules this
 * binding does not name. A Python check is therefore also refused when base and
 * candidate differ at all, anywhere under the script's directory or any
 * imported package directory (recursively), in: `*.py`/`*.pyc`/`__pycache__`
 * entries, native extension suffixes, any directory (a namespace package), any
 * symlink, or a gitlink (#1100). A symlink that resolves outside the scanned
 * directory is refused even when unchanged. A script counts as Python when it
 * is run by a python interpreter or its shebang names python, whatever its
 * extension. A Python check command that sets a `PYTHON*=` variable or uses
 * `-m`/`-c`, and a bound Python source that mentions `sys.path`, `importlib`,
 * `__import__` or `runpy`, are refused because they redirect imports in ways
 * this binding cannot enumerate. This is fail-closed and deliberately broader
 * than the files the closure binds: keep a Python check and its helpers in an
 * isolated directory (for example `checks/`) so unrelated work cannot trip it. Not
 * covered: a literal absolute path (the host runs checks in an unguessable
 * temp checkout with the repository denied, so it cannot name candidate
 * content), and options that take a value before an interpreter's script
 * (`node --require x.js check.js`). It does not cover data the
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
// directory. `from x import y` binds only x's own file (`x.py` or
// `x/__init__.py`); the names pulled from it may be submodules (`from helper
// import rule` loads `helper/rule.py`) that are not named here, so the importable
// set of the package directory is compared separately and refused on any
// difference (#1100). The line may continue or group names freely. A bare `import …` line is
// matched in full and must be an exactly parseable comma list of dotted
// names with optional `as` aliases — anything else (a trailing line
// continuation, an unsupported construct) fails the full-line match and is
// rejected below rather than partially bound.
const PYTHON_FROM_IMPORT = /^\s*from\s+(\w+(?:\.\w+)*)\s+import\b/gm;
const PYTHON_BARE_IMPORT_LINE = /^\s*import\s+.*$/gm;
const PYTHON_BARE_IMPORT_SUPPORTED =
  /^\s*import\s+(\w+(?:\.\w+)*(?:\s+as\s+\w+)?(?:\s*,\s*\w+(?:\.\w+)*(?:\s+as\s+\w+)?)*)\s*(?:#.*)?$/;

export function bindCheckDefinitions(repository: string, baseRevision: string, candidateTree: string, commands: string[]): CheckDefinitionBinding {
  const baseTree = readTree(repository, baseRevision);
  const candidateSnapshot = readTree(repository, candidateTree);
  const base = baseTree.blobs;
  const candidate = candidateSnapshot.blobs;
  const entries = treeEntries(base, candidate);
  const bound = new Map<string, string | null>();
  // Directories whose importable entries must be identical in both trees
  // (#1100): every Python file's own directory and every imported package
  // directory, each scanned recursively.
  const scanDirs = new Set<string>();
  // Files known to be Python scripts although their name does not say so: run by
  // a python interpreter, or with a python shebang.
  const pythonScripts = new Set<string>();
  const allPaths = [...new Set([...base.keys(), ...candidate.keys()])];
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
    if (PYTHON_EXTENSION.test(file) || pythonScripts.has(file)) {
      const source = boundedExec("git", ["cat-file", "blob", blob], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).toString();
      const dir = path.posix.dirname(file);
      scanDirs.add(dir);
      if (pythonDynamicImport(source)) {
        throw validationError(
          `Cannot establish the Python import closure for \`${file}\`: it mentions \`sys.path\`, \`importlib\`, \`__import__\` or \`runpy\`, or uses \`site\`, \`exec\`/\`eval\`/\`compile\`, \`builtins\`, or \`sys\` with path or attribute manipulation, which can load code this binding does not see. ` +
          `Declare a check that uses only plain imports, ${ISOLATION_ADVICE}`,
          { code: PRESERVATION_CHECK_MODIFIED_CODE, path: file }
        );
      }
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
          scanDirs.add(path.posix.join(dir, name));
          // Python tries extension modules and bytecode before (or without) the
          // `.py` source this binding hashes, so a sibling of either kind
          // shadows the bound file and runs unbound code (#1052).
          const shadow = pythonShadow(path.posix.join(dir, name), allPaths);
          if (shadow) throw shadowRefusal(shadow, `${path.posix.join(dir, name)}.py`, baseRevision);
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
    const named = namedFiles(command, base, candidate, entries, baseRevision, pythonScripts);
    let pythonCommand = named.some(file => pythonScripts.has(file) || PYTHON_EXTENSION.test(file));
    for (const file of named) {
      if (!pythonScripts.has(file) && !PYTHON_EXTENSION.test(file) && !SCRIPT_EXTENSIONS.test(file) && hasPythonShebang(repository, base.get(file)?.blob)) {
        pythonScripts.add(file);
        pythonCommand = true;
      }
    }
    if (pythonCommand && PYTHON_ENVIRONMENT.test(command)) {
      throw validationError(
        `Declared preservation check \`${command}\` runs Python with a \`PYTHON*=\` environment variable, which redirects imports (\`PYTHONPATH\`, \`PYTHONHOME\`, \`PYTHONSTARTUP\`, \`PYTHONPYCACHEPREFIX\`, ...) outside what this binding checks. ` +
        `Remove the variable from the command, ${ISOLATION_ADVICE}`,
        { code: PRESERVATION_CHECK_MODIFIED_CODE, baseRevision, command }
      );
    }
    for (const file of named) visitDirectoryImport(file);
  }
  const files = [...bound].map(([file, blob]) => ({ path: file, blob })).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const current = candidate.get(file.path)?.blob ?? null;
    if (current === file.blob) continue;
    const command = commands.find(c => namedFiles(c, base, candidate, entries, baseRevision, new Set()).includes(file.path)) ?? commands.join(" && ");
    throw validationError(
      `Candidate changed \`${file.path}\`, which declared preservation check \`${command}\` executes; a candidate cannot rewrite the check that judges it. ` +
      `Land the check change on the base branch first, then prepare and authorize a fresh handoff. ${PYTHON_ISOLATION_NOTE}`,
      { code: PRESERVATION_CHECK_MODIFIED_CODE, path: file.path, baseRevision, authorizedBlob: file.blob, candidateBlob: current }
    );
  }
  const importable = new ImportableSets(repository, baseTree, candidateSnapshot);
  for (const dir of scanDirs) importable.refuseDifference(dir, baseRevision, commands);
  return { baseRevision, files };
}

/** Names Python's path finders can load as a module: source, bytecode, or a
 * native extension (including tagged forms such as `x.cpython-312-darwin.so`). */
const PYTHON_IMPORTABLE_NAME = /\.(?:py|pyw|pyc|pyo|pyd|so|dylib)$/;
/** Code that edits the import path or loads modules by computed name, so the
 * statically bound closure no longer describes what runs. */
const PYTHON_DYNAMIC_IMPORT = /\bsys\s*\.\s*path\b|\bfrom\s+sys\s+import\b[^\n]*\bpath\b|\bimportlib\b|\b__import__\b|\brunpy\b/;
/** The `site` module (`site.addsitedir` adds import roots and runs `.pth` files). */
const PYTHON_SITE = /\bimport\s+[^\n]*\bsite\b|\bfrom\s+site\b/;
/** Runs or builds code from a string or the builtins table. `re.compile(` and
 * other attribute calls are not matched, but `builtins.exec(` is caught by the
 * `builtins` term. */
const PYTHON_CODE_EXECUTION = /(?<![.\w])(?:exec|eval|compile)\s*\(|\b__builtins__\b|\bbuiltins\b/;
/** `sys` imported under any name (`import sys as s`, `from sys import x`). */
const PYTHON_SYS_IMPORT = /\bimport\s+[^\n]*\bsys\b|\bfrom\s+sys\b/;
/** Import-machinery attributes (`.path`, `.meta_path`, `.path_hooks`, `.modules`)
 * reachable through an alias, or computed attribute access that can build them. */
const PYTHON_SYS_MACHINERY = /\.\s*(?:path|path_hooks|path_importer_cache|meta_path|modules)\b|\bfrom\s+sys\s+import\b[^\n]*\b(?:path_hooks|path_importer_cache|meta_path|modules)\b|\b(?:getattr|setattr|vars|globals|locals)\s*\(|\b__dict__\b/;
/** Fail closed on a bound Python source whose import closure cannot be read
 * statically (#1103). With `sys` imported, any non-`os.path` `.path` mention or
 * computed attribute access is refused; this over-refuses (a `sys` user that
 * aliases `os` under another name) on purpose. */
function pythonDynamicImport(source: string): boolean {
  if (PYTHON_DYNAMIC_IMPORT.test(source) || PYTHON_SITE.test(source) || PYTHON_CODE_EXECUTION.test(source)) return true;
  if (!PYTHON_SYS_IMPORT.test(source)) return false;
  return PYTHON_SYS_MACHINERY.test(source.replace(/\b(?:os|posixpath|ntpath)\s*\.\s*path\b/g, ""));
}
/** A `PYTHON*=` assignment (also after `export`/`env`) anywhere in a command. */
const PYTHON_ENVIRONMENT = /(?:^|[\s;&|(])PYTHON[A-Za-z0-9_]*=/;
const ISOLATION_ADVICE = "or land the change on the base branch first and prepare a fresh authorization. For Python checks, keep the check and its helpers in an isolated directory (for example `checks/`) so unrelated changes cannot trip this refusal.";
const PYTHON_ISOLATION_NOTE = "For Python checks, keep the check and its helpers in an isolated directory (for example `checks/`).";

/** Whether a blob starts with a `#!` line naming python. */
function hasPythonShebang(repository: string, blob: string | undefined): boolean {
  if (!blob) return false;
  let head: string;
  try {
    head = boundedExec("git", ["cat-file", "blob", blob], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).toString().slice(0, 512);
  } catch (error) {
    if (error instanceof ArcadiaError && error.code === "PRESERVATION_GIT_TIMEOUT") throw error;
    return false;
  }
  const first = head.split("\n", 1)[0];
  return first.startsWith("#!") && /\b(?:python|pypy)/i.test(first);
}

interface ScannedEntry { path: string; signature: string; link: boolean; blob: string }

/** The entries Python could import from, or be redirected by, under a scanned
 * directory in both trees, compared by blob and mode, names folded
 * case-insensitively as the checkout is: importable files and `__pycache__`
 * contents, every directory (any may be a namespace package, such as `msvcrt/`
 * that `subprocess` optionally imports), every symlink, and gitlinks. Used
 * only to refuse: a Python check is relied on only if nothing Python could
 * import differs between the authorized base and the candidate (#1100). */
class ImportableSets {
  constructor(private readonly repository: string, private readonly base: TreeSnapshot, private readonly candidate: TreeSnapshot) {}

  refuseDifference(dir: string, baseRevision: string, commands: string[]): void {
    const root = dir === "." ? "" : fold(dir);
    const prefix = root === "" ? "" : `${root}/`;
    const [before, after] = [this.base, this.candidate].map(tree => this.scan(tree, prefix));
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const was = before.get(key);
      const now = after.get(key);
      if (was && now && was.signature === now.signature && was.path === now.path) continue;
      const changed = (now ?? was)!.path;
      const kind = !was ? "added" : !now ? "removed" : "changed";
      throw validationError(
        `Candidate ${kind} \`${changed}\`, an importable Python entry (module, bytecode, native extension, package or namespace directory, symlink or submodule) beneath code that declared preservation check \`${commands.join(" && ")}\` imports; Python may load it ahead of or instead of the bound source (for example a module that shadows one the standard library imports, or a package submodule), so the executed code would not match what this binding checked. ` +
        `Land the change on the base branch first, then prepare and authorize a fresh handoff. ${PYTHON_ISOLATION_NOTE}`,
        { code: PRESERVATION_CHECK_MODIFIED_CODE, path: changed, baseRevision, importable: true }
      );
    }
    // A symlink whose target leaves the scanned directory can be repointed by
    // changes this scan never sees, so it is refused even when unchanged.
    for (const entries of [before, after]) {
      for (const [key, entry] of entries) {
        if (!entry.link) continue;
        const target = this.linkTarget(entry.blob).trim();
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(key), target)).toLowerCase();
        const inside = !path.posix.isAbsolute(target) && !resolved.startsWith("../") && resolved !== ".." && (prefix === "" || resolved.startsWith(prefix));
        if (inside) continue;
        throw validationError(
          `Symlink \`${entry.path}\` beneath code that declared preservation check \`${commands.join(" && ")}\` imports points outside the scanned directory, where changes cannot be bound; Python may follow it to code this binding did not check. ` +
          `Remove the symlink on the base branch, then prepare and authorize a fresh handoff. ${PYTHON_ISOLATION_NOTE}`,
          { code: PRESERVATION_CHECK_MODIFIED_CODE, path: entry.path, baseRevision, importable: true }
        );
      }
    }
  }

  private linkTarget(blob: string): string {
    return boundedExec("git", ["cat-file", "blob", blob], { cwd: this.repository, encoding: "utf8", maxBuffer: 1024 * 1024 }).toString();
  }

  private scan(tree: TreeSnapshot, prefix: string): Map<string, ScannedEntry> {
    const result = new Map<string, ScannedEntry>();
    const depth = prefix === "" ? 1 : prefix.split("/").length;
    const directories = (file: string, lower: string) => {
      const parts = lower.split("/");
      const exact = file.split("/");
      for (let end = depth; end < parts.length; end++) {
        const key = `${parts.slice(0, end).join("/")}/`;
        if (!result.has(key)) result.set(key, { path: exact.slice(0, end).join("/"), signature: "dir", link: false, blob: "" });
      }
    };
    for (const [file, entry] of tree.blobs) {
      const lower = fold(file);
      if (!lower.startsWith(prefix)) continue;
      directories(file, lower);
      const link = entry.mode === "120000";
      if (!link && !PYTHON_IMPORTABLE_NAME.test(lower) && !/(?:^|\/)__pycache__\//.test(lower)) continue;
      result.set(lower, { path: file, signature: `${entry.mode}:${entry.blob}`, link, blob: entry.blob });
    }
    for (const [file, commit] of tree.gitlinks) {
      const lower = fold(file);
      if (!lower.startsWith(prefix)) continue;
      directories(file, lower);
      result.set(lower, { path: file, signature: `160000:${commit}`, link: false, blob: "" });
    }
    return result;
  }
}

/** Interpreters that run a script named as their next positional argument.
 * Mirrors the self-contained tools `preservationChecks.ts` allows through the
 * sandbox: only these, plus a directly executed script, name a *check file*. */
// Versioned and flavoured binaries too: `python3.12`, `pypy3.10`, free-threaded
// `python3.13t`, debug `python3.13d`, `python3.13td`, `pythonw` (#1103).
const PYTHON_INTERPRETER = /^(?:python|pypy)w?\d*(?:\.\d+)*[dmtu]*$/;
const SCRIPT_INTERPRETERS = new Set(["node", "nodejs", "python3", "python", "sh", "bash", "zsh", "ruby", "deno", "bun", "source", "."]);

/** Builtins that move the shell, so later root-relative paths resolve elsewhere. */
const CWD_COMMANDS = new Set(["cd", "pushd", "popd", "chdir"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Compound-command words that can precede the real command in a segment
 * (`then cd x`, `{ sh check.sh`). */
const SHELL_KEYWORDS = new Set(["if", "then", "elif", "else", "do", "while", "until", "!", "{"]);
/** Parameter, tilde and glob expansion all make the executed path differ from
 * the written one. */
const SHELL_EXPANSION = /[$*?[{~]/;

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
    "-h", "--host", "-r", "--role", "-t", "--type", "-U", "--other-user", "-D", "--chdir"]),
  nice: new Set(["-n", "--adjustment"]),
  stdbuf: new Set(["-i", "--input", "-o", "--output", "-e", "--error"])
};

/** Launcher options that change the working directory of the wrapped command. */
const LAUNCHER_CHDIR_OPTION: Record<string, RegExp> = {
  env: /^(?:--chdir(?:=.*)?|-C.*)$/,
  sudo: /^(?:--chdir(?:=.*)?|-D.*)$/
};

/** The script file each shell segment actually executes — its own path if run
 * directly, or the positional argument after a known interpreter, skipping a
 * leading launcher wrapper first — not every path-shaped token. A command's
 * data or output arguments (`> marker.txt`, a fixture path) are exactly what
 * the check inspects or writes, not what judges the candidate, and must stay
 * unbound or every check would be refused by its own test fixtures and
 * output files. A file only the candidate has is still bound — as absent at
 * the base — so the candidate cannot supply it. */
function namedFiles(command: string, base: Map<string, GitBlob>, candidate: Map<string, GitBlob>, entries: TreeEntries, baseRevision: string, pythonScripts: Set<string>): string[] {
  const files: string[] = [];
  // Segments run in command order, so a `cd` in one affects every later one.
  let changedDirectory = false;
  for (const segment of command.split(SHELL_SEGMENT)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean).map(raw => raw.replace(/^["']|["']$/g, ""));
    let index = 0;
    let launcher: string | null = null;
    // A launcher that itself changes directory (`env -C dir`, `sudo -D dir`)
    // moves the wrapped executable out from under the root-relative path.
    let segmentChdir = false;
    // Launchers chain (`nohup nice -n 5 sh check.sh`), and assignments or shell
    // keywords may precede or sit between them; skip all of them to reach the
    // command that actually runs. Without that, the check silently binds nothing.
    while (index < tokens.length) {
      const token = tokens[index];
      if (ASSIGNMENT.test(token) || SHELL_KEYWORDS.has(token)) { index += 1; continue; }
      if (LAUNCHER_TOKENS.has(token)) { launcher = token; index += 1; continue; }
      if (launcher && token.startsWith("-")) {
        index += 1;
        if (LAUNCHER_CHDIR_OPTION[launcher]?.test(token)) segmentChdir = true;
        if (LAUNCHER_VALUE_OPTIONS[launcher]?.has(token) && index < tokens.length) index += 1;
        continue;
      }
      break;
    }
    const executable = tokens[index];
    if (!executable) continue;
    const executableName = executable.split("/").pop() ?? executable;
    if (CWD_COMMANDS.has(executableName)) { changedDirectory = true; continue; }
    let target: string | null = null;
    const python = PYTHON_INTERPRETER.test(executableName);
    const interpreted = python || SCRIPT_INTERPRETERS.has(executableName);
    if (interpreted) {
      for (let i = index + 1; i < tokens.length; i += 1) {
        if (python && /^-[A-Za-z]*[cm]/.test(tokens[i])) {
          throw validationError(
            `Declared preservation check \`${command}\` runs Python with \`${tokens[i]}\` (inline code or a module by name), which this binding cannot resolve to a bound script file. ` +
            `Run a plain script file instead, ${ISOLATION_ADVICE}`,
            { code: PRESERVATION_CHECK_MODIFIED_CODE, baseRevision, command }
          );
        }
        // Redirections are not the script: `python3 check.py < data` still
        // names check.py, while `python3 < check.py` reads the script itself
        // from stdin (#1103). Skip the operator's separate operand.
        if (python && /^\d*[<>]/.test(tokens[i])) {
          if (/^\d*(?:<<<|<<-?|<>|>>|>\||[<>])&?$/.test(tokens[i])) i += 1;
          continue;
        }
        if (python && tokens[i] === "-") break;
        if (tokens[i].startsWith("-")) {
          // Options that take the next token as their value must not be mistaken for the script.
          if (python && (tokens[i] === "-W" || tokens[i] === "-X" || tokens[i] === "--check-hash-based-pycs")) i += 1;
          continue;
        }
        target = tokens[i];
        break;
      }
      // A Python interpreter with no script argument reads its program from
      // stdin (`python3 -`, `cat f | python3`, `python3 < f`), which no bound
      // file describes. Informational flags run nothing and are allowed.
      if (python && !target && !tokens.slice(index + 1).some(token => /^(?:-V+|--version|-h|--help|-\?)$/.test(token))) {
        throw validationError(
          `Declared preservation check \`${command}\` runs Python with no script file argument, so the program comes from standard input, which this binding cannot resolve to a bound script file. ` +
          `Run a plain script file instead, ${ISOLATION_ADVICE}`,
          { code: PRESERVATION_CHECK_MODIFIED_CODE, baseRevision, command }
        );
      }
    } else {
      target = executable;
    }
    if (!target) continue;
    // A bare command (`pnpm`, `echo`) is looked up on PATH by the shell and
    // never read from the repository root, so walking the root for hazards on
    // its behalf only produces false refusals (#1053). An interpreter's script
    // target is always a file, bare or not, and keeps the full walk.
    const scriptShaped = interpreted || executable.includes("/");
    if (scriptShaped) {
      // The binding resolves every declared path against the checkout root. If
      // an earlier `cd` (or `env -C`) moved the shell, or the path is expanded
      // by the shell at run time, the file bound is not the file executed
      // (#1047). Fail closed rather than guess.
      if (changedDirectory || segmentChdir) throw unresolvableRefusal("changes directory before it runs", target, baseRevision);
      if (SHELL_EXPANSION.test(target)) throw unresolvableRefusal("is expanded by the shell at run time", target, baseRevision);
      const hazard = declaredHazard(target, entries);
      if (hazard) throw hazardRefusal(hazard, target, baseRevision);
    }
    const file = inTree(target);
    if (file && (base.has(file) || candidate.has(file))) {
      files.push(file);
      if (python) pythonScripts.add(file);
    }
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

const PYTHON_SHADOW_SUFFIX = /^(?:pyc|pyd|so|dylib|[^/]*\.(?:so|pyd|dylib))$/;

/** An entry in either tree that Python's import system could load in place of
 * (or without) the bound `module.py` / `module/__init__.py`: compiled bytecode
 * (`.pyc`, including `__pycache__` variants, which an unchecked-hash pyc loads
 * without validating source) and native extensions (`.so`, `.pyd`, `.dylib`,
 * tagged forms such as `.cpython-312-darwin.so`). Compared case-insensitively,
 * as the checkout is. */
function pythonShadow(module: string, paths: string[]): string | null {
  const key = module.toLowerCase();
  const slash = key.lastIndexOf("/");
  const cache = `${slash < 0 ? "" : key.slice(0, slash + 1)}__pycache__/${key.slice(slash + 1)}.`;
  const packageCache = `${key}/__pycache__/__init__.`;
  for (const entry of paths) {
    const lower = entry.toLowerCase();
    if (lower.startsWith(`${key}.`) && PYTHON_SHADOW_SUFFIX.test(lower.slice(key.length + 1))) return entry;
    if (lower.startsWith(`${key}/__init__.`) && PYTHON_SHADOW_SUFFIX.test(lower.slice(key.length + 10))) return entry;
    if ((lower.startsWith(cache) || lower.startsWith(packageCache)) && lower.endsWith(".pyc")) return entry;
  }
  return null;
}

function shadowRefusal(shadow: string, boundPath: string, baseRevision: string): ArcadiaError {
  return validationError(
    `Declared preservation checks cannot bind \`${boundPath}\`: \`${shadow}\` is compiled Python (bytecode or a native extension) that Python may load instead of the bound source, so the executed code would not match what this binding checked. ` +
    "Remove compiled Python from the check's import directories on the base branch and the candidate, then prepare and authorize a fresh handoff.",
    { code: PRESERVATION_CHECK_MODIFIED_CODE, path: shadow, executablePath: boundPath, baseRevision }
  );
}

function unresolvableRefusal(reason: string, executablePath: string, baseRevision: string): ArcadiaError {
  return validationError(
    `Declared preservation checks cannot execute \`${executablePath}\`: the command ${reason}, so this binding cannot resolve it to exactly one in-tree file and would bind a different file than the one it runs. ` +
    "Declare the check as a plain root-relative path with no `cd` or shell expansion on the base branch, then prepare and authorize a fresh handoff.",
    { code: PRESERVATION_CHECK_MODIFIED_CODE, path: executablePath, executablePath, baseRevision }
  );
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

interface TreeSnapshot { blobs: Map<string, GitBlob>; gitlinks: Map<string, string> }

function readTree(repository: string, revision: string): TreeSnapshot {
  const entries = boundedExec("git", ["ls-tree", "-rz", revision], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }).toString().split("\0");
  const map = new Map<string, GitBlob>();
  const gitlinks = new Map<string, string>();
  for (const entry of entries) {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (match) { map.set(match[3], { mode: match[1], blob: match[2] }); continue; }
    const link = /^160000 commit ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (link) gitlinks.set(link[2], link[1]);
  }
  return { blobs: map, gitlinks };
}

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
 * Security boundary: this covers the command's named files and their static
 * relative `import`/`export from`/`import()`/`require()` closure, read from the
 * trusted base. It does not cover data the check reads by design (the candidate
 * content it judges), specifiers computed at run time, or interpreter
 * configuration such as `package.json` "type". Changing a check therefore needs
 * the change landed on the base first, then a fresh authorization. */

export const PRESERVATION_CHECK_MODIFIED_CODE = "validation_check_modified";

export interface CheckDefinitionFile { path: string; blob: string | null }
export interface CheckDefinitionBinding { baseRevision: string; files: CheckDefinitionFile[] }

const SHELL_SEGMENT = /(?:&&|\|\||[;&|()`\n])/;
const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
// CommonJS resolution probes these for an extensionless `require("./x")`.
const REQUIRE_PROBES = ["", ".js", ".cjs", ".mjs", ".json", "/index.js"];
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"'\n]+)["']/g;

export function bindCheckDefinitions(repository: string, baseRevision: string, candidateTree: string, commands: string[]): CheckDefinitionBinding {
  const base = blobs(repository, baseRevision);
  const candidate = blobs(repository, candidateTree);
  const bound = new Map<string, string | null>();
  const visit = (file: string) => {
    if (bound.has(file)) return;
    const blob = base.get(file) ?? null;
    bound.set(file, blob);
    if (!blob || !SCRIPT_EXTENSIONS.test(file)) return;
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

/** The script file each shell segment actually executes — its own path if run
 * directly, or the positional argument after a known interpreter — not every
 * path-shaped token. A command's data or output arguments (`> marker.txt`,
 * a fixture path) are exactly what the check inspects or writes, not what
 * judges the candidate, and must stay unbound or every check would be refused
 * by its own test fixtures and output files. A file only the candidate has is
 * still bound — as absent at the base — so the candidate cannot supply it. */
function namedFiles(command: string, base: Map<string, string>, candidate: Map<string, string>): string[] {
  const files: string[] = [];
  for (const segment of command.split(SHELL_SEGMENT)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean).map(raw => raw.replace(/^["']|["']$/g, ""));
    let index = 0;
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
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

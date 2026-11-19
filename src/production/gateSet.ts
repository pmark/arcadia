/**
 * The gate-set list and its one loader (Action define-the-gate-set).
 *
 * config/gate-set.json names, per Project, the modules that define or enforce
 * a merge, review, settlement or start gate, their first-order imports, the
 * spend path, the hard classes, and the list, this loader and the drift test
 * themselves. This module is the only reader of that file: every other module
 * calls loadGateSet(). tests/gate-set.test.ts fails if another source file
 * names the list file.
 *
 * Fails closed: a file under a listed gate directory that the list does not
 * map classifies as protected, never as free.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const GATE_SET_PATH = "config/gate-set.json";

export interface GateModuleEntry {
  id: string;
  /** Repo-relative path. */
  path: string;
  /** First-order imports as of the merge commit: resolved repo paths for relative imports, package specifiers otherwise. */
  imports: string[];
}

export interface GateSetHardClass {
  name: string;
  /** Repo-relative paths; a trailing slash is a directory prefix. */
  paths: string[];
}

export interface GateSetSelfEntry {
  id: "list" | "loader" | "driftTest";
  path: string;
  imports?: string[];
}

export interface ProjectGateSet {
  repository: string;
  gateModules: GateModuleEntry[];
  /** Directories where every file is protected, mapped or not. */
  spend: string[];
  hardClasses: GateSetHardClass[];
  self: GateSetSelfEntry[];
}

export interface GateSetDocument {
  gateSet: "v1";
  projects: Record<string, ProjectGateSet>;
}

export type GateSetLookup =
  | { found: true; project: string; entry: ProjectGateSet }
  | { found: false; project: string; report: string };

export function parseGateSet(text: string): GateSetDocument {
  const doc = JSON.parse(text) as GateSetDocument;
  if (doc?.gateSet !== "v1" || typeof doc.projects !== "object" || doc.projects === null) {
    throw new Error(`${GATE_SET_PATH}: expected {"gateSet":"v1","projects":{...}}`);
  }
  return doc;
}

/** The only reader of config/gate-set.json. */
export function loadGateSet(root: string): GateSetDocument {
  const file = path.join(root, GATE_SET_PATH);
  if (!existsSync(file)) throw new Error(`${GATE_SET_PATH} is missing under ${root}`);
  return parseGateSet(readFileSync(file, "utf8"));
}

/** A Project without its own list is reported as absent, never defaulted to another Project's list. */
export function gateSetForProject(doc: GateSetDocument, project: string): GateSetLookup {
  const entry = Object.hasOwn(doc.projects, project) ? doc.projects[project] : undefined;
  if (!entry) return { found: false, project, report: `no gate list for project ${project}; its gates are not covered by ${GATE_SET_PATH}` };
  return { found: true, project, entry };
}

const SOURCE_EXT = /\.(?:ts|mts|mjs|js)$/;
const COMMENT_RE = /\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g;
const IMPORT_RES = [
  /\b(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];
const SHELL_SOURCE_RE = /^\s*(?:source|\.)\s+["']?([^\s"';]+)/gm;

/** First-order imports of one file, sorted and de-duplicated. Shell files report `source` lines. */
export function firstOrderImports(root: string, file: string): string[] {
  const text = readFileSync(path.join(root, file), "utf8");
  const found = new Set<string>();
  if (file.endsWith(".sh")) {
    for (const m of text.matchAll(SHELL_SOURCE_RE)) found.add(m[1]);
    return [...found].sort();
  }
  const code = text.replace(COMMENT_RE, (_m, lead: string | undefined) => lead ?? " ");
  for (const re of IMPORT_RES) for (const m of code.matchAll(re)) found.add(resolveSpecifier(root, file, m[1]));
  return [...found].sort();
}

function resolveSpecifier(root: string, from: string, spec: string): string {
  if (!spec.startsWith(".")) return spec;
  const joined = path.posix.join(path.posix.dirname(from), spec);
  const asSource = joined.replace(SOURCE_EXT, "");
  for (const ext of [".ts", ".mts", ".mjs", ".js"]) if (existsSync(path.join(root, asSource + ext))) return asSource + ext;
  if (existsSync(path.join(root, asSource, "index.ts"))) return `${asSource}/index.ts`;
  return joined;
}

export interface GateDrift {
  module: string;
  import: string;
  message: string;
}

/** Every first-order import of a listed module that the list does not name for it. A listed gate module as an import is always allowed. */
export function gateImportDrift(root: string, entry: ProjectGateSet): GateDrift[] {
  const checked: Array<{ path: string; imports: string[] }> = [
    ...entry.gateModules,
    ...entry.self.filter((s): s is GateSetSelfEntry & { imports: string[] } => Array.isArray(s.imports)),
  ];
  const gatePaths = new Set(entry.gateModules.map((m) => m.path));
  const drift: GateDrift[] = [];
  for (const mod of checked) {
    if (!existsSync(path.join(root, mod.path))) {
      drift.push({ module: mod.path, import: "", message: `${mod.path} is listed in ${GATE_SET_PATH} but does not exist` });
      continue;
    }
    const allowed = new Set(mod.imports);
    for (const imp of firstOrderImports(root, mod.path)) {
      if (allowed.has(imp) || gatePaths.has(imp)) continue;
      drift.push({ module: mod.path, import: imp, message: `${mod.path} imports ${imp}, which is not in the gate-set list (${GATE_SET_PATH}); add it there deliberately or drop the import` });
    }
  }
  return drift;
}

export interface GatePathClass {
  protected: boolean;
  /** Why: the list entry, hard class or fail-closed root that covers it. */
  reason: string;
  /** False when the path is protected only because it sits under a listed gate directory. */
  mapped: boolean;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
const covers = (pattern: string, p: string) => (pattern.endsWith("/") ? p.startsWith(pattern) : p === pattern);

/** Classify a repo-relative path against one Project's list. Unmapped files under a listed gate directory are protected (fail closed). */
export function classifyGatePath(entry: ProjectGateSet, file: string): GatePathClass | { protected: false; reason: "outside the gate set"; mapped: false } {
  const p = norm(file);
  const named = [...entry.gateModules, ...entry.self].find((m) => m.path === p);
  if (named) return { protected: true, reason: `gate-set entry ${named.id}`, mapped: true };
  for (const dir of entry.spend) if (covers(dir, p)) return { protected: true, reason: `spend path ${dir}`, mapped: true };
  for (const cls of entry.hardClasses) for (const pattern of cls.paths) if (covers(pattern, p)) return { protected: true, reason: `hard class ${cls.name}`, mapped: true };
  for (const imp of entry.gateModules.flatMap((m) => m.imports)) if (imp === p) return { protected: true, reason: "first-order import of a gate module", mapped: true };
  for (const mod of entry.gateModules) {
    const dir = path.posix.dirname(mod.path);
    if (dir !== "." && p.startsWith(`${dir}/`)) return { protected: true, reason: `unmapped file under listed gate directory ${dir}/ (fail closed)`, mapped: false };
  }
  return { protected: false, reason: "outside the gate set", mapped: false };
}

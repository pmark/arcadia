/**
 * Combined session-ledger reader. Sources, in order: the frozen legacy
 * docs/reports/session-ledger.jsonl, then one JSON file per Session under
 * docs/reports/session-ledger/ sorted by full file name. File names are
 * `<YYYYMMDDTHHMMZ>-<session_id>.json` so lexical order is chronological and two
 * branches never touch the same path. Pure over injected contents; the fs wrapper is thin.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateSessionLedgerRow, type SessionLedgerRow } from "./sessionLedger.js";

export const LEGACY_LEDGER = "docs/reports/session-ledger.jsonl";
export const LEDGER_DIR = "docs/reports/session-ledger";
export const FRICTION_DIR = "docs/reports/frictions";
export const HANDOFF_DIR = "docs/reports/handoffs";

/** `readError` marks a directory entry that could not be read (not a regular file, unreadable). */
export interface NamedContent { name: string; content: string; readError?: string }
export interface LedgerEntry { row: SessionLedgerRow; source: string }
/** `entries`/`rows` hold only rows from sources with no error; `errors` lists every problem, each naming its source. */
export interface CombinedLedger { entries: LedgerEntry[]; rows: SessionLedgerRow[]; errors: string[] }

const LEDGER_FILE = /^(\d{8}T\d{4}Z)-(.+)\.json$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const byName = (a: NamedContent, b: NamedContent) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Combines legacy JSONL text (or null) with directory files; every error names its file (legacy: file:line). */
export function combineSessionLedger(legacyText: string | null, files: NamedContent[], legacyName = LEGACY_LEDGER): CombinedLedger {
  const entries: LedgerEntry[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const bad = new Set<string>();
  const fail = (source: string, message: string) => { bad.add(source); errors.push(`${source}: ${message}`); };
  const accept = (parsed: unknown, source: string) => {
    for (const error of validateSessionLedgerRow(parsed)) fail(source, error);
    if (!isObject(parsed)) return;
    const id = parsed.session_id;
    if (typeof id === "string") {
      const prior = seen.get(id);
      if (prior) fail(source, `duplicate session_id ${id} (also in ${prior})`);
      else seen.set(id, source);
    }
    entries.push({ row: parsed as unknown as SessionLedgerRow, source });
  };
  (legacyText ?? "").split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const source = `${legacyName}:${index + 1}`;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { fail(source, "invalid JSON"); return; }
    accept(parsed, source);
  });
  for (const file of [...files].sort(byName)) {
    if (file.readError) { fail(file.name, file.readError); continue; }
    const match = LEDGER_FILE.exec(path.posix.basename(file.name));
    if (!match) { fail(file.name, "file name must be <YYYYMMDDTHHMMZ>-<session_id>.json"); continue; }
    let parsed: unknown;
    try { parsed = JSON.parse(file.content); } catch { fail(file.name, "invalid JSON"); continue; }
    if (!isObject(parsed)) { fail(file.name, "row is not a JSON object"); continue; }
    const id = parsed.session_id;
    if (typeof id === "string" && (!SAFE_ID.test(id) || id.includes(".."))) fail(file.name, `unsafe session_id ${JSON.stringify(id)}`);
    else if (typeof id === "string" && id !== match[2]) fail(file.name, `file name session_id ${match[2]} does not equal row session_id ${id}`);
    accept(parsed, file.name);
  }
  const good = entries.filter(entry => !bad.has(entry.source));
  return { entries: good, rows: good.map(entry => entry.row), errors };
}

const IGNORED = new Set(["README.md", ".gitkeep"]);

/** Every entry except README.md/.gitkeep is returned so a misnamed or non-regular entry is a named error. */
function readDir(repoRoot: string, dir: string): NamedContent[] {
  const abs = path.join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).filter(entry => !IGNORED.has(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry): NamedContent => {
      const name = `${dir}/${entry.name}`;
      if (!entry.isFile()) return { name, content: "", readError: "not a regular file (directory, symlink or special file)" };
      try { return { name, content: readFileSync(path.join(abs, entry.name), "utf8") }; } catch { return { name, content: "", readError: "unreadable" }; }
    });
}

/** Reads the combined ledger for a repository root; a missing legacy file or directory is empty. */
export function readSessionLedger(repoRoot: string): CombinedLedger {
  const legacy = path.join(repoRoot, LEGACY_LEDGER);
  return combineSessionLedger(existsSync(legacy) ? readFileSync(legacy, "utf8") : null, readDir(repoRoot, LEDGER_DIR));
}

/** Friction files: `<YYYYMMDD>-<slug>.md`, front matter id equals slug and is not a legacy number. */
export function validateFrictionFiles(files: NamedContent[]): string[] {
  const errors: string[] = [];
  const ids = new Map<string, string>();
  for (const file of [...files].sort(byName)) {
    if (file.readError) { errors.push(`${file.name}: ${file.readError}`); continue; }
    const match = /^(\d{8})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(path.posix.basename(file.name));
    if (!match) { errors.push(`${file.name}: file name must be <YYYYMMDD>-<slug>.md`); continue; }
    if (/^f?\d+[a-z]?$/i.test(match[2])) errors.push(`${file.name}: slug ${match[2]} collides with a legacy friction number`);
    const front = /^---\n([\s\S]*?)\n---/.exec(file.content);
    const fields = new Map<string, string>();
    for (const line of (front?.[1] ?? "").split("\n")) {
      const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
      if (kv) fields.set(kv[1], kv[2].trim());
    }
    for (const key of ["id", "cost", "fix", "status"]) if (!fields.get(key)) errors.push(`${file.name}: front matter is missing ${key}`);
    if (fields.get("id") && fields.get("id") !== match[2]) errors.push(`${file.name}: front matter id ${fields.get("id")} must equal slug ${match[2]}`);
    const prior = ids.get(match[2]);
    if (prior) errors.push(`${file.name}: duplicate friction id ${match[2]} (also in ${prior})`);
    ids.set(match[2], file.name);
  }
  return errors;
}

/** Hand-off files: `<YYYYMMDDTHHMMZ>-<session_id>.md`. */
export function validateHandoffFiles(files: NamedContent[]): string[] {
  return files.filter(file => {
    if (file.readError) return true;
    const match = /^\d{8}T\d{4}Z-(.+)\.md$/.exec(path.posix.basename(file.name));
    return !match || !SAFE_ID.test(match[1]) || match[1].includes("..");
  }).map(file => `${file.name}: ${file.readError ?? "file name must be <YYYYMMDDTHHMMZ>-<session_id>.md"}`);
}

export function readFrictionFiles(repoRoot: string): NamedContent[] { return readDir(repoRoot, FRICTION_DIR); }
export function readHandoffFiles(repoRoot: string): NamedContent[] { return readDir(repoRoot, HANDOFF_DIR); }

/** Compact projection of the last `n` combined rows (legacy first, then directory files) for read-only inspection. */
export function tailLedger(rows: SessionLedgerRow[], n: number): string[] {
  return rows.slice(Math.max(0, rows.length - Math.max(0, n))).map(row => JSON.stringify({
    session_id: row.session_id, outcome: row.outcome, action_id: row.action_id, pr: row.pr, notes: row.notes ?? null,
  }));
}

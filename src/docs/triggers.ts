import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * What a declared deferral is currently doing.
 *
 * - `fired` — the condition is met. The continuation protocol's rule that a
 *   firing trigger outranks `current_action` finally has something to read.
 * - `waiting` — evaluated, condition not met. Nothing to do, and that is a
 *   real answer rather than an absence of one.
 * - `unevaluable` — declared in prose no command can check. Reported anyway,
 *   because a deferral nobody can see is the failure this command exists to
 *   end.
 * - `untriggered` — a deferred document that names no reviving condition at
 *   all. `AGENTS.md` calls this a rejection wearing a deferral's clothes.
 */
export type TriggerState = "fired" | "waiting" | "unevaluable" | "untriggered";

export interface EvaluatedTrigger {
  id: string;
  state: TriggerState;
  /** Repository-relative path of the document or registry that declares it. */
  source: string;
  /** 1-indexed line, when the deferral is a clause inside a document. */
  line: number | null;
  watches: string | null;
  condition: string;
  /** The plan or Action this deferral revives, when it names one. */
  fires: string | null;
  reason: string;
}

export interface TriggerReport {
  repoRoot: string;
  registry: string | null;
  triggers: EvaluatedTrigger[];
  counts: Record<TriggerState, number>;
}

const REGISTRY_PATH = ".arcadia/triggers.json";
const SUPPORTED_SCHEMA = "arcadia.triggers.v0";

/**
 * How this repository's documents actually spell a deferral.
 *
 * `**Trigger:**` and `*Trigger:` are both in live use, and a clause can sit
 * mid-sentence rather than starting its line. `revives when` and its cousins
 * are how the deferred Decisions phrase the same commitment. A reader that
 * knows only one spelling silently drops the rest, which is the exact failure
 * this command exists to end — so every known spelling is listed here, and an
 * unknown one is a bug worth adding to this list.
 */
const CLAUSE_PATTERNS = [
  /\*{0,2}Trigger:\*{0,2}\s*(.+)$/,
  /\b((?:revives?|revisit|reactivates?|re-ask(?:ed)?)\s+when\b.+)$/i
];

/** `Trigger:` inside backticks is prose *about* triggers, not a deferral. */
const QUOTED_MENTION = /`[^`]*Trigger[^`]*`/;

/**
 * Every deferral a repository declares, and what each one is doing now.
 *
 * Pure and repo-local, the same shape as `resolveDispatch`: no workspace, no
 * database, no network. It reads the checked-in documents the Constitution
 * calls authoritative, so it answers correctly in a fresh clone or a container.
 *
 * It reports and never writes.
 */
export function evaluateTriggers(repoRoot: string): TriggerReport {
  const triggers: EvaluatedTrigger[] = [
    ...evaluateRegistry(repoRoot),
    ...scanDocuments(repoRoot)
  ];
  const counts: Record<TriggerState, number> = { fired: 0, waiting: 0, unevaluable: 0, untriggered: 0 };
  for (const trigger of triggers) counts[trigger.state] += 1;
  const registry = existsSync(path.join(repoRoot, REGISTRY_PATH)) ? REGISTRY_PATH : null;
  return { repoRoot, registry, triggers, counts };
}

/** Machine-checkable triggers, from the registry PPN proved the shape of. */
function evaluateRegistry(repoRoot: string): EvaluatedTrigger[] {
  const registryPath = path.join(repoRoot, REGISTRY_PATH);
  if (!existsSync(registryPath)) return [];

  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(registryPath, "utf8")); } catch (error) {
    return [unevaluableRegistry(REGISTRY_PATH, `Registry is not valid JSON: ${message(error)}`)];
  }
  if (!isRecord(parsed)) return [unevaluableRegistry(REGISTRY_PATH, "Registry is not an object.")];
  if (parsed.schema !== SUPPORTED_SCHEMA) {
    return [unevaluableRegistry(REGISTRY_PATH, `Registry schema is ${JSON.stringify(parsed.schema)}, not ${SUPPORTED_SCHEMA}.`)];
  }
  const declared = Array.isArray(parsed.triggers) ? parsed.triggers : [];

  return declared.map((entry, index) => {
    if (!isRecord(entry)) return unevaluableRegistry(REGISTRY_PATH, `Registry entry ${index} is not an object.`);
    const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `entry-${index}`;
    const watches = typeof entry.watches === "string" ? entry.watches : null;
    const fires = firesOf(entry.fires);
    const condition = isRecord(entry.condition) ? entry.condition : null;
    const describe = condition && typeof condition.describe === "string" ? condition.describe : null;

    if (!condition) {
      return { id, state: "unevaluable", source: REGISTRY_PATH, line: null, watches, fires,
        condition: "none declared", reason: "Registry entry declares no condition." };
    }

    const base = { id, source: REGISTRY_PATH, line: null, watches, fires } as const;

    if (condition.kind === "observed") {
      const observed = condition.observed === true;
      const lookFor = typeof condition.lookFor === "string" ? condition.lookFor : "an observation recorded in the registry";
      return {
        ...base,
        state: observed ? "fired" : "waiting",
        condition: describe ?? lookFor,
        reason: observed
          ? "The registry records this as observed."
          : "Waiting on a person to record the observation in the registry."
      };
    }

    if (condition.kind === "count") {
      const evaluated = evaluateCount(repoRoot, condition);
      return {
        ...base,
        state: evaluated.ok === false ? "unevaluable" : evaluated.fired ? "fired" : "waiting",
        condition: describe ?? `${condition.collection ?? "items"} in ${condition.file ?? "an unnamed file"}`,
        reason: evaluated.reason
      };
    }

    return { ...base, state: "unevaluable", condition: describe ?? "unknown condition",
      reason: `Condition kind ${JSON.stringify(condition.kind)} is not supported by this Arcadia.` };
  });
}

/** Count matching records in a repository-local JSON file. */
function evaluateCount(repoRoot: string, condition: Record<string, unknown>):
  { ok: true; fired: boolean; reason: string } | { ok: false; reason: string } {
  const file = typeof condition.file === "string" ? condition.file : null;
  const collection = typeof condition.collection === "string" ? condition.collection : null;
  const atLeast = typeof condition.atLeast === "number" ? condition.atLeast : null;
  if (!file || atLeast === null) return { ok: false, reason: "Count condition needs both `file` and `atLeast`." };

  // Containment: a registry must not reach outside the repository it governs.
  const resolved = path.resolve(repoRoot, file);
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    return { ok: false, reason: `Count condition names ${file}, which is outside this repository.` };
  }
  if (!existsSync(resolved)) return { ok: false, reason: `Count condition names ${file}, which does not exist.` };

  let data: unknown;
  try { data = JSON.parse(readFileSync(resolved, "utf8")); } catch (error) {
    return { ok: false, reason: `${file} is not valid JSON: ${message(error)}` };
  }
  const rows = collection ? (isRecord(data) ? data[collection] : undefined) : data;
  if (!Array.isArray(rows)) {
    return { ok: false, reason: `${file}${collection ? ` → ${collection}` : ""} is not a list.` };
  }
  const where = isRecord(condition.where) ? condition.where : {};
  const matched = rows.filter((row) => isRecord(row) && Object.entries(where).every(([key, value]) => row[key] === value));
  return {
    ok: true,
    fired: matched.length >= atLeast,
    reason: `${matched.length} of ${rows.length} match; ${atLeast} needed.`
  };
}

/**
 * Deferrals declared as prose in the governed documents themselves.
 *
 * No command can check English, so these are reported `unevaluable` rather
 * than evaluated. That is the point: nine such clauses lived in this
 * repository with nothing able to even list them.
 */
function scanDocuments(repoRoot: string): EvaluatedTrigger[] {
  const found: EvaluatedTrigger[] = [];
  for (const relative of governedDocuments(repoRoot)) {
    let text: string;
    try { text = readFileSync(path.join(repoRoot, relative), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    const clauses: EvaluatedTrigger[] = [];
    const frontmatterEnd = frontmatterEndLine(lines);
    // The dominant form in this repository: a table whose last column names the
    // reviving condition, one row per deferred item. Rows carry both halves the
    // report wants, so they are read as structure rather than scanned as prose.
    let tableConditionColumn: number | null = null;

    lines.forEach((line, index) => {
      if (index <= frontmatterEnd) return;

      if (line.trimStart().startsWith("|")) {
        const cells = tableCells(line);
        if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return;
        if (tableConditionColumn === null) {
          const column = cells.findIndex((cell) => /^(reactivate|revive|revisit|re-ask)s? when$|^trigger$/i.test(cell));
          if (column >= 0) tableConditionColumn = column;
          return;
        }
        const condition = cells[tableConditionColumn];
        if (!condition) return;
        clauses.push({
          id: `${relative}:${index + 1}`,
          state: "unevaluable",
          source: relative,
          line: index + 1,
          watches: cells[0] === condition ? null : cells[0] ?? null,
          fires: null,
          condition,
          reason: "Declared in prose. Move it into .arcadia/triggers.json to make it checkable."
        });
        return;
      }
      tableConditionColumn = null;

      if (QUOTED_MENTION.test(line)) return;
      const condition = CLAUSE_PATTERNS.reduce<string | null>((found, pattern) => {
        if (found) return found;
        const captured = pattern.exec(line)?.[1]?.replace(/[*_\s]+$/, "").trim();
        return captured ? captured : null;
      }, null);
      if (!condition) return;
      clauses.push({
        id: `${relative}:${index + 1}`,
        state: "unevaluable",
        source: relative,
        line: index + 1,
        watches: null,
        fires: null,
        condition,
        reason: "Declared in prose. Move it into .arcadia/triggers.json to make it checkable."
      });
    });
    found.push(...clauses);

    // A deferred document naming no reviving condition is the case AGENTS.md
    // calls a rejection wearing a deferral's clothes. Say so out loud.
    if (clauses.length === 0 && /^status:\s*deferred\s*$/m.test(text)) {
      found.push({
        id: relative,
        state: "untriggered",
        source: relative,
        line: null,
        watches: null,
        fires: null,
        condition: "none found",
        reason: "Deferred, and no reviving condition was found in it. A deferral that names no trigger is a rejection; write the condition or close it."
      });
    }
  }
  return found;
}

/** Cells of a markdown table row, without the leading and trailing pipes. */
function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

/**
 * The last line of the YAML frontmatter, or -1 when there is none.
 *
 * Frontmatter restates a document's answer, so scanning it reports the same
 * deferral twice — once as a paragraph-long `answer:` and again where the
 * document actually declares it.
 */
function frontmatterEndLine(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") return index;
  }
  return -1;
}

function governedDocuments(repoRoot: string): string[] {
  const documents: string[] = [];
  if (existsSync(path.join(repoRoot, "PROJECT.md"))) documents.push("PROJECT.md");
  for (const directory of ["docs/plans", "docs/decisions"]) {
    const absolute = path.join(repoRoot, directory);
    if (!existsSync(absolute)) continue;
    let entries: string[];
    try { entries = readdirSync(absolute); } catch { continue; }
    for (const entry of entries.sort()) {
      if (entry.endsWith(".md")) documents.push(`${directory}/${entry}`);
    }
  }
  return documents;
}

function firesOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const parts = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, name]) => `${key} ${name}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function unevaluableRegistry(source: string, reason: string): EvaluatedTrigger {
  return { id: source, state: "unevaluable", source, line: null, watches: null, fires: null, condition: "registry", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

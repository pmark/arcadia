import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { Findings, isDate, isObj, items, oneOf, requireEnum, requireText, text, type Obj } from "./common.js";
import { checkFieldGuide, FIELD_GUIDE_SCHEMA } from "./fieldGuide.js";

export const RECORD_SCHEMA = "arcadia-design-record-v1";

const SOURCE_KINDS = ["operator", "agent", "third_party", "client"] as const;
const RETENTION = ["repo", "pointer", "workspace"] as const;
const CONCEPT_KINDS = ["mechanism", "requirement", "constraint", "risk", "claim", "interface"] as const;
const POSITIONS = ["open", "candidates", "leaning", "chosen", "rejected", "parked", "merged", "captured"] as const;
const FIT_STATUS = ["exists", "partial", "missing", "conflicts"] as const;
const DECIDERS = ["operator", "agent"] as const;
const ASSUMPTION_STATUS = ["untested", "supported", "contradicted", "inconclusive", "accepted_risk"] as const;
const VERDICTS = ["pass", "pass_with_changes", "hold", "incomplete"] as const;
const LENSES = ["mission", "evidence", "failure"] as const;
const SEVERITY = ["blocking", "note"] as const;
const DISPOSITION = ["open", "fixed", "declined", "accepted_risk"] as const;
const FRAME_STATUS = ["proposed", "confirmed"] as const;
const UNSETTLED = ["open", "candidates", "leaning"] as const;
const SETTLED_OPTION = ["rejected", "parked", "merged"] as const;

// `#` stands for at least that many digits, so IDs never need renumbering past 999.
const ID_FORMS = {
  source: /^S\d{3,}$/,
  concept: /^C-\d{3,}$/,
  choice: /^CH-\d{2,}$/,
  requirement: /^REQ-\d{3,}$/,
  mission: /^M\d+$/,
  review: /^R\d+$/
} as const;
const SHA256 = /^[0-9a-f]{64}$/;
const MISSION_FILES = ["PROJECT.md", "CONSTITUTION.md", "NORTH_STAR.md"] as const;
const MIN_QUOTE_CHARACTERS = 20;

export interface DesignMatrix {
  shared: Array<{ concept: string; title: string; sources: string[] }>;
  differentiated: Array<{ source: string; title: string; concepts: Array<{ concept: string; title: string }> }>;
  choices: Array<{
    choice: string; question: string; status: "chosen" | "open"; chosen: string | null; decidedBy: string | null;
    options: Array<{ concept: string; title: string; position: string; consequence: string }>;
  }>;
  trace: Array<{
    requirement: string; statement: string; mission: string[];
    concepts: Array<{ concept: string; title: string; origins: Array<{ source: string; locator: string }> }>;
  }>;
  cutOrLater: Array<{ concept: string; title: string; position: string; reason: string | null; revival: string | null }>;
}

export interface DesignCheckResult {
  file: string;
  kind: "record" | "field-guide" | "unknown";
  schema: string | null;
  problems: string[];
  warnings: string[];
  recordHash?: string;
  matrix?: DesignMatrix;
}

export interface DesignCheckOptions {
  ready?: boolean;
  matrix?: boolean;
  /** The Arcadia workspace root, when one resolved and exists; `workspace` sources are only verified against it. */
  workspace?: string | null;
}

/** SHA-256 of the canonical JSON (keys sorted recursively) with the top-level `scrutiny` removed. */
export function recordHash(record: Obj): string {
  const { scrutiny: _scrutiny, ...rest } = record;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown, ancestors: Set<object> = new Set()): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) throw new Error("the document is self-referential (an alias refers to its own ancestor)");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => sortKeys(item, ancestors));
    const record = value as Obj;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key], ancestors)]));
  } finally {
    ancestors.delete(value);
  }
}

/** Whether a parsed document contains a structure that refers to its own ancestor (YAML `a: &a { b: *a }`). */
export function isSelfReferential(value: unknown): boolean {
  try { sortKeys(value); return false; } catch { return true; }
}

export type Contained = { ok: true; resolved: string; exists: boolean } | { ok: false; reason: string };

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function lstatExists(target: string): boolean {
  try { lstatSync(target); return true; } catch { return false; }
}

/** What can be refused without touching the disk: a NUL byte, an absolute path or a `..` escape. */
export function lexicalRefusal(relative: string): string | null {
  if (relative.includes("\0")) return "contains a NUL byte";
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) return "is an absolute path";
  const fake = path.join(path.sep, "root", "dir");
  if (!insideRoot(fake, path.resolve(fake, relative))) return "escapes its directory with ..";
  return null;
}

/**
 * Resolves `relative` inside `root` (an existing real directory). Refuses an absolute
 * path, a `..` escape, and a symlink whose real target leaves `root`, checked with
 * realpath on the deepest part that exists. A refusal is a result, never a throw.
 */
export function resolveContained(root: string, relative: string): Contained {
  const lexical = lexicalRefusal(relative);
  if (lexical) return { ok: false, reason: lexical };
  const resolved = path.resolve(root, relative);
  let probe = resolved;
  while (!lstatExists(probe)) probe = path.dirname(probe);
  let real: string;
  try { real = realpathSync(probe); } catch { return { ok: false, reason: "is a symlink that cannot be resolved" }; }
  if (!insideRoot(root, real)) return { ok: false, reason: "resolves through a symlink to outside its directory" };
  return { ok: true, resolved: probe === resolved ? real : resolved, exists: probe === resolved };
}

/**
 * The project root of a record at `<root>/docs/design/<slug>/record.yaml` (the real
 * directory is given), or null when it is anywhere else or `<root>` has no PROJECT.md.
 * A PROJECT.md elsewhere never counts, so a planted file cannot become the root.
 */
export function recordProjectRoot(recordDir: string, fileName: string): string | null {
  if (fileName !== "record.yaml") return null;
  const docsDesign = path.dirname(recordDir);
  const docs = path.dirname(docsDesign);
  if (path.basename(docsDesign) !== "design" || path.basename(docs) !== "docs") return null;
  const root = path.dirname(docs);
  try {
    return statSync(path.join(root, "PROJECT.md")).isFile() ? root : null;
  } catch {
    return null;
  }
}

function readRegularFile(file: string): Buffer | string {
  try {
    if (!statSync(file).isFile()) return "is not a regular file";
    return readFileSync(file);
  } catch (error) {
    return `could not be read (${error instanceof Error ? error.message : String(error)})`;
  }
}

const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Reads, parses and checks one design file, dispatching on its `schema`. Never throws for bad input. */
export function checkDesignFile(file: string, options: DesignCheckOptions = {}): DesignCheckResult {
  const result: DesignCheckResult = { file, kind: "unknown", schema: null, problems: [], warnings: [] };
  const bytes = readRegularFile(file);
  if (typeof bytes === "string") { result.problems.push(`file: ${bytes}`); return result; }

  let data: unknown;
  try {
    // Defaults stay on, including the alias-expansion limit that stops a YAML bomb.
    data = parseYaml(bytes.toString("utf8"), { logLevel: "error" });
  } catch (error) {
    result.problems.push(`yaml: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return result;
  }
  if (!isObj(data)) { result.problems.push("yaml: the file must hold a mapping at its root."); return result; }
  if (isSelfReferential(data)) { result.problems.push("yaml: the document is self-referential (an alias refers to its own ancestor)."); return result; }

  result.schema = typeof data.schema === "string" ? data.schema : null;
  if (data.schema === FIELD_GUIDE_SCHEMA) {
    result.kind = "field-guide";
    const findings = checkFieldGuide(data, path.basename(file).replace(/\.ya?ml$/, ""));
    result.problems.push(...findings.problems);
    result.warnings.push(...findings.warnings);
    if (options.ready) result.warnings.push("--ready applies to design records only; ignored for a field guide.");
    if (options.matrix) result.warnings.push("--matrix applies to design records only; ignored for a field guide.");
    return result;
  }
  if (data.schema !== RECORD_SCHEMA) {
    result.problems.push(`schema: must be ${RECORD_SCHEMA} or ${FIELD_GUIDE_SCHEMA} (found ${JSON.stringify(data.schema ?? null)}).`);
    return result;
  }

  result.kind = "record";
  const recordDir = realpathSync(path.dirname(file));
  const findings = new RecordChecker(data, recordDir, recordProjectRoot(recordDir, path.basename(file)), realWorkspace(options.workspace), Boolean(options.ready)).run();
  result.problems.push(...findings.problems);
  result.warnings.push(...findings.warnings);
  result.recordHash = recordHash(data);
  if (options.matrix) result.matrix = buildMatrix(data);
  return result;
}

function plainWebUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/** The `status` of a leading YAML frontmatter block, or null when there is none or it does not parse. */
function frontmatterStatus(markdown: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return null;
  try {
    const front: unknown = parseYaml(match[1], { logLevel: "error" });
    return isObj(front) && typeof front.status === "string" ? front.status : null;
  } catch {
    return null;
  }
}

/** The workspace's real path, or null when it is absent or unresolvable; never throws. */
function realWorkspace(workspace: string | null | undefined): string | null {
  if (!workspace) return null;
  try {
    const real = realpathSync(workspace);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

// Case, a "Critic" title and punctuation around the name do not make a different person.
const normalizeName = (name: string): string => name.toLowerCase().replace(/\bcritic\b/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

class RecordChecker {
  private readonly f = new Findings();
  private readonly hash: string;
  private readonly sourceIds = new Set<string>();
  private readonly conceptIds = new Set<string>();
  private readonly missionIds = new Set<string>();
  private readonly requirementIds = new Set<string>();
  private readonly concepts = new Map<string, Obj>();
  private readonly sourceEntries = new Map<string, Obj>();

  constructor(
    private readonly data: Obj,
    private readonly recordDir: string,
    private readonly projectRoot: string | null,
    private readonly workspace: string | null,
    private readonly ready: boolean
  ) {
    this.hash = recordHash(data);
  }

  run(): Findings {
    const d = this.data;
    requireText(this.f, "design", d.design, "design");
    requireText(this.f, "project", d.project, "project");
    const authors = items(d.authors);
    if (!Array.isArray(d.authors) || authors.length === 0 || authors.some((author) => text(author) === null)) {
      this.f.problem("authors", "authors is required: a list of one or more names.");
    }
    if (this.projectRoot === null) {
      this.f.problem("project", `the record must be at <project root>/docs/design/<slug>/record.yaml, with PROJECT.md at the project root (found ${path.join(this.recordDir, "record.yaml")}); mission quotes, fit evidence and authority references cannot be checked.`);
    }
    this.collectIds();
    this.frame();
    this.sources();
    this.conceptChecks();
    this.choices();
    this.assumption();
    this.scrutiny();
    if (this.ready) this.readyGate();
    return this.f;
  }

  /** Registers an ID after checking its form and uniqueness; returns it when usable. */
  private id(where: string, value: unknown, form: keyof typeof ID_FORMS, seen: Set<string>): string | null {
    const id = text(value);
    if (id === null) { this.f.problem(where, "id is required."); return null; }
    if (!ID_FORMS[form].test(id)) { this.f.problem(where, `id "${id}" does not match ${ID_FORMS[form].source}.`); return null; }
    if (seen.has(id)) { this.f.problem(where, `duplicate id ${id}.`); return null; }
    seen.add(id);
    return id;
  }

  /** IDs are gathered first so a reference may point forward in the file. */
  private collectIds(): void {
    const collect = (list: unknown, form: keyof typeof ID_FORMS, into: Set<string>): void => {
      for (const entry of items(list)) {
        if (isObj(entry) && text(entry.id) && ID_FORMS[form].test(String(entry.id))) into.add(String(entry.id));
      }
    };
    collect(this.data.sources, "source", this.sourceIds);
    for (const entry of items(this.data.sources)) if (isObj(entry) && typeof entry.id === "string" && this.sourceIds.has(entry.id)) this.sourceEntries.set(entry.id, entry);
    collect(this.data.concepts, "concept", this.conceptIds);
    const frame = isObj(this.data.frame) ? this.data.frame : {};
    collect(frame.mission, "mission", this.missionIds);
    collect(frame.requirements, "requirement", this.requirementIds);
    for (const entry of items(this.data.concepts)) {
      if (isObj(entry) && typeof entry.id === "string" && this.conceptIds.has(entry.id) && !this.concepts.has(entry.id)) this.concepts.set(entry.id, entry);
    }
  }

  private list(where: string, value: unknown, required = false): unknown[] {
    if (value === undefined || value === null) {
      if (required) this.f.problem(where, "is required and must be a list.");
      return [];
    }
    if (!Array.isArray(value)) { this.f.problem(where, "must be a list."); return []; }
    return value;
  }

  private entryLabel(prefix: string, entry: unknown, index: number): string {
    return `${prefix}[${isObj(entry) && text(entry.id) ? String(entry.id) : index}]`;
  }

  private frame(): void {
    const frame = this.data.frame;
    if (!isObj(frame)) { this.f.problem("frame", "frame is required and must be a mapping."); return; }
    requireEnum(this.f, "frame", frame.status, "status", FRAME_STATUS);
    requireText(this.f, "frame", frame.outcome, "outcome");
    requireText(this.f, "frame", frame.milestone, "milestone");
    requireText(this.f, "frame", frame.experience_target, "experience_target");
    if (frame.non_goals !== undefined) {
      const goals = this.list("frame.non_goals", frame.non_goals);
      if (goals.some((goal) => text(goal) === null)) this.f.problem("frame.non_goals", "every non-goal must be a non-blank string.");
    }

    const seenMission = new Set<string>();
    this.list("frame.mission", frame.mission).forEach((entry, index) => {
      const where = this.entryLabel("frame.mission", entry, index);
      if (!isObj(entry)) { this.f.problem(where, "must be a mapping."); return; }
      this.id(where, entry.id, "mission", seenMission);
      const file = requireText(this.f, where, entry.file, "file");
      const allowed = file !== null && (MISSION_FILES as readonly string[]).includes(file);
      if (file !== null && !allowed) this.f.problem(where, `file "${file}" must be exactly ${MISSION_FILES.slice(0, -1).join(", ")} or ${MISSION_FILES[MISSION_FILES.length - 1]} (exact case, at the project root).`);
      const quote = typeof entry.quote === "string" && entry.quote.trim() !== "" ? entry.quote : null;
      if (quote === null) this.f.problem(where, "quote is required and must not be blank.");
      else if ([...quote.replace(/\s/g, "")].length < MIN_QUOTE_CHARACTERS) this.f.problem(where, `quote needs at least ${MIN_QUOTE_CHARACTERS} non-whitespace characters.`);
      else if (allowed) this.missionQuote(where, file, quote);
    });

    const seenReq = new Set<string>();
    this.list("frame.requirements", frame.requirements).forEach((entry, index) => {
      const where = this.entryLabel("frame.requirements", entry, index);
      if (!isObj(entry)) { this.f.problem(where, "must be a mapping."); return; }
      this.id(where, entry.id, "requirement", seenReq);
      requireText(this.f, where, entry.statement, "statement");
      if (entry.mission !== undefined) {
        for (const ref of this.list(`${where}.mission`, entry.mission)) {
          if (typeof ref !== "string" || !this.missionIds.has(ref)) this.f.problem(where, `mission reference ${JSON.stringify(ref)} is not a mission entry in frame.mission.`);
        }
      }
    });
  }

  private missionQuote(where: string, file: string, quote: string): void {
    if (this.projectRoot === null) return;
    const target = resolveContained(this.projectRoot, file);
    if (!target.ok) { this.f.problem(where, `file "${file}" ${target.reason}.`); return; }
    if (!target.exists) { this.f.problem(where, `file "${file}" does not exist in the Project.`); return; }
    const bytes = readRegularFile(target.resolved);
    if (typeof bytes === "string") { this.f.problem(where, `file "${file}" ${bytes}.`); return; }
    if (!bytes.toString("utf8").includes(quote)) this.f.problem(where, `quote does not appear exactly in ${file}.`);
  }

  private sources(): void {
    const seen = new Set<string>();
    this.list("sources", this.data.sources).forEach((entry, index) => {
      const where = this.entryLabel("sources", entry, index);
      if (!isObj(entry)) { this.f.problem(where, "must be a mapping."); return; }
      this.id(where, entry.id, "source", seen);
      requireText(this.f, where, entry.title, "title");
      const kind = requireEnum(this.f, where, entry.kind, "kind", SOURCE_KINDS);
      if (!isDate(entry.added)) this.f.problem(where, "added is required and must be a YYYY-MM-DD date.");
      const retention = requireEnum(this.f, where, entry.retention, "retention", RETENTION);

      if (retention === "pointer") {
        for (const field of ["url", "revision", "rights"] as const) {
          if (text(entry[field]) === null) this.f.problem(where, `a pointer source needs ${field}.`);
        }
        if (text(entry.url) !== null && !plainWebUrl(String(entry.url))) this.f.problem(where, `url ${JSON.stringify(entry.url)} must be an http or https URL with no embedded username or password.`);
      }
      if (retention === "repo" && (kind === "third_party" || kind === "client") && text(entry.rights) === null) {
        this.f.problem(where, `a ${kind} source kept in the repository needs rights stated.`);
      }
      if (retention === "repo") this.sourceFile(where, entry, "path", this.recordDir, "the design directory");
      if (retention === "workspace") this.workspaceSource(where, entry);
    });
  }

  /** The hash is checked only when its form is valid; returns the declared hash when usable. */
  private declaredHash(where: string, entry: Obj): string | null {
    if (entry.sha256 === undefined || entry.sha256 === null) { this.f.problem(where, "sha256 is required."); return null; }
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      this.f.problem(where, "sha256 must be 64 lowercase hex characters.");
      return null;
    }
    return entry.sha256;
  }

  private sourceFile(where: string, entry: Obj, field: "path", root: string, rootName: string): void {
    const relative = requireText(this.f, where, entry[field], field);
    const declared = this.declaredHash(where, entry);
    if (relative === null) return;
    const target = resolveContained(root, relative);
    if (!target.ok) { this.f.problem(where, `${field} "${relative}" ${target.reason}.`); return; }
    if (!target.exists) { this.f.problem(where, `${field} "${relative}" does not exist in ${rootName}.`); return; }
    const bytes = readRegularFile(target.resolved);
    if (typeof bytes === "string") { this.f.problem(where, `${field} "${relative}" ${bytes}.`); return; }
    if (declared !== null && sha256Of(bytes) !== declared) this.f.problem(where, `sha256 does not match ${relative} (found ${sha256Of(bytes)}).`);
  }

  private workspaceSource(where: string, entry: Obj): void {
    const relative = requireText(this.f, where, entry.workspace_path, "workspace_path");
    const declared = this.declaredHash(where, entry);
    if (relative === null) return;
    if (this.workspace === null) {
      // Containment can still be judged without a root: an absolute path or a .. escape is never valid.
      const refusal = lexicalRefusal(relative);
      if (refusal) { this.f.problem(where, `workspace_path "${relative}" ${refusal}.`); return; }
      this.unverified(where, "no workspace is available, so the workspace source was not verified.");
      return;
    }
    const target = resolveContained(this.workspace, relative);
    if (!target.ok) { this.f.problem(where, `workspace_path "${relative}" ${target.reason}.`); return; }
    if (!target.exists) { this.unverified(where, `workspace file "${relative}" was not found, so the workspace source was not verified.`); return; }
    const bytes = readRegularFile(target.resolved);
    if (typeof bytes === "string") { this.f.problem(where, `workspace_path "${relative}" ${bytes}.`); return; }
    if (declared !== null && sha256Of(bytes) !== declared) this.f.problem(where, `sha256 does not match the workspace file ${relative} (found ${sha256Of(bytes)}).`);
  }

  /** An unverified workspace source is a warning, but the ready gate needs every source verified. */
  private unverified(where: string, message: string): void {
    if (this.ready) this.f.problem(where, message);
    else this.f.warn(where, message);
  }

  private conceptChecks(): void {
    const seen = new Set<string>();
    this.list("concepts", this.data.concepts).forEach((entry, index) => {
      const where = this.entryLabel("concepts", entry, index);
      if (!isObj(entry)) { this.f.problem(where, "must be a mapping."); return; }
      this.id(where, entry.id, "concept", seen);
      requireText(this.f, where, entry.title, "title");
      requireEnum(this.f, where, entry.kind, "kind", CONCEPT_KINDS);
      requireText(this.f, where, entry.statement, "statement");
      const position = requireEnum(this.f, where, entry.position, "position", POSITIONS);

      const origins = this.list(`${where}.origins`, entry.origins, true);
      if (Array.isArray(entry.origins) && origins.length === 0) this.f.problem(where, "needs at least one origin.");
      origins.forEach((origin, originIndex) => {
        if (!isObj(origin)) { this.f.problem(where, `origins[${originIndex}] must be a mapping with source and locator.`); return; }
        if (typeof origin.source !== "string" || !this.sourceIds.has(origin.source)) this.f.problem(where, `origins[${originIndex}] names unknown source ${JSON.stringify(origin.source ?? null)}.`);
        requireText(this.f, `${where}.origins[${originIndex}]`, origin.locator, "locator");
      });

      if (entry.fit !== undefined) this.fit(where, entry.fit);
      if (entry.load_bearing !== undefined && typeof entry.load_bearing !== "boolean") this.f.problem(where, "load_bearing must be true or false.");
      if (entry.verification !== undefined) {
        if (!isObj(entry.verification) || text(entry.verification.status) === null) this.f.problem(where, "verification must be a mapping with a status.");
      }

      if (position === "rejected" && text(entry.reason) === null) this.f.problem(where, "a rejected concept needs a reason.");
      if (position === "parked" && text(entry.revival) === null) this.f.problem(where, "a parked concept needs a revival condition.");
      if (position === "merged") this.merge(where, entry);
      if (position === "chosen") {
        const serves = this.list(`${where}.serves`, entry.serves);
        if (serves.length === 0) this.f.problem(where, "a chosen concept needs serves: at least one requirement.");
        for (const ref of serves) {
          if (typeof ref !== "string" || !this.requirementIds.has(ref)) this.f.problem(where, `serves names unknown requirement ${JSON.stringify(ref)}.`);
        }
      }
    });
  }

  private fit(where: string, fit: unknown): void {
    if (!isObj(fit)) { this.f.problem(where, "fit must be a mapping with status and evidence."); return; }
    requireEnum(this.f, `${where}.fit`, fit.status, "status", FIT_STATUS);
    const evidence = typeof fit.evidence === "string" ? [fit.evidence] : this.list(`${where}.fit.evidence`, fit.evidence);
    for (const file of evidence) {
      if (text(file) === null) { this.f.problem(where, "fit.evidence entries must be non-blank paths."); continue; }
      if (this.projectRoot === null) continue;
      const target = resolveContained(this.projectRoot, String(file));
      if (!target.ok) this.f.problem(where, `fit.evidence "${String(file)}" ${target.reason}.`);
      else if (!target.exists) this.f.problem(where, `fit.evidence "${String(file)}" does not exist in the Project.`);
    }
  }

  private merge(where: string, entry: Obj): void {
    const target = text(entry.merged_into);
    if (target === null) { this.f.problem(where, "a merged concept needs merged_into."); return; }
    if (target === entry.id) { this.f.problem(where, "a concept cannot be merged into itself."); return; }
    const other = this.concepts.get(target);
    if (!other) { this.f.problem(where, `merged_into names unknown concept ${target}.`); return; }
    if (other.position === "merged") this.f.problem(where, `merged_into ${target} is itself merged; point at the final concept (no merge chains).`);
  }

  private choices(): void {
    const seen = new Set<string>();
    this.list("choices", this.data.choices).forEach((entry, index) => {
      const where = this.entryLabel("choices", entry, index);
      if (!isObj(entry)) { this.f.problem(where, "must be a mapping."); return; }
      this.id(where, entry.id, "choice", seen);
      requireText(this.f, where, entry.question, "question");
      const options = this.list(`${where}.options`, entry.options, true);
      if (Array.isArray(entry.options) && options.length === 0) this.f.problem(where, "needs at least one option.");
      options.forEach((option, optionIndex) => {
        if (!isObj(option)) { this.f.problem(where, `options[${optionIndex}] must be a mapping with concept and consequence.`); return; }
        if (typeof option.concept !== "string" || !this.conceptIds.has(option.concept)) this.f.problem(where, `options[${optionIndex}] names unknown concept ${JSON.stringify(option.concept ?? null)}.`);
        requireText(this.f, `${where}.options[${optionIndex}]`, option.consequence, "consequence");
      });
      if (entry.chosen !== undefined && entry.chosen !== null && (typeof entry.chosen !== "string" || !this.conceptIds.has(entry.chosen))) {
        this.f.problem(where, `chosen names unknown concept ${JSON.stringify(entry.chosen)}.`);
      }
      if (entry.decided_by !== undefined) requireEnum(this.f, where, entry.decided_by, "decided_by", DECIDERS);
    });
  }

  private assumption(): void {
    const risk = this.data.riskiest_assumption;
    if (risk === undefined || risk === null) return;
    if (!isObj(risk)) { this.f.problem("riskiest_assumption", "must be a mapping."); return; }
    requireText(this.f, "riskiest_assumption", risk.statement, "statement");
    requireText(this.f, "riskiest_assumption", risk.test, "test");
    requireEnum(this.f, "riskiest_assumption", risk.status, "status", ASSUMPTION_STATUS);
  }

  /** A report must be a regular file that states the record_hash it reviewed. */
  private reviewReport(where: string, relative: string, target: Contained & { ok: true }, hash: unknown): void {
    if (!target.exists) { this.f.problem(where, `review file "${relative}" does not exist.`); return; }
    const bytes = readRegularFile(target.resolved);
    if (typeof bytes === "string") { this.f.problem(where, `path "${relative}" ${bytes}.`); return; }
    if (typeof hash === "string" && SHA256.test(hash) && !bytes.toString("utf8").includes(hash)) this.f.problem(where, `review file "${relative}" does not contain its record_hash.`);
  }

  private reviewList(): Array<Obj> {
    return items(this.data.scrutiny).filter(isObj);
  }

  private scrutiny(): void {
    const seen = new Set<string>();
    const seenFinding = new Set<string>();
    this.list("scrutiny", this.data.scrutiny).forEach((entry, index) => {
      const where = this.entryLabel("scrutiny", entry, index);
      if (!isObj(entry)) { this.f.problem(where, "must be a mapping."); return; }
      this.id(where, entry.id, "review", seen);
      const relative = requireText(this.f, where, entry.path, "path");
      if (relative !== null) {
        const target = resolveContained(this.recordDir, relative);
        if (!target.ok) this.f.problem(where, `path "${relative}" ${target.reason}.`);
        else if (this.ready) this.reviewReport(where, relative, target, entry.record_hash);
      }
      requireText(this.f, where, entry.reviewer, "reviewer");
      if (typeof entry.independent_of_authors !== "boolean") this.f.problem(where, "independent_of_authors is required and must be true or false.");
      const lenses = this.list(`${where}.lenses`, entry.lenses, true);
      if (Array.isArray(entry.lenses) && lenses.length === 0) this.f.problem(where, "needs at least one lens.");
      for (const lens of lenses) if (!oneOf(lens, LENSES)) this.f.problem(where, `lens ${JSON.stringify(lens)} must be one of ${LENSES.join(", ")}.`);
      if (typeof entry.record_hash !== "string" || !SHA256.test(entry.record_hash)) this.f.problem(where, "record_hash must be 64 lowercase hex characters.");
      requireEnum(this.f, where, entry.verdict, "verdict", VERDICTS);
      this.list(`${where}.findings`, entry.findings).forEach((finding, findingIndex) => {
        const label = `${where}.findings[${isObj(finding) && text(finding.id) ? String(finding.id) : findingIndex}]`;
        if (!isObj(finding)) { this.f.problem(label, "must be a mapping."); return; }
        const id = requireText(this.f, label, finding.id, "id");
        if (id !== null) {
          if (seenFinding.has(id)) this.f.problem(label, `duplicate finding id ${id}.`);
          seenFinding.add(id);
        }
        requireEnum(this.f, label, finding.severity, "severity", SEVERITY);
        requireText(this.f, label, finding.summary, "summary");
        requireEnum(this.f, label, finding.disposition, "disposition", DISPOSITION);
        if (finding.concepts !== undefined) {
          for (const ref of this.list(`${label}.concepts`, finding.concepts)) {
            if (typeof ref !== "string" || !this.conceptIds.has(ref)) this.f.problem(label, `concepts names unknown concept ${JSON.stringify(ref)}.`);
          }
        }
      });
    });

    const hashes = new Set(this.reviewList().map((review) => review.record_hash).filter((value): value is string => typeof value === "string"));
    if (hashes.size > 3) this.f.warn("scrutiny", `${hashes.size} reviews are of different record hashes; after three rounds put the disagreement to the operator.`);
  }

  private readyGate(): void {
    const frame = isObj(this.data.frame) ? this.data.frame : {};
    if (frame.status !== "confirmed") this.f.problem("ready", "frame.status must be confirmed.");
    else if (text(frame.confirmed_ref) === null) this.f.problem("ready", "a confirmed frame needs confirmed_ref.");

    const requirements = items(frame.requirements).filter(isObj);
    if (requirements.length === 0) this.f.problem("ready", "there must be at least one requirement.");
    const served = new Set<string>();
    for (const concept of this.concepts.values()) {
      if (concept.position === "chosen") for (const ref of items(concept.serves)) if (typeof ref === "string") served.add(ref);
    }
    for (const requirement of requirements) {
      const label = `ready: ${text(requirement.id) ?? "requirement"}`;
      if (items(requirement.mission).length === 0) this.f.problem(label, "a requirement must cite at least one mission entry.");
      if (text(requirement.proof) === null) this.f.problem(label, "a requirement needs a proof.");
      if (typeof requirement.id !== "string" || !served.has(requirement.id)) this.f.problem(label, "no chosen concept serves this requirement.");
    }

    for (const [id, concept] of this.concepts) {
      if (oneOf(concept.position, UNSETTLED)) this.f.problem(`ready: ${id}`, `concept is still ${String(concept.position)}.`);
    }

    this.authorityReferences(frame);
    this.readyChoices();
    this.readyLoadBearing();

    const risk = isObj(this.data.riskiest_assumption) ? this.data.riskiest_assumption : null;
    if (risk === null) this.f.problem("ready", "riskiest_assumption is missing.");
    else if (risk.status === "supported") {
      if (text(risk.evidence) === null) this.f.problem("ready: riskiest_assumption", "a supported assumption needs evidence.");
    } else if (risk.status === "accepted_risk") {
      if (text(risk.decision_ref) === null) this.f.problem("ready: riskiest_assumption", "an accepted_risk assumption needs decision_ref.");
    } else {
      this.f.problem("ready: riskiest_assumption", `status is ${JSON.stringify(risk.status ?? null)}; it must be supported with evidence or accepted_risk with decision_ref.`);
    }

    this.readyReviews();
  }

  private readyChoices(): void {
    for (const choice of items(this.data.choices).filter(isObj)) {
      const label = `ready: ${text(choice.id) ?? "choice"}`;
      const options = items(choice.options).filter(isObj).map((option) => option.concept).filter((id): id is string => typeof id === "string");
      const chosen = typeof choice.chosen === "string" ? choice.chosen : null;
      if (chosen === null) this.f.problem(label, "the choice has no chosen option.");
      else {
        if (!options.includes(chosen)) this.f.problem(label, `chosen ${chosen} is not among the options.`);
        if (this.concepts.get(chosen)?.position !== "chosen") this.f.problem(label, `chosen ${chosen} is not a chosen concept.`);
      }
      for (const option of options) {
        if (option === chosen) continue;
        const position = this.concepts.get(option)?.position;
        if (!oneOf(position, SETTLED_OPTION)) this.f.problem(label, `unchosen option ${option} is ${String(position ?? "unknown")}; it must be rejected, parked or merged.`);
      }
      if (choice.decided_by === "operator") {
        if (text(choice.decision_ref) === null) this.f.problem(label, "an operator choice needs decision_ref.");
      } else if (choice.decided_by === "agent") {
        if (text(choice.reason) === null) this.f.problem(label, "an agent choice needs a reason.");
      } else this.f.problem(label, "decided_by must be operator or agent.");
    }
  }

  private readyLoadBearing(): void {
    // An accepted risk counts only from a review that is independent, by a non-author, and not on hold.
    const authors = this.authorNames();
    const accepted = this.reviewList().filter((review) => this.reviewIssues(review, authors).length === 0)
      .flatMap((review) => items(review.findings).filter(isObj))
      .filter((finding) => finding.severity === "blocking" && finding.disposition === "accepted_risk");
    for (const [id, concept] of this.concepts) {
      if (concept.position !== "chosen") continue;
      const label = `ready: ${id}`;
      if (isObj(concept.fit) && concept.fit.status === "conflicts") {
        const covered = items(this.data.choices).filter(isObj).some((choice) => choice.decided_by === "operator" && choice.chosen === id);
        if (!covered) this.f.problem(label, "fit is conflicts, so an operator choice must cover this concept.");
      }
      if (concept.load_bearing === true) {
        const verification = isObj(concept.verification) ? concept.verification : null;
        const verified = verification?.status === "verified" && text(Array.isArray(verification.evidence) ? verification.evidence.join("") : verification.evidence) !== null;
        const covered = accepted.some((finding) => items(finding.concepts).includes(id));
        if (!verified && !covered) this.f.problem(label, "a load-bearing concept must be verified with evidence or covered by an accepted_risk blocking finding that lists it in concepts.");
      }
    }
  }

  /** Every confirmed_ref and decision_ref must be an approved Decision or an operator's own words kept in the repo. */
  private authorityReferences(frame: Obj): void {
    const refs: Array<[string, unknown]> = [];
    if (frame.status === "confirmed") refs.push(["confirmed_ref", frame.confirmed_ref]);
    for (const choice of items(this.data.choices).filter(isObj)) refs.push([`choices[${text(choice.id) ?? "?"}].decision_ref`, choice.decision_ref]);
    if (isObj(this.data.riskiest_assumption)) refs.push(["riskiest_assumption.decision_ref", this.data.riskiest_assumption.decision_ref]);
    for (const review of this.reviewList()) {
      for (const finding of items(review.findings).filter(isObj)) refs.push([`${text(review.id) ?? "review"}/${text(finding.id) ?? "finding"}.decision_ref`, finding.decision_ref]);
    }
    for (const [where, value] of refs) {
      const ref = text(value);
      if (ref === null) continue; // a missing reference is reported by the check that requires it
      const reason = this.authorityProblem(ref.trim());
      if (reason) this.f.problem(`ready: ${where}`, `"${ref}" ${reason}`);
    }
  }

  /** Null when the reference resolves; otherwise why it does not. */
  private authorityProblem(ref: string): string | null {
    const decision = /^Decision (\d{4})$/.exec(ref);
    if (decision) return this.decisionProblem(decision[1]);
    if (ID_FORMS.source.test(ref)) {
      const source = this.sourceEntries.get(ref);
      if (!source) return "names an unknown source.";
      return source.kind === "operator" && source.retention === "repo" ? null : "is a source that is not kind operator with retention repo.";
    }
    return 'must be "Decision NNNN" or an operator source S### (kind operator, retention repo).';
  }

  private decisionProblem(number: string): string | null {
    if (this.projectRoot === null) return "cannot be resolved without a project root.";
    let names: string[];
    try {
      names = readdirSync(path.join(this.projectRoot, "docs", "decisions")).filter((name) => name.startsWith(`${number}-`) && name.endsWith(".md"));
    } catch {
      return "cannot be resolved: docs/decisions is not readable.";
    }
    if (names.length === 0) return `does not resolve: no docs/decisions/${number}-*.md.`;
    if (names.length > 1) return `is ambiguous: ${names.join(", ")}.`;
    const target = resolveContained(this.projectRoot, `docs/decisions/${names[0]}`);
    if (!target.ok) return `file ${names[0]} ${target.reason}.`;
    const bytes = readRegularFile(target.resolved);
    if (typeof bytes === "string") return `file ${names[0]} ${bytes}.`;
    const status = frontmatterStatus(bytes.toString("utf8"));
    return status === "approved" ? null : `is not approved: status is ${JSON.stringify(status)}.`;
  }

  private authorNames(): Set<string> {
    return new Set(items(this.data.authors).filter((a): a is string => typeof a === "string").map(normalizeName).filter(Boolean));
  }

  /** Why a review cannot be relied on, whatever record it is of; empty when it can. */
  private reviewIssues(review: Obj, authors: Set<string>): string[] {
    const issues: string[] = [];
    if (review.independent_of_authors !== true) issues.push("independent_of_authors is not true.");
    if (typeof review.reviewer === "string" && authors.has(normalizeName(review.reviewer))) issues.push(`reviewer "${review.reviewer}" is one of the authors.`);
    if (review.verdict === "hold" || review.verdict === "incomplete") issues.push(`verdict is ${String(review.verdict)} on the current record.`);
    return issues;
  }

  private readyReviews(): void {
    const authors = this.authorNames();
    const covered = new Set<string>();
    for (const review of this.reviewList()) {
      const label = `ready: ${text(review.id) ?? "review"}`;
      if (review.record_hash !== this.hash) {
        this.f.warn(label, "is of an earlier record hash, so it is stale and does not count.");
        continue;
      }
      const issues = this.reviewIssues(review, authors);
      for (const issue of issues) this.f.problem(label, issue);
      if (issues.length === 0) for (const lens of items(review.lenses)) if (typeof lens === "string") covered.add(lens);
    }
    for (const lens of LENSES) {
      if (!covered.has(lens)) this.f.problem("ready", `no current independent review covers the ${lens} lens (current record_hash ${this.hash}).`);
    }

    // Across every review, stale ones included.
    for (const review of this.reviewList()) {
      for (const finding of items(review.findings).filter(isObj)) {
        if (finding.severity !== "blocking") continue;
        const label = `ready: ${text(review.id) ?? "review"}/${text(finding.id) ?? "finding"}`;
        if (finding.disposition === "open" || finding.disposition === "declined") this.f.problem(label, `blocking finding is ${String(finding.disposition)}.`);
        if (finding.disposition === "accepted_risk" && text(finding.decision_ref) === null) this.f.problem(label, "an accepted_risk finding needs decision_ref.");
      }
    }
  }
}

/** The derived view of the record; computed on demand from whatever structure is readable, never stored. */
export function buildMatrix(data: Obj): DesignMatrix {
  const concepts = items(data.concepts).filter(isObj).filter((concept) => text(concept.id) !== null);
  const byId = new Map(concepts.map((concept) => [String(concept.id), concept]));
  const title = (id: string): string => text(byId.get(id)?.title) ?? "";
  const sourceTitles = new Map(items(data.sources).filter(isObj).map((source) => [String(source.id), text(source.title) ?? ""]));
  const originsOf = (concept: Obj): Array<{ source: string; locator: string }> =>
    items(concept.origins).filter(isObj).map((origin) => ({ source: String(origin.source ?? ""), locator: String(origin.locator ?? "") }));
  const sourcesOf = (concept: Obj): string[] => [...new Set(originsOf(concept).map((origin) => origin.source))].sort();

  const shared = concepts.filter((concept) => sourcesOf(concept).length >= 2)
    .map((concept) => ({ concept: String(concept.id), title: title(String(concept.id)), sources: sourcesOf(concept) }));

  const single = new Map<string, Array<{ concept: string; title: string }>>();
  for (const concept of concepts) {
    const sources = sourcesOf(concept);
    if (sources.length !== 1) continue;
    single.set(sources[0], [...(single.get(sources[0]) ?? []), { concept: String(concept.id), title: title(String(concept.id)) }]);
  }
  const differentiated = [...single.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([source, list]) => ({ source, title: sourceTitles.get(source) ?? "", concepts: list }));

  const choices = items(data.choices).filter(isObj).map((choice) => {
    const options = items(choice.options).filter(isObj).map((option) => {
      const concept = String(option.concept ?? "");
      return { concept, title: title(concept), position: String(byId.get(concept)?.position ?? "unknown"), consequence: text(option.consequence) ?? "" };
    });
    const chosen = typeof choice.chosen === "string" && options.some((option) => option.concept === choice.chosen) ? choice.chosen : null;
    return {
      choice: String(choice.id ?? ""), question: text(choice.question) ?? "", status: chosen ? "chosen" as const : "open" as const,
      chosen, decidedBy: typeof choice.decided_by === "string" ? choice.decided_by : null, options
    };
  });

  const frame = isObj(data.frame) ? data.frame : {};
  const trace = items(frame.requirements).filter(isObj).map((requirement) => {
    const id = String(requirement.id ?? "");
    return {
      requirement: id, statement: text(requirement.statement) ?? "",
      mission: items(requirement.mission).filter((ref): ref is string => typeof ref === "string"),
      concepts: concepts.filter((concept) => concept.position === "chosen" && items(concept.serves).includes(id))
        .map((concept) => ({ concept: String(concept.id), title: title(String(concept.id)), origins: originsOf(concept) }))
    };
  });

  const cutOrLater = concepts.filter((concept) => concept.position === "rejected" || concept.position === "parked")
    .map((concept) => ({
      concept: String(concept.id), title: title(String(concept.id)), position: String(concept.position),
      reason: text(concept.reason), revival: text(concept.revival)
    }));

  return { shared, differentiated, choices, trace, cutOrLater };
}

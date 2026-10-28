import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { validationError } from "../cli/errors.js";

export const GUIDANCE_INDEX = "docs/agent-guidance/index.json";
/** Full sha256 fingerprints for the index entries, kept beside it so agents read only triggers and paths. */
export const GUIDANCE_FINGERPRINTS = "docs/agent-guidance/fingerprints.json";
const GUIDANCE_SCHEMA = "arcadia-agent-guidance-v1";
export const BOOTSTRAP_MARKER = "<!-- arcadia-bootstrap-v1 -->";
export const INSTRUCTION_BUDGET = { bootstrap: 8 * 1024, root: 12 * 1024, project: 24 * 1024, combined: 32 * 1024 };
const ESSENTIAL_RULES = ["Authority", "Governance", "Preservation", "Identity", "Handoff", "Operator steps", "Review", "Economy and truth", "Vocabulary"];

export interface GuidanceEntry { id: string; trigger: string; path: string; read_before: string; sha256: string }
export interface GuidanceResource { path: string; content: string }
export interface InstructionSource { path: string; bytes: number; sha256: string }
export interface GuidanceDelivery {
  sources: InstructionSource[];
  projectBytes: number;
  combinedBytes: number;
  problems: string[];
}

/**
 * Parse and validate the guidance index. The compact layout keeps each entry's
 * 64-hex fingerprint in GUIDANCE_FINGERPRINTS (exactly one per id, none extra);
 * a legacy adopter index carries them inline and must not also have the
 * sibling file. Either way every returned entry has its full fingerprint.
 */
export function guidanceEntries(text: string, fingerprintsText: string | null = null): GuidanceEntry[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw validationError(`Invalid ${GUIDANCE_INDEX}: expected valid JSON.`); }
  if (!parsed || typeof parsed !== "object" || !("schema" in parsed) || parsed.schema !== GUIDANCE_SCHEMA ||
      !("entries" in parsed) || !Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    throw validationError(`Invalid ${GUIDANCE_INDEX}: expected ${GUIDANCE_SCHEMA} entries.`);
  }
  const records = parsed.entries.map((value: unknown) => {
    if (!value || typeof value !== "object") throw validationError(`Invalid entry in ${GUIDANCE_INDEX}.`);
    return value as Record<string, unknown>;
  });
  const inline = records.filter((entry) => "sha256" in entry).length;
  if (inline !== 0 && inline !== records.length) throw validationError(`Invalid ${GUIDANCE_INDEX}: every entry or none may carry an inline sha256.`);
  if (inline && fingerprintsText !== null) throw validationError(`Ambiguous guidance fingerprints: ${GUIDANCE_INDEX} carries inline sha256 and ${GUIDANCE_FINGERPRINTS} exists. Keep one source.`);
  let fingerprints: Record<string, unknown> | null = null;
  if (!inline) {
    if (fingerprintsText === null) throw validationError(`Missing mandatory guidance: ${GUIDANCE_FINGERPRINTS}. Its fingerprints verify every ${GUIDANCE_INDEX} entry.`);
    let value: unknown;
    try { value = JSON.parse(fingerprintsText); }
    catch { throw validationError(`Invalid ${GUIDANCE_FINGERPRINTS}: expected valid JSON.`); }
    if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== GUIDANCE_SCHEMA ||
        !("fingerprints" in value) || !value.fingerprints || typeof value.fingerprints !== "object" || Array.isArray(value.fingerprints)) {
      throw validationError(`Invalid ${GUIDANCE_FINGERPRINTS}: expected ${GUIDANCE_SCHEMA} fingerprints.`);
    }
    fingerprints = value.fingerprints as Record<string, unknown>;
  }
  const ids = new Set<string>();
  const entries = records.map((entry) => {
    for (const key of ["id", "trigger", "path", "read_before"]) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) throw validationError(`Invalid guidance entry ${key}.`);
    }
    const id = entry.id as string;
    const sha256 = fingerprints ? (Object.hasOwn(fingerprints, id) ? fingerprints[id] : undefined) : entry.sha256;
    if (typeof sha256 !== "string" || !sha256.trim()) throw validationError(`Invalid guidance entry sha256${fingerprints ? ` for ${id} in ${GUIDANCE_FINGERPRINTS}` : ""}.`);
    const item = { ...entry, sha256 } as unknown as GuidanceEntry;
    if (!/^docs\/[a-zA-Z0-9/_-]+\.md$/.test(item.path) || ids.has(item.id) || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw validationError(`Unsafe reference or duplicate id in ${GUIDANCE_INDEX}: ${item.id}.`);
    }
    ids.add(item.id);
    return item;
  });
  const orphaned = fingerprints ? Object.keys(fingerprints).filter((id) => !ids.has(id)) : [];
  if (orphaned.length) throw validationError(`Invalid ${GUIDANCE_FINGERPRINTS}: fingerprints without an index entry: ${orphaned.join(", ")}.`);
  for (const id of ["continuation", "agent-asks", "operator-actions", "proposals", "principles", "pull-requests", "learning", "git-identity", "managed-documents", "planning", "working-copy"]) {
    if (!ids.has(id)) throw validationError(`Missing mandatory guidance trigger: ${id}.`);
  }
  return entries;
}

/** The single loader: read the index and, when present, its sibling fingerprints through one reader. */
export function loadGuidanceEntries(readSource: (file: string) => string | null): GuidanceEntry[] {
  const index = readSource(GUIDANCE_INDEX);
  if (!index?.trim()) throw validationError(`Missing mandatory guidance: ${GUIDANCE_INDEX}.`);
  return guidanceEntries(index, readSource(GUIDANCE_FINGERPRINTS));
}

/** Compact index layout: one entry per line, no fingerprints. */
export function renderGuidanceIndex(index: { entries: unknown[] } & Record<string, unknown>): string {
  const { entries, ...rest } = index;
  const fields = Object.entries(rest).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replace(/\n/g, "\n  ")}`);
  fields.push(`  "entries": [\n${entries.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n")}\n  ]`);
  return `{\n${fields.join(",\n")}\n}\n`;
}

export function renderGuidanceFingerprints(fingerprints: Record<string, string>): string {
  return `${JSON.stringify({ schema: GUIDANCE_SCHEMA, fingerprints }, null, 2)}\n`;
}

/** Canonical resources are read before setup writes, never invented as a fallback. */
export function guidanceResources(readSource: (file: string) => string | null): GuidanceResource[] {
  const requireSource = (file: string): string => {
    const content = readSource(file);
    if (!content?.trim()) throw validationError(`Missing mandatory agent guidance: ${file}. Repair Arcadia's source before adoption.`);
    return content;
  };
  requireSource("CONSTITUTION.md");
  requireSource("docs/agent-continuation-protocol.md");
  const index = requireSource(GUIDANCE_INDEX);
  const fingerprints = readSource(GUIDANCE_FINGERPRINTS);
  const entries = guidanceEntries(index, fingerprints);
  for (const entry of entries) {
    if (guidanceFingerprint(requireSource(entry.path)) !== entry.sha256) throw validationError(`Canonical guidance fingerprint is stale: ${entry.path}. Refresh ${fingerprints === null ? GUIDANCE_INDEX : GUIDANCE_FINGERPRINTS} with the reviewed procedure bytes.`);
  }
  const fixed = new Map<string, string>([[GUIDANCE_INDEX, index], ...(fingerprints === null ? [] : [[GUIDANCE_FINGERPRINTS, fingerprints] as [string, string]])]);
  return [...new Set([...fixed.keys(), ...entries.map((entry) => entry.path)])]
    .map((file) => ({ path: file, content: fixed.get(file) ?? requireSource(file) }));
}

export function guidanceFingerprint(text: string): string {
  const body = /<!-- ARCADIA_CONTEXT_START -->\n([\s\S]*?)\n<!-- ARCADIA_CONTEXT_END -->/.exec(text)?.[1] ?? text;
  return createHash("sha256").update(body.trim()).digest("hex");
}

/** Validate planned writes without following an adopter symlink outside its checkout. */
export function assertGuidanceTarget(repoRoot: string, relativePath: string): void {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) throw validationError(`Guidance target escapes repository: ${relativePath}.`);
  let existing = target;
  for (;;) {
    try { lstatSync(existing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      existing = path.dirname(existing);
    }
  }
  let realTarget: string;
  try { realTarget = realpathSync(existing); }
  catch { throw validationError(`Guidance target cannot be resolved safely: ${relativePath}.`); }
  const realRoot = realpathSync(root);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) throw validationError(`Guidance target escapes repository: ${relativePath}.`);
}

export function assertBootstrapBudget(text: string): void {
  const bytes = Buffer.byteLength(text);
  if (bytes > INSTRUCTION_BUDGET.bootstrap) throw validationError(`Agent bootstrap exceeds ${INSTRUCTION_BUDGET.bootstrap} UTF-8 bytes (${bytes}). Extract procedures; do not raise the provider cap.`);
}

/** Default filename precedence only; custom provider profiles must supply their actual loaded sources separately. */
export function inspectGuidanceDelivery(repoRoot: string, options: {
  cwd?: string;
  agent?: "codex" | "claude" | "opencode";
  globalInstructions?: string;
  globalPath?: string;
  globalDirectory?: string;
  rootInstructions?: string;
} = {}): GuidanceDelivery {
  const root = path.resolve(repoRoot);
  const cwd = path.resolve(options.cwd ?? root);
  if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) throw validationError("Instruction working directory is outside the repository.");
  const agent = options.agent ?? "codex";
  const sources: InstructionSource[] = [];
  const problems: string[] = [];
  const read = (file: string): string | null => {
    if (!existsSync(file)) return null;
    try { return readFileSync(file, "utf8"); } catch { problems.push(`Unreadable instruction file: ${file}`); return null; }
  };
  const first = (dir: string, names: string[]): { file: string; text: string } | null => {
    for (const name of names) { const file = path.join(dir, name); const text = read(file); if (text?.trim()) return { file, text }; }
    return null;
  };
  const record = (file: string, text: string): void => {
    sources.push({ path: file, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") });
  };
  const home = options.globalDirectory ?? (agent === "codex"
    ? (process.env.CODEX_HOME || path.join(os.homedir(), ".codex"))
    : agent === "opencode" ? path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode") : path.join(os.homedir(), ".claude"));
  const opencodeGlobal = agent === "opencode" && options.globalInstructions === undefined ? first(home, ["AGENTS.md"]) ??
    ((!process.env.OPENCODE_DISABLE_CLAUDE_CODE && !process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT)
      ? first(path.join(os.homedir(), ".claude"), ["CLAUDE.md"]) : null) : null;
  const global = options.globalInstructions !== undefined
    ? { file: options.globalPath ?? "(supplied global guidance)", text: options.globalInstructions }
    : agent === "opencode" ? opencodeGlobal : first(home, agent === "codex" ? ["AGENTS.override.md", "AGENTS.md"] : ["CLAUDE.md"]);
  if (global?.text.trim()) record(global.file, global.text);
  const checkImports = (text: string, file: string): void => {
    const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    for (const imported of prose.matchAll(/(?:^|\s)@([^\s]+)/g)) {
      if (imported[1] !== "AGENTS.md") problems.push(`Unsupported automatic import in ${file}: ${imported[1]}. Supply effective-load evidence or keep procedures behind the index.`);
    }
  };
  if (global && agent === "claude") checkImports(global.text, global.file);
  if (agent === "claude" && options.globalInstructions === undefined && existsSync(path.join(home, "rules"))) {
    problems.push(`Additional Claude global rules require effective-load evidence: ${path.join(home, "rules")}.`);
  }
  const globalCount = sources.length;
  const dirs = [root];
  let dir = root;
  for (const segment of path.relative(root, cwd).split(path.sep).filter(Boolean)) { dir = path.join(dir, segment); dirs.push(dir); }
  let rootText = "";
  for (const [index, directory] of dirs.entries()) {
    const rootOverride = index === 0 && agent === "codex" ? first(directory, ["AGENTS.override.md"]) : null;
    const selected = rootOverride ?? (index === 0 && options.rootInstructions !== undefined
      ? { file: path.join(root, "AGENTS.md"), text: options.rootInstructions }
      : first(directory, agent === "codex" ? ["AGENTS.override.md", "AGENTS.md"] : ["AGENTS.md"]));
    if (selected) {
      record(selected.file, selected.text);
      if (index === 0) rootText = selected.text;
    }
    if (agent === "claude") {
      for (const additional of ["CLAUDE.local.md", ".claude/CLAUDE.md", ".claude/rules"]) {
        if (existsSync(path.join(directory, additional))) problems.push(`Additional Claude memory layout requires effective-load evidence: ${path.join(directory, additional)}. The compact-wrapper audit cannot silently omit it.`);
      }
      const wrapper = read(path.join(directory, "CLAUDE.md"));
      if (wrapper?.trim()) { record(path.join(directory, "CLAUDE.md"), wrapper); checkImports(wrapper, path.join(directory, "CLAUDE.md")); }
      if (index === 0 && !wrapper?.includes("@AGENTS.md")) problems.push("CLAUDE.md does not import the mandatory AGENTS.md bootstrap.");
    }
  }
  const projectSources = sources.slice(globalCount);
  const bytesWithJoins = (items: InstructionSource[]): number => items.reduce((sum, item) => sum + item.bytes, 0) + Math.max(0, items.length - 1) * 2;
  const projectBytes = bytesWithJoins(projectSources);
  const combinedBytes = bytesWithJoins(sources);
  if (Buffer.byteLength(rootText) > INSTRUCTION_BUDGET.root) problems.push(`Root instructions exceed ${INSTRUCTION_BUDGET.root} bytes.`);
  if (projectBytes > INSTRUCTION_BUDGET.project) problems.push(`Project instructions exceed ${INSTRUCTION_BUDGET.project} bytes (${projectBytes}).`);
  if (combinedBytes > INSTRUCTION_BUDGET.combined) problems.push(`Combined guidance exceeds the supported ${INSTRUCTION_BUDGET.combined}-byte envelope (${combinedBytes}); mandatory guidance may be truncated.`);
  if (!rootText.includes(BOOTSTRAP_MARKER)) problems.push("Selected root instructions omit the mandatory Way bootstrap (check AGENTS.override.md precedence).");
  const visible = Buffer.from(rootText).subarray(0, INSTRUCTION_BUDGET.root).toString("utf8");
  for (const rule of ESSENTIAL_RULES) if (!visible.includes(`**${rule}:**`)) problems.push(`Missing mandatory bootstrap rule: ${rule}.`);
  for (const reference of [GUIDANCE_INDEX, "docs/notes-to-self.md", "CONSTITUTION.md", "PROJECT.md"]) {
    if (!visible.includes(reference)) problems.push(`Missing mandatory retrieval reference: ${reference}.`);
  }
  for (const match of visible.matchAll(/`(docs\/agent-guidance\/[a-z-]+\.md)`/g)) {
    if (!read(path.join(root, match[1]))?.trim()) problems.push(`Missing mandatory guidance: ${match[1]}.`);
  }
  if (!read(path.join(root, "CONSTITUTION.md"))?.trim()) problems.push("Missing mandatory guidance: CONSTITUTION.md.");
  try {
    const indexPath = path.join(root, GUIDANCE_INDEX);
    const index = read(indexPath);
    if (!index) problems.push(`Missing mandatory guidance: ${GUIDANCE_INDEX}. Run setup-context through the authorized adoption path.`);
    else for (const entry of guidanceEntries(index, read(path.join(root, GUIDANCE_FINGERPRINTS)))) {
      const target = path.join(root, entry.path);
      const content = read(target);
      if (!content?.trim()) problems.push(`Missing mandatory guidance: ${entry.path}.`);
      else if (guidanceFingerprint(content) !== entry.sha256) problems.push(`Stale mandatory guidance: ${entry.path}. Refresh adoption before its operation.`);
      else if (!realpathSync(target).startsWith(`${realpathSync(root)}${path.sep}`)) problems.push(`Guidance reference escapes repository: ${entry.path}.`);
    }
  } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  return { sources, projectBytes, combinedBytes, problems };
}

export function hasWayGuidance(repoRoot: string): boolean {
  if (existsSync(path.join(repoRoot, GUIDANCE_INDEX))) return true;
  for (const name of ["AGENTS.md", "AGENTS.override.md"]) {
    const file = path.join(repoRoot, name);
    if (!existsSync(file)) continue;
    try { if (readFileSync(file, "utf8").includes("<!-- ARCADIA_CONTEXT_START -->")) return true; }
    catch { return true; } // Inspect reports the unreadable file with a named remedy.
  }
  return false;
}

/** Existing briefs carry the protocol and evidence, rather than loading the whole manual. */
export function renderGuidanceRetrieval(repoRoot: string, agent: "codex" | "claude" | "opencode" | undefined = undefined, operation = ""): string[] {
  if (!hasWayGuidance(repoRoot)) return [];
  const delivery = inspectGuidanceDelivery(repoRoot, { agent: agent ?? "codex", ...(agent ? {} : { globalInstructions: "" }) });
  if (delivery.problems.length) throw validationError(`Agent guidance delivery refused: ${delivery.problems.join(" ")}`, { delivery });
  const entries = loadGuidanceEntries((file) => existsSync(path.join(repoRoot, file)) ? readFileSync(path.join(repoRoot, file), "utf8") : null);
  const relevant = entries.filter((entry) => ["continuation", "learning", "working-copy"].includes(entry.id) ||
    entry.trigger.split(",").some((trigger) => {
      const phrase = trigger.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return phrase.length > 0 && new RegExp(`(?:^|\\W)${phrase}(?=$|\\W)`, "i").test(operation);
    }));
  return [
    "", "Mandatory guidance retrieval before the next operation:",
    `Read ${GUIDANCE_INDEX}; match the task/failure trigger and read its authoritative procedure before acting.`,
    ...relevant.map((entry) => `  Read ${entry.path}: ${entry.read_before}`),
    "First search docs/notes-to-self.md with targeted rg for this Action's commands, subsystem and symptoms; read matching evidence.",
    "Capture useful discovery with `arcadia learn \"<exact text>\" --scope project:<slug>`; bare capture is observation/high, and uncertainty uses `--provenance inference --confidence low --evidence \"<source>\"`. It is zero-model evidence, not authority: no Action, Decision, promotion or rollout. Exact replay records supplied evidence/observations (otherwise a receipt); similar wording remains separate.",
    "Record retrieved paths/sections and failed receipts. Before a commit/comment, read the indexed Git identity procedure and resolve the current model's identity.",
    `Default instruction delivery (${agent ?? "repository only; provider global guidance not selected"}): project ${delivery.projectBytes}/${INSTRUCTION_BUDGET.project} bytes; combined ${delivery.combinedBytes}/${INSTRUCTION_BUDGET.combined} bytes.`,
    ...delivery.sources.map((source) => `  ${source.path}: ${source.bytes} bytes, sha256 ${source.sha256}`),
    "These are default-discovery file receipts, not proof of a provider's effective prompt or agent understanding. Verify actual loaded guidance/retrieval in the provider session trace; custom profiles/overrides need their own evidence."
  ];
}

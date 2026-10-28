import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Plan summaries: derived, plain-language reading aids kept in a generated namespace (Decision 0004). They never
 * govern and are never read as intent; this module only fingerprints Plan sources and reports which summaries are
 * missing or were written before their source changed. The contract is docs/generated/plan-summaries/README.md.
 */
export const PLAN_SUMMARY_SCHEMA = "arcadia-plan-summary-v1";
export const PLAN_SUMMARY_DIR = "docs/generated/plan-summaries";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface PlanSource {
  slug: string;
  relativePath: string;
  status: string | null;
  milestone: string | null;
  body: string;
  actions: Array<Record<string, unknown> & { id: string }>;
}

export interface ActionSummary { id: string; source_fingerprint: string; title: string; why: string; done_when: string; note?: string }
export interface PlanSummary {
  schema: typeof PLAN_SUMMARY_SCHEMA;
  generated: true;
  plan: string;
  source: string;
  source_fingerprint: string;
  written: string;
  author: string;
  title: string;
  purpose: string;
  serves: string;
  done_when: string;
  reading_note?: string;
  actions: ActionSummary[];
}

/** Compact JSON with keys sorted at every level, matching the README's fingerprint definition. */
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const fingerprint = (value: unknown) => sha(canonical(value)).slice(0, 16);

export function actionFingerprint(action: Record<string, unknown>): string {
  const pick = (key: string) => (action[key] === undefined ? null : action[key]);
  return fingerprint({ id: pick("id"), title: pick("title"), acceptance_criteria: pick("acceptance_criteria"), why: pick("why"), depends_on: pick("depends_on") });
}
export function planFingerprint(plan: PlanSource): string {
  return fingerprint({ slug: plan.slug, milestone: plan.milestone, actions: plan.actions.map(a => a.id), body: sha(plan.body) });
}

/** A Plan's source as the summary contract sees it, or null when the file is not a parseable `type: plan` record. */
export function readPlanSource(relativePath: string, content: string): PlanSource | null {
  const match = FRONTMATTER.exec(content);
  if (!match) return null;
  let data: unknown;
  try { data = parseYaml(match[1]); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const fm = data as Record<string, unknown>;
  if (fm.type !== "plan" || typeof fm.slug !== "string") return null;
  const actions = (Array.isArray(fm.actions) ? fm.actions : [])
    .filter((a): a is Record<string, unknown> & { id: string } => Boolean(a) && typeof a === "object" && typeof (a as { id?: unknown }).id === "string");
  return {
    slug: fm.slug,
    relativePath,
    status: typeof fm.status === "string" ? fm.status : null,
    milestone: typeof fm.milestone === "string" ? fm.milestone : null,
    body: match[2] ?? "",
    actions
  };
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
/** Only a file with the summary shape is used; anything else is reported invalid rather than half-shown. */
export function isPlanSummary(value: unknown): value is PlanSummary {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<PlanSummary>;
  return s.schema === PLAN_SUMMARY_SCHEMA && isText(s.plan) && isText(s.source_fingerprint) && isText(s.title) && isText(s.purpose)
    && isText(s.done_when) && Array.isArray(s.actions)
    && s.actions.every(a => a && isText(a.id) && isText(a.source_fingerprint) && isText(a.title) && isText(a.why) && isText(a.done_when));
}

export type SummaryState = "fresh" | "stale" | "missing" | "invalid";
export interface ActionSummaryStatus { id: string; state: Exclude<SummaryState, "invalid"> }
export interface PlanSummaryStatus {
  plan: string;
  source: string;
  status: string | null;
  state: SummaryState;
  /** Whether the Plan-level text (title, purpose, serves, done when) matches the Plan's own fingerprint. */
  planFresh: boolean;
  actions: ActionSummaryStatus[];
  /** Summary entries for Action ids the Plan no longer has. */
  orphaned: string[];
}

/** Compare one Plan with its summary. A summary for another slug, or a malformed one, is invalid. */
export function comparePlanSummary(plan: PlanSource, summary: unknown): PlanSummaryStatus {
  const base = { plan: plan.slug, source: plan.relativePath, status: plan.status };
  if (summary === null) return { ...base, state: "missing", planFresh: false, actions: plan.actions.map(a => ({ id: a.id, state: "missing" })), orphaned: [] };
  if (!isPlanSummary(summary) || summary.plan !== plan.slug) return { ...base, state: "invalid", planFresh: false, actions: plan.actions.map(a => ({ id: a.id, state: "missing" })), orphaned: [] };
  const entries = new Map(summary.actions.map(a => [a.id, a]));
  const actions = plan.actions.map((a): ActionSummaryStatus => {
    const entry = entries.get(a.id);
    return { id: a.id, state: !entry ? "missing" : entry.source_fingerprint === actionFingerprint(a) ? "fresh" : "stale" };
  });
  const ids = new Set(plan.actions.map(a => a.id));
  const planFresh = summary.source_fingerprint === planFingerprint(plan);
  return { ...base, state: planFresh && actions.every(a => a.state === "fresh") ? "fresh" : "stale", planFresh, actions, orphaned: summary.actions.map(a => a.id).filter(id => !ids.has(id)) };
}

export interface PlanSummaryReport {
  plans: PlanSummaryStatus[];
  counts: Record<SummaryState, number>;
  actions: { total: number; fresh: number; stale: number; missing: number };
}

function listPlanFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) out.push(rel);
    }
  };
  if (existsSync(path.join(repoRoot, "docs/plans"))) walk("docs/plans");
  return out;
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
export function readPlanSummary(repoRoot: string, slug: string): unknown {
  if (!SAFE_SLUG.test(slug)) return { invalid: true };
  const file = path.join(repoRoot, PLAN_SUMMARY_DIR, `${slug}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as unknown; } catch { return { invalid: true }; }
}

/** Every parseable `type: plan` record under docs/plans, nested folders included, sorted by slug. */
export function readPlanSources(repoRoot: string): PlanSource[] {
  return listPlanFiles(repoRoot)
    .map(rel => readPlanSource(rel, readFileSync(path.join(repoRoot, rel), "utf8")))
    .filter((p): p is PlanSource => p !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Read-only: compares every `type: plan` record with its summary. No writes, no model calls. */
export function checkPlanSummaries(repoRoot: string): PlanSummaryReport {
  const plans = readPlanSources(repoRoot);
  const statuses = plans.map(p => comparePlanSummary(p, readPlanSummary(repoRoot, p.slug)));
  const counts: Record<SummaryState, number> = { fresh: 0, stale: 0, missing: 0, invalid: 0 };
  for (const s of statuses) counts[s.state] += 1;
  const all = statuses.flatMap(s => s.actions);
  return {
    plans: statuses,
    counts,
    actions: { total: all.length, fresh: all.filter(a => a.state === "fresh").length, stale: all.filter(a => a.state === "stale").length, missing: all.filter(a => a.state === "missing").length }
  };
}

/** Add current source fingerprints to authored summary text, for the writing tools. Throws on an Action mismatch. */
export function stampPlanSummary(plan: PlanSource, authored: Omit<PlanSummary, "schema" | "generated" | "plan" | "source" | "source_fingerprint" | "actions"> & { actions: Array<Omit<ActionSummary, "source_fingerprint">> }): PlanSummary {
  const byId = new Map(authored.actions.map(a => [a.id, a]));
  const missing = plan.actions.filter(a => !byId.has(a.id)).map(a => a.id);
  const extra = authored.actions.filter(a => !plan.actions.some(p => p.id === a.id)).map(a => a.id);
  if (missing.length || extra.length) throw new Error(`Summary for ${plan.slug} does not match its Actions: missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}.`);
  // Authored input comes from JSON, so drop any computed field it carries (an old fingerprint would read as fresh).
  const { actions: _authoredActions, schema: _schema, generated: _generated, plan: _plan, source: _source, source_fingerprint: _fingerprint, ...rest } =
    authored as typeof authored & Partial<Pick<PlanSummary, "schema" | "generated" | "plan" | "source" | "source_fingerprint">>;
  return {
    schema: PLAN_SUMMARY_SCHEMA,
    generated: true,
    plan: plan.slug,
    source: plan.relativePath,
    source_fingerprint: planFingerprint(plan),
    ...rest,
    actions: plan.actions.map(a => ({ ...byId.get(a.id)!, id: a.id, source_fingerprint: actionFingerprint(a) }))
  };
}

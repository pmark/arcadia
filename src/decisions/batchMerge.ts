/**
 * The /todo batch merge card (#1284, Action batch-merge-decision-card).
 *
 * One card lists every PR awaiting the operator with why, the decisions made
 * and the consequence, and one button merges them in stack order from pinned
 * head shas. This module is pure: no I/O, no commander, no database, no
 * transport, so it stays out of the dashboard import graph. The only
 * side-effecting call is the injected gateway, which `runBatchMerge` uses and
 * which the operator script wires to `gh`.
 *
 * Nothing here grants authority. The pinned spec is published in the operator
 * script's descriptor for review; the script, never an agent, runs it.
 */
import { createHash } from "node:crypto";
import {
  DECISION_CARD_SCHEMA,
  validateDecisionCard,
  type DecisionCard,
} from "./card.js";

export const BATCH_MERGE_RECEIPT_SCHEMA = "arcadia-batch-merge-receipt-v1" as const;
export const BATCH_MERGE_MAX_PRS = 50;
const HEAD_SHA_RE = /^[0-9a-f]{40}$/;
const CARD_ID_RE = /^batch-merge-[0-9a-f]{24}$/;
const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;

/* ------------------------------ classifier ------------------------------ */

export type AuthorityBoundary =
  | "project_governance"
  | "decisions"
  | "agent_permissions"
  | "agent_guidance"
  | "production_policy"
  | "dashboard_api_route"
  | "arcadia_control_state"
  | "ci_and_gates"
  | "operator_authority"
  | "unclassifiable_path";

export const AUTHORITY_BOUNDARIES: readonly AuthorityBoundary[] = [
  "project_governance",
  "decisions",
  "agent_permissions",
  "agent_guidance",
  "production_policy",
  "dashboard_api_route",
  "arcadia_control_state",
  "ci_and_gates",
  "operator_authority",
  "unclassifiable_path",
];

const BOUNDARY_MEANING: Record<AuthorityBoundary, string> = {
  project_governance: "project governance documents (PROJECT.md, CONSTITUTION.md, AGENTS.md, CLAUDE.md)",
  decisions: "recorded Decisions",
  agent_permissions: "agent permission or allow rules",
  agent_guidance: "agent guidance procedures",
  production_policy: "production policy and admission code",
  dashboard_api_route: "dashboard routes that can mutate state",
  arcadia_control_state: "Arcadia control state (.arcadia/)",
  ci_and_gates: "CI workflows and merge gates",
  operator_authority: "operator scripts and the decision-card contract",
  unclassifiable_path: "a path that could not be safely classified",
};

const EXACT: Record<string, AuthorityBoundary> = {
  "project.md": "project_governance",
  "constitution.md": "project_governance",
  "agents.md": "project_governance",
  "claude.md": "project_governance",
  "docs/agents-context.md": "project_governance",
  "docs/managed-production-readiness.md": "production_policy",
};
const PREFIXES: ReadonlyArray<[string, AuthorityBoundary]> = [
  ["docs/decisions/", "decisions"],
  [".claude/", "agent_permissions"],
  [".codex/", "agent_permissions"],
  [".opencode/", "agent_permissions"],
  ["docs/agent-guidance/", "agent_guidance"],
  ["src/production/", "production_policy"],
  ["apps/dashboard/app/api/", "dashboard_api_route"],
  [".arcadia/", "arcadia_control_state"],
  [".github/", "ci_and_gates"],
  ["artifacts/generated/operator-scripts/", "operator_authority"],
  ["src/operatoractions/", "operator_authority"],
  ["src/decisions/", "operator_authority"],
];
const PERMISSION_NAME_RE = /(permission|allow[-_ .]?(list|rules?)|settings(\.local)?\.json)/;
const PRODUCTION_POLICY_RE = /production[-_]?polic/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060\ufeff]/;

/**
 * Classify one repository path. Fails closed: anything that cannot be reduced
 * to a plain, ASCII, traversal-free relative path is `unclassifiable_path`.
 * Matching is case-insensitive after NFKC, backslash and `./` normalisation.
 */
export function classifyAuthorityPath(input: unknown): AuthorityBoundary[] {
  if (typeof input !== "string" || input === "") return ["unclassifiable_path"];
  const found = new Set<AuthorityBoundary>();
  const raw = input.normalize("NFKC");
  if (CONTROL_RE.test(raw) || /[^\x20-\x7e]/.test(raw)) return ["unclassifiable_path"];
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return ["unclassifiable_path"];
  const segments: string[] = [];
  for (const segment of raw.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return ["unclassifiable_path"];
    if (segment !== segment.trim() || /[. ]$/.test(segment)) return ["unclassifiable_path"];
    segments.push(segment.toLowerCase());
  }
  if (segments.length === 0) return ["unclassifiable_path"];
  const path = segments.join("/");
  const exact = EXACT[path];
  if (exact) found.add(exact);
  for (const [prefix, boundary] of PREFIXES) {
    if (path.startsWith(prefix)) found.add(boundary);
  }
  if (PERMISSION_NAME_RE.test(segments[segments.length - 1])) found.add("agent_permissions");
  if (PRODUCTION_POLICY_RE.test(path)) found.add("production_policy");
  return AUTHORITY_BOUNDARIES.filter((b) => found.has(b));
}

/** The union of boundaries a file list touches, in contract order. An empty list is unclassifiable. */
export function classifyAuthorityPaths(paths: unknown): AuthorityBoundary[] {
  if (!Array.isArray(paths) || paths.length === 0) return ["unclassifiable_path"];
  const found = new Set<AuthorityBoundary>();
  for (const p of paths) for (const b of classifyAuthorityPath(p)) found.add(b);
  return AUTHORITY_BOUNDARIES.filter((b) => found.has(b));
}

/* -------------------------------- types --------------------------------- */

export interface BatchPrReview {
  verdict: string;
  headSha: string;
}
export interface BatchPrCheck {
  name: string;
  conclusion: string | null | undefined;
}
/** What the card builder and the script read about one PR. */
export interface BatchPrFacts {
  number: number;
  title: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  files: string[];
  /** Why the operator is asked. */
  why: string;
  /** Decisions already made that this PR carries or depends on. */
  decisions: string[];
  reviews: BatchPrReview[];
  checks: BatchPrCheck[];
  requiredChecks: string[];
  state?: "open" | "merged" | "closed";
  /** Head the PR was merged at, when merged. */
  mergedHeadSha?: string | null;
}
export interface BatchPrSpec {
  number: number;
  headSha: string;
  /** The PR in this batch whose head branch is this PR's base; null when it targets the trunk. */
  parent: number | null;
  /** Boundaries the operator accepted by pressing this card; the script refuses any other. */
  acknowledgedBoundaries: AuthorityBoundary[];
}
export interface BatchMergeSpec {
  cardId: string;
  trunk: string;
  prs: BatchPrSpec[];
}
export interface BatchMergeRequest {
  cardId: string;
  heads: Array<{ number: number; headSha: string }>;
}

export type BatchRefusalCode =
  | "invalid_request"
  | "invalid_spec"
  | "empty_batch"
  | "duplicate_pr"
  | "card_id_mismatch"
  | "bad_head_sha"
  | "request_set_mismatch"
  | "stack_cycle"
  | "base_pr_missing"
  | "stack_changed"
  | "pr_unreadable"
  | "pr_closed_unmerged"
  | "head_moved"
  | "merged_at_other_head"
  | "receipt_conflict"
  | "no_required_checks"
  | "check_not_green"
  | "review_missing"
  | "review_stale_head"
  | "review_not_approved"
  | "authority_boundary_not_acknowledged";

export interface BatchRefusal {
  code: BatchRefusalCode;
  number: number | null;
  message: string;
}

/* ------------------------------ helpers --------------------------------- */

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Own enumerable data properties only; an accessor property is a refusal, never invoked. */
function readOwnData(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== allowed.length) return null;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.includes(key)) return null;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable) return null;
    out[key] = d.value;
  }
  return out;
}

const isPrNumber = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
export const isPinnedHeadSha = (s: unknown): s is string => typeof s === "string" && HEAD_SHA_RE.test(s);
const sha12 = (s: string) => s.slice(0, 12);

function canonicalManifest(trunk: string, prs: readonly BatchPrSpec[]): string {
  const rows = [...prs]
    .sort((a, b) => a.number - b.number)
    .map((p) => ({
      number: p.number,
      headSha: p.headSha,
      parent: p.parent,
      acknowledgedBoundaries: [...p.acknowledgedBoundaries].sort(),
    }));
  return JSON.stringify({ trunk, prs: rows });
}

export function batchCardId(trunk: string, prs: readonly BatchPrSpec[]): string {
  const digest = createHash("sha256").update(canonicalManifest(trunk, prs)).digest("hex");
  return `batch-merge-${digest.slice(0, 24)}`;
}

function manifestStateHash(trunk: string, prs: readonly BatchPrSpec[]): string {
  return `sha256:${createHash("sha256").update(canonicalManifest(trunk, prs)).digest("hex")}`;
}

/** Stack order, base first, ties by PR number. Parents are taken from the spec. */
export function orderStack(
  prs: ReadonlyArray<{ number: number; parent: number | null }>,
): { ok: true; order: number[] } | { ok: false; code: "stack_cycle" | "base_pr_missing" | "duplicate_pr"; number: number } {
  const byNumber = new Map<number, number | null>();
  for (const p of prs) {
    if (byNumber.has(p.number)) return { ok: false, code: "duplicate_pr", number: p.number };
    byNumber.set(p.number, p.parent);
  }
  for (const p of prs) {
    if (p.parent === null) continue;
    if (p.parent === p.number) return { ok: false, code: "stack_cycle", number: p.number };
    if (!byNumber.has(p.parent)) return { ok: false, code: "base_pr_missing", number: p.number };
  }
  const order: number[] = [];
  const placed = new Set<number>();
  const remaining = [...byNumber.keys()].sort((a, b) => a - b);
  while (order.length < byNumber.size) {
    const next = remaining.find((n) => !placed.has(n) && (byNumber.get(n) === null || placed.has(byNumber.get(n) as number)));
    if (next === undefined) {
      const stuck = remaining.find((n) => !placed.has(n))!;
      return { ok: false, code: "stack_cycle", number: stuck };
    }
    placed.add(next);
    order.push(next);
  }
  return { ok: true, order };
}

/** Derive each PR's parent from baseRef/headRef; a non-trunk base with no matching PR is base_pr_missing. */
function deriveParents(
  facts: ReadonlyArray<Pick<BatchPrFacts, "number" | "baseRef" | "headRef">>,
  trunk: string,
): { ok: true; parents: Map<number, number | null> } | { ok: false; code: BatchRefusalCode; number: number } {
  const byHead = new Map<string, number>();
  for (const f of facts) {
    if (byHead.has(f.headRef)) return { ok: false, code: "stack_changed", number: f.number };
    byHead.set(f.headRef, f.number);
  }
  const parents = new Map<number, number | null>();
  for (const f of facts) {
    if (f.baseRef === trunk) {
      parents.set(f.number, null);
      continue;
    }
    const parent = byHead.get(f.baseRef);
    if (parent === undefined) return { ok: false, code: "base_pr_missing", number: f.number };
    parents.set(f.number, parent);
  }
  return { ok: true, parents };
}

/* ------------------------- per-PR readiness gate ------------------------- */

export interface PrReadiness {
  boundaries: AuthorityBoundary[];
  reviewVerdict: "approved" | "missing" | "stale_head" | "not_approved";
  checks: { name: string; conclusion: string }[];
  refusals: BatchRefusal[];
}

const isGreen = (c: unknown): boolean => typeof c === "string" && c.trim().toLowerCase() === "success";

/** Review/check/boundary gate for one PR against its pinned head. Reads each value once. */
export function assessPr(
  facts: BatchPrFacts,
  pinned: BatchPrSpec,
): PrReadiness {
  const refusals: BatchRefusal[] = [];
  const n = pinned.number;
  const refuse = (code: BatchRefusalCode, message: string) => refusals.push({ code, number: n, message });
  const boundaries = classifyAuthorityPaths(facts.files);

  const unacknowledged = boundaries.filter((b) => !pinned.acknowledgedBoundaries.includes(b));
  if (unacknowledged.length > 0) {
    refuse(
      "authority_boundary_not_acknowledged",
      `#${n} touches ${unacknowledged.map((b) => BOUNDARY_MEANING[b]).join("; ")}, which this card was not pinned with.`,
    );
  }

  let reviewVerdict: PrReadiness["reviewVerdict"];
  const atHead = facts.reviews.filter((r) => r.headSha === pinned.headSha);
  if (facts.reviews.length === 0) reviewVerdict = "missing";
  else if (atHead.length === 0) reviewVerdict = "stale_head";
  else if (atHead.every((r) => typeof r.verdict === "string" && r.verdict.trim().toLowerCase() === "approved")) reviewVerdict = "approved";
  else reviewVerdict = "not_approved";
  if (reviewVerdict === "missing") refuse("review_missing", `#${n} has no independent review.`);
  if (reviewVerdict === "stale_head") refuse("review_stale_head", `#${n} has only reviews of an earlier head.`);
  if (reviewVerdict === "not_approved") refuse("review_not_approved", `#${n} has an independent review at this head that is not an approval.`);

  const checks = facts.checks.map((c) => ({
    name: String(c.name),
    conclusion: typeof c.conclusion === "string" && c.conclusion.trim() !== "" ? c.conclusion.trim().toLowerCase() : "unknown",
  }));
  if (facts.requiredChecks.length === 0) {
    refuse("no_required_checks", `#${n} names no required checks, so green cannot be established.`);
  }
  for (const name of facts.requiredChecks) {
    const rows = facts.checks.filter((c) => c.name === name);
    if (rows.length === 0 || !rows.every((r) => isGreen(r.conclusion))) {
      refuse("check_not_green", `#${n} required check ${name} is not green on the pinned head.`);
    }
  }
  return { boundaries, reviewVerdict, checks, refusals };
}

/* ------------------------------ card build ------------------------------- */

export interface BatchMergeItem {
  order: number;
  number: number;
  title: string;
  headSha: string;
  parent: number | null;
  why: string;
  decisions: string[];
  boundaries: AuthorityBoundary[];
  boundarySummary: string;
  reviewVerdict: PrReadiness["reviewVerdict"];
  checks: { name: string; conclusion: string }[];
  consequence: string;
}

export type BatchMergeBuild =
  | { ok: true; card: DecisionCard; spec: BatchMergeSpec; items: BatchMergeItem[] }
  | { ok: false; refusal: BatchRefusal };

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/**
 * Build the card, its pinned spec and the per-PR rows. A PR that is not ready
 * does not produce a card; the operator is never asked to press a button that
 * would refuse. Boundaries the PRs touch are acknowledged in the spec and said
 * in the card text.
 */
export function buildBatchMergeCard(input: {
  prs: readonly BatchPrFacts[];
  trunk?: string;
  repo?: string;
  now: Date;
  expires: string;
}): BatchMergeBuild {
  const trunk = input.trunk ?? "main";
  const fail = (code: BatchRefusalCode, number: number | null, message: string): BatchMergeBuild => ({
    ok: false,
    refusal: { code, number, message },
  });
  try {
    if (!Array.isArray(input.prs) || input.prs.length === 0) return fail("empty_batch", null, "The batch lists no PRs.");
    if (input.prs.length > BATCH_MERGE_MAX_PRS) return fail("invalid_spec", null, "The batch is larger than the card limit.");
    const seen = new Set<number>();
    for (const p of input.prs) {
      if (!isPrNumber(p.number)) return fail("invalid_spec", null, "A PR number is not a positive integer.");
      if (seen.has(p.number)) return fail("duplicate_pr", p.number, `#${p.number} is listed twice.`);
      seen.add(p.number);
      if (!isPinnedHeadSha(p.headSha)) return fail("bad_head_sha", p.number, `#${p.number} head is not a 40-character lowercase hex sha.`);
    }
    const derived = deriveParents(input.prs, trunk);
    if (!derived.ok) return fail(derived.code, derived.number, `#${derived.number}: its base is not the trunk or another PR in this batch.`);
    const specPrs: BatchPrSpec[] = input.prs.map((p) => ({
      number: p.number,
      headSha: p.headSha,
      parent: derived.parents.get(p.number) ?? null,
      acknowledgedBoundaries: classifyAuthorityPaths(p.files),
    }));
    const stack = orderStack(specPrs);
    if (!stack.ok) return fail(stack.code, stack.number, `#${stack.number}: the stack has a cycle or a missing base.`);
    const readiness = new Map<number, PrReadiness>();
    for (const p of input.prs) {
      const spec = specPrs.find((s) => s.number === p.number)!;
      const r = assessPr(p, spec);
      if (r.refusals.length > 0) return { ok: false, refusal: r.refusals[0] };
      readiness.set(p.number, r);
    }
    const spec: BatchMergeSpec = { cardId: batchCardId(trunk, specPrs), trunk, prs: specPrs };
    const repo = input.repo ?? "pmark/arcadia";
    const items: BatchMergeItem[] = stack.order.map((number, index) => {
      const f = input.prs.find((p) => p.number === number)!;
      const s = specPrs.find((p) => p.number === number)!;
      const r = readiness.get(number)!;
      const boundarySummary =
        r.boundaries.length === 0
          ? "touches no authority boundary"
          : `touches authority boundary: ${r.boundaries.map((b) => BOUNDARY_MEANING[b]).join("; ")}`;
      const into = s.parent === null ? trunk : `the head of #${s.parent}`;
      return {
        order: index + 1,
        number,
        title: f.title,
        headSha: f.headSha,
        parent: s.parent,
        why: f.why,
        decisions: [...f.decisions],
        boundaries: r.boundaries,
        boundarySummary,
        reviewVerdict: r.reviewVerdict,
        checks: r.checks,
        consequence: `Merges #${number} at head ${sha12(f.headSha)} into ${into}; ${boundarySummary}. The button cannot undo a merge.`,
      };
    });
    const anyBoundary = items.some((i) => i.boundaries.length > 0);
    const what = clip(
      `Merge ${items.length} PR${items.length === 1 ? "" : "s"} into ${trunk} in stack order: ${items.map((i) => `#${i.number}`).join(", ")}.` +
        (anyBoundary ? " Some touch authority boundaries; read each row before pressing." : ""),
      500,
    );
    const candidate = {
      schema: DECISION_CARD_SCHEMA,
      id: spec.cardId,
      kind: "pr-merge",
      what,
      options: [
        {
          id: "merge-batch",
          label: `Merge ${items.length} PR${items.length === 1 ? "" : "s"}`,
          consequence: clip(
            `Merges each listed PR, base first, only at its pinned head sha. If any head moved, any required check is not green or any independent review is missing, nothing merges. ` +
              `A rerun skips PRs already merged at their pinned head.`,
            1000,
          ),
        },
        { id: "hold", label: "Hold", consequence: "Nothing merges; the card stays open until it expires or a head moves." },
      ],
      evidence: items.map((i) => ({
        label: clip(`#${i.order} PR ${i.number} ${sha12(i.headSha)}: ${i.boundaries.length === 0 ? "no authority boundary" : i.boundaries.join(",")}; review ${i.reviewVerdict}`, 200),
        url: `https://github.com/${repo}/pull/${i.number}`,
      })),
      verb: "merge",
      pins: { stateHash: manifestStateHash(trunk, specPrs) },
      expires: input.expires,
      policy_match: null,
      receipt: null,
    };
    const validated = validateDecisionCard(candidate, { now: input.now });
    if (!validated.ok) {
      return fail("invalid_spec", null, `The card did not validate: ${validated.errors.map((e) => e.code).join(", ")}.`);
    }
    return { ok: true, card: validated.card, spec, items };
  } catch (error) {
    return fail("invalid_spec", null, `The batch could not be read: ${error instanceof Error ? error.message : "unreadable input"}.`);
  }
}

/* ---------------------------- request and spec --------------------------- */

/** Parse the button payload: exactly `{cardId, heads:[{number, headSha}]}`, plain data only. */
export function parseBatchMergeRequest(
  raw: unknown,
): { ok: true; request: BatchMergeRequest } | { ok: false; refusal: BatchRefusal } {
  const bad = (code: BatchRefusalCode, number: number | null, message: string) => ({
    ok: false as const,
    refusal: { code, number, message },
  });
  try {
    const top = readOwnData(raw, ["cardId", "heads"]);
    if (!top) return bad("invalid_request", null, "The request must be exactly {cardId, heads} of plain data.");
    if (typeof top.cardId !== "string" || !CARD_ID_RE.test(top.cardId)) {
      return bad("invalid_request", null, "cardId is not a batch card id.");
    }
    if (!Array.isArray(top.heads)) return bad("invalid_request", null, "heads must be a list.");
    if (top.heads.length === 0) return bad("empty_batch", null, "The request names no PRs.");
    if (top.heads.length > BATCH_MERGE_MAX_PRS) return bad("invalid_request", null, "heads is larger than the card limit.");
    const heads: BatchMergeRequest["heads"] = [];
    const seen = new Set<number>();
    for (let i = 0; i < top.heads.length; i++) {
      const entry = readOwnData(top.heads[i], ["number", "headSha"]);
      if (!entry) return bad("invalid_request", null, `heads[${i}] must be exactly {number, headSha}.`);
      if (!isPrNumber(entry.number)) return bad("invalid_request", null, `heads[${i}].number is not a positive integer.`);
      if (seen.has(entry.number)) return bad("duplicate_pr", entry.number, `#${entry.number} is listed twice.`);
      seen.add(entry.number);
      if (!isPinnedHeadSha(entry.headSha)) {
        return bad("bad_head_sha", entry.number, `#${entry.number} head is not a 40-character lowercase hex sha.`);
      }
      heads.push({ number: entry.number, headSha: entry.headSha });
    }
    return { ok: true, request: { cardId: top.cardId, heads } };
  } catch {
    return bad("invalid_request", null, "The request could not be read.");
  }
}

/** The request the card's button posts: the card id and each PR's pinned head, nothing else. */
export function requestFromSpec(spec: BatchMergeSpec): BatchMergeRequest {
  return { cardId: spec.cardId, heads: spec.prs.map((p) => ({ number: p.number, headSha: p.headSha })) };
}

/** Validate a spec read from a descriptor, including that its id is the digest of its content. */
export function validateBatchMergeSpec(
  raw: unknown,
): { ok: true; spec: BatchMergeSpec } | { ok: false; refusal: BatchRefusal } {
  const bad = (code: BatchRefusalCode, number: number | null, message: string) => ({
    ok: false as const,
    refusal: { code, number, message },
  });
  try {
    const top = readOwnData(raw, ["cardId", "trunk", "prs"]);
    if (!top || typeof top.cardId !== "string" || typeof top.trunk !== "string" || !KEY_RE.test(top.trunk) || !Array.isArray(top.prs)) {
      return bad("invalid_spec", null, "The batch spec must be exactly {cardId, trunk, prs}.");
    }
    if (top.prs.length === 0) return bad("empty_batch", null, "The batch lists no PRs.");
    if (top.prs.length > BATCH_MERGE_MAX_PRS) return bad("invalid_spec", null, "The batch is larger than the card limit.");
    const prs: BatchPrSpec[] = [];
    for (const item of top.prs) {
      const e = readOwnData(item, ["number", "headSha", "parent", "acknowledgedBoundaries"]);
      if (!e || !isPrNumber(e.number)) return bad("invalid_spec", null, "A batch PR entry is malformed.");
      if (!isPinnedHeadSha(e.headSha)) return bad("bad_head_sha", e.number, `#${e.number} head is not a 40-character lowercase hex sha.`);
      if (e.parent !== null && !isPrNumber(e.parent)) return bad("invalid_spec", e.number, `#${e.number} parent is malformed.`);
      const ack = e.acknowledgedBoundaries;
      if (!Array.isArray(ack) || !ack.every((b) => typeof b === "string" && (AUTHORITY_BOUNDARIES as readonly string[]).includes(b))) {
        return bad("invalid_spec", e.number, `#${e.number} acknowledged boundaries are malformed.`);
      }
      prs.push({ number: e.number, headSha: e.headSha, parent: e.parent, acknowledgedBoundaries: [...new Set(ack as AuthorityBoundary[])] });
    }
    const stack = orderStack(prs);
    if (!stack.ok) return bad(stack.code, stack.number, `#${stack.number}: the stack is invalid (${stack.code}).`);
    if (top.cardId !== batchCardId(top.trunk, prs)) {
      return bad("card_id_mismatch", null, "The card id does not match the pinned PR list.");
    }
    return { ok: true, spec: { cardId: top.cardId, trunk: top.trunk, prs } };
  } catch {
    return bad("invalid_spec", null, "The batch spec could not be read.");
  }
}

/* ------------------------------- evaluate -------------------------------- */

export interface BatchReceipt {
  schema: typeof BATCH_MERGE_RECEIPT_SCHEMA;
  cardId: string;
  number: number;
  headSha: string;
  outcome: "merged" | "already_merged" | "refused" | "failed" | "not_attempted";
  reason: string | null;
  at: string;
}

export type BatchEvaluation =
  | { ok: true; order: number[]; toMerge: number[]; alreadyMerged: number[] }
  | { ok: false; order: number[]; refusals: BatchRefusal[] };

/**
 * Decide the whole batch from one snapshot of live facts. One refusal refuses
 * every PR. A PR already merged at its pinned head is skipped, which makes a
 * rerun after a partial merge safe.
 */
export function evaluateBatchMerge(
  specInput: unknown,
  requestInput: unknown,
  live: ReadonlyMap<number, BatchPrFacts | null | undefined> | Readonly<Record<number, BatchPrFacts | null | undefined>>,
  receipts: ReadonlyMap<number, BatchReceipt | null | undefined> = new Map(),
): BatchEvaluation {
  const refusals: BatchRefusal[] = [];
  const done = (order: number[]): BatchEvaluation => ({ ok: false, order, refusals });
  try {
    const specResult = validateBatchMergeSpec(specInput);
    if (!specResult.ok) return { ok: false, order: [], refusals: [specResult.refusal] };
    const spec = specResult.spec;
    const reqResult = parseBatchMergeRequest(requestInput);
    if (!reqResult.ok) return { ok: false, order: [], refusals: [reqResult.refusal] };
    const request = reqResult.request;
    const order = (orderStack(spec.prs) as { ok: true; order: number[] }).order;
    const refuse = (code: BatchRefusalCode, number: number | null, message: string) => refusals.push({ code, number, message });

    if (request.cardId !== spec.cardId) refuse("card_id_mismatch", null, "The request names a different card.");
    const requested = new Map(request.heads.map((h) => [h.number, h.headSha]));
    const sameSet = requested.size === spec.prs.length && spec.prs.every((p) => requested.has(p.number));
    if (!sameSet) refuse("request_set_mismatch", null, "The request's PR list is not the card's PR list.");
    for (const p of spec.prs) {
      const want = requested.get(p.number);
      if (want !== undefined && want !== p.headSha) refuse("head_moved", p.number, `#${p.number}: the request's head is not the card's pinned head.`);
    }
    if (refusals.length > 0) return done(order);

    const lookup = (n: number): BatchPrFacts | null => {
      const v = live instanceof Map ? live.get(n) : (live as Record<number, BatchPrFacts | null | undefined>)[n];
      return v ?? null;
    };
    // One read of every PR and receipt: a getter or a moving object cannot change between checks.
    const snapshot = new Map<number, BatchPrFacts>();
    const facts: BatchPrFacts[] = [];
    for (const p of spec.prs) {
      const f = lookup(p.number);
      if (!f) {
        refuse("pr_unreadable", p.number, `#${p.number} could not be read.`);
        continue;
      }
      const copy: BatchPrFacts = {
        number: f.number,
        title: String(f.title),
        headSha: f.headSha,
        baseRef: f.baseRef,
        headRef: f.headRef,
        files: Array.isArray(f.files) ? [...f.files] : [],
        why: "",
        decisions: [],
        reviews: Array.isArray(f.reviews) ? f.reviews.map((r) => ({ verdict: r.verdict, headSha: r.headSha })) : [],
        checks: Array.isArray(f.checks) ? f.checks.map((c) => ({ name: c.name, conclusion: c.conclusion })) : [],
        requiredChecks: Array.isArray(f.requiredChecks) ? [...f.requiredChecks] : [],
        state: f.state,
        mergedHeadSha: f.mergedHeadSha ?? null,
      };
      if (copy.number !== p.number) {
        refuse("pr_unreadable", p.number, `#${p.number}: the read returned a different PR.`);
        continue;
      }
      snapshot.set(p.number, copy);
      facts.push(copy);
    }
    if (refusals.length > 0) return done(order);

    const alreadyMerged: number[] = [];
    const toMerge: number[] = [];
    const openFacts = facts.filter((f) => f.state !== "merged");
    // Stack shape: re-derive parents among open PRs; merged ones have left the stack.
    for (const f of openFacts) {
      const p = spec.prs.find((s) => s.number === f.number)!;
      if (p.parent === null) {
        if (f.baseRef !== spec.trunk) refuse("stack_changed", f.number, `#${f.number} no longer targets ${spec.trunk}.`);
      } else {
        const parent = snapshot.get(p.parent);
        if (parent && parent.state !== "merged" && f.baseRef !== parent.headRef) {
          refuse("stack_changed", f.number, `#${f.number} no longer stacks on #${p.parent}.`);
        }
        if (parent && parent.state === "merged" && f.baseRef !== spec.trunk && f.baseRef !== parent.headRef) {
          refuse("stack_changed", f.number, `#${f.number} no longer stacks on #${p.parent}.`);
        }
      }
    }
    for (const n of order) {
      const f = snapshot.get(n)!;
      const p = spec.prs.find((s) => s.number === n)!;
      const receipt = receipts.get(n) ?? null;
      if (f.state === "merged") {
        if (f.mergedHeadSha === p.headSha) alreadyMerged.push(n);
        else refuse("merged_at_other_head", n, `#${n} is merged at a head other than the pinned one.`);
        continue;
      }
      if (f.state === "closed") {
        refuse("pr_closed_unmerged", n, `#${n} is closed without merging.`);
        continue;
      }
      if (receipt && receipt.outcome === "merged") {
        refuse("receipt_conflict", n, `#${n} has a merged receipt but is not merged on the host.`);
        continue;
      }
      if (f.headSha !== p.headSha) {
        refuse("head_moved", n, `#${n} head moved since the card was pinned.`);
        continue;
      }
      const readiness = assessPr(f, p);
      refusals.push(...readiness.refusals);
      toMerge.push(n);
    }
    if (refusals.length > 0) return done(order);
    return { ok: true, order, toMerge, alreadyMerged };
  } catch {
    return { ok: false, order: [], refusals: [{ code: "invalid_request", number: null, message: "The batch could not be evaluated." }] };
  }
}

/* --------------------------------- run ----------------------------------- */

export interface BatchMergeGateway {
  readPr(number: number): BatchPrFacts | null;
  readReceipt(cardId: string, number: number): BatchReceipt | null;
  writeReceipt(receipt: BatchReceipt): void;
  /** Must merge only if the PR head still equals headSha (gh `--match-head-commit`). */
  merge(number: number, headSha: string): void;
}

export interface BatchMergeRunResult {
  outcome: "merged" | "nothing_to_merge" | "refused" | "failed";
  merged: number[];
  alreadyMerged: number[];
  refusals: BatchRefusal[];
  receipts: BatchReceipt[];
}

/**
 * Execute the batch. Reads every PR once, refuses the whole batch on any
 * problem (writing a refusal receipt per PR and merging none), otherwise
 * merges in stack order. A merge failure stops the run; PRs not reached get a
 * not_attempted receipt. A PR with a merged receipt is never merged again.
 */
export function runBatchMerge(
  specInput: unknown,
  requestInput: unknown,
  gateway: BatchMergeGateway,
  now: Date,
): BatchMergeRunResult {
  const at = now.toISOString();
  const receipts: BatchReceipt[] = [];
  const specResult = validateBatchMergeSpec(specInput);
  if (!specResult.ok) return { outcome: "refused", merged: [], alreadyMerged: [], refusals: [specResult.refusal], receipts };
  const spec = specResult.spec;
  const order = (orderStack(spec.prs) as { ok: true; order: number[] }).order;
  const byNumber = new Map(spec.prs.map((p) => [p.number, p]));
  const write = (number: number, outcome: BatchReceipt["outcome"], reason: string | null) => {
    const r: BatchReceipt = { schema: BATCH_MERGE_RECEIPT_SCHEMA, cardId: spec.cardId, number, headSha: byNumber.get(number)!.headSha, outcome, reason, at };
    gateway.writeReceipt(r);
    receipts.push(r);
  };

  const live = new Map<number, BatchPrFacts | null>();
  const prior = new Map<number, BatchReceipt | null>();
  for (const n of order) {
    try {
      live.set(n, gateway.readPr(n));
    } catch {
      live.set(n, null);
    }
    prior.set(n, gateway.readReceipt(spec.cardId, n));
  }
  const evaluation = evaluateBatchMerge(spec, requestInput, live, prior);
  if (!evaluation.ok) {
    const reason = evaluation.refusals[0] ? `${evaluation.refusals[0].code}: ${evaluation.refusals[0].message}` : "refused";
    for (const n of order) write(n, "refused", reason);
    return { outcome: "refused", merged: [], alreadyMerged: [], refusals: evaluation.refusals, receipts };
  }
  for (const n of evaluation.alreadyMerged) {
    if (prior.get(n)?.outcome !== "merged") write(n, "already_merged", null);
  }
  const merged: number[] = [];
  for (let i = 0; i < evaluation.toMerge.length; i++) {
    const n = evaluation.toMerge[i];
    try {
      gateway.merge(n, byNumber.get(n)!.headSha);
    } catch (error) {
      write(n, "failed", error instanceof Error ? error.message : "merge failed");
      for (const rest of evaluation.toMerge.slice(i + 1)) write(rest, "not_attempted", `stopped after #${n} failed`);
      return {
        outcome: "failed",
        merged,
        alreadyMerged: evaluation.alreadyMerged,
        refusals: [{ code: "pr_unreadable", number: n, message: `#${n} merge failed.` }],
        receipts,
      };
    }
    write(n, "merged", null);
    merged.push(n);
  }
  return {
    outcome: merged.length === 0 ? "nothing_to_merge" : "merged",
    merged,
    alreadyMerged: evaluation.alreadyMerged,
    refusals: [],
    receipts,
  };
}

/* --------------------------- ping and descriptor ------------------------- */

/** The Discord ping for a pending batch: links the card and states the count. */
export function buildBatchMergePing(
  card: DecisionCard,
  spec: BatchMergeSpec,
  dashboardBase: string,
): { ok: true; ping: { message: string; kind: "attention"; link: string } } | { ok: false; reason: string } {
  if (card.id !== spec.cardId || card.verb !== "merge") return { ok: false, reason: "card does not match the spec" };
  if (typeof dashboardBase !== "string" || !/^https?:\/\/[^\s/?#]+(\/[A-Za-z0-9._~/-]*)?$/.test(dashboardBase)) {
    return { ok: false, reason: "dashboard base must be an http(s) URL without query or whitespace" };
  }
  const count = spec.prs.length;
  const link = `${dashboardBase.replace(/\/+$/, "")}/todo?card=${encodeURIComponent(card.id)}`;
  return {
    ok: true,
    ping: {
      kind: "attention",
      message: `${count} PR${count === 1 ? "" : "s"} await your merge on one card (${card.id}). Open the card to review and press the button.`,
      link,
    },
  };
}

/** Descriptor for the operator script that runs this batch; published for review, never run by an agent. */
export function buildBatchMergeDescriptor(spec: BatchMergeSpec, items: readonly BatchMergeItem[]): Record<string, unknown> {
  const id = spec.cardId;
  const list = items.map((i) => `#${i.number} (${sha12(i.headSha)})`).join(", ");
  return {
    schema: "arcadia-operator-script-v1",
    id,
    title: `Merge ${spec.prs.length} pinned PR${spec.prs.length === 1 ? "" : "s"} in stack order`,
    script: `${id}.sh`,
    repeatable: true,
    problem: `These PRs await the operator: ${list}. Each was read with a green required-check set and an independent review at the pinned head.`,
    desired_effect:
      `Merges each listed PR into ${spec.trunk}, base first, only at its pinned head sha, writing one receipt per PR. ` +
      `Any moved head, non-green required check, missing review or unacknowledged authority boundary refuses the whole batch and merges none. A rerun skips PRs already merged.`,
    authority: {
      does: spec.prs.map((p) => `Merge PR #${p.number} at head ${p.headSha}`),
      never_does: [
        "Merge a PR at any head other than the pinned one",
        "Merge a PR touching an authority boundary this card was not pinned with",
        "Force-push, delete branches, change branch protection, or edit any Decision, Plan or Action",
        "Re-merge a PR that already has a merged receipt",
      ],
    },
    success: { effect: "Every listed PR is merged at its pinned head, or was already.", next: "Nothing; receipts list each PR." },
    failure: {
      effect: "No PR is merged by a refusal; after a mid-run host failure the merged prefix stays merged.",
      next: "Read the receipts, correct the named cause, and press the button again.",
    },
    batchMerge: spec,
  };
}

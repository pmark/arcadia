/**
 * Card generation from the three existing operator-touch sources (#1284,
 * Action cards-from-existing-sources): open Decisions (verb `answer`),
 * operator-script descriptors (verb `run`) and pull requests that need the
 * operator (verb `merge`).
 *
 * Pure and read-only. The caller reads Decisions, descriptors and PR facts
 * (fs, gh) and injects them as plain data; this module does no I/O, never
 * calls a clock (`now` is injected), never mutates its input (every source is
 * snapshotted once into a fresh plain copy) and only imports node:crypto,
 * ./card.js and ./batchMerge.js, so it stays out of the dashboard import graph.
 *
 * Policy, all fail-closed:
 * - Every card is built from the snapshot and must pass `validateDecisionCard`;
 *   text that breaks the card text rule or a length limit is REFUSED, never
 *   truncated or normalised into a different meaning.
 * - `policy_match` is always null and no `defaultAction` is set: generation
 *   grants no authority; only the evaluator and the operator do.
 * - A PR card names the authority boundaries its diff touches with the shared
 *   path classifier from batchMerge.ts (`classifyAuthorityPaths`), including
 *   rename previous paths. The documented list is `PR_CARD_BOUNDARY_MEANING`.
 * - The pins are a SHA-256 over a canonical encoding of the source state, so
 *   any change of that state changes the pin; identical state gives an
 *   identical pin on every call.
 */
import { createHash } from "node:crypto";
import type { DecisionOptionEffect } from "../docs/types.js";
import { DECISION_CARD_LIMITS, DECISION_CARD_SCHEMA, parseCardExpiry, validateDecisionCard, type DecisionCard } from "./card.js";
import {
  AUTHORITY_BOUNDARIES,
  classifyAuthorityPaths,
  isPinnedHeadSha,
  isRepoSlug,
  type AuthorityBoundary,
  type BatchFileEntry,
} from "./batchMerge.js";

export const CARD_SOURCE_LIMITS = {
  /** Sources examined per call; the rest are reported, not silently dropped. */
  maxSources: 200,
  /** Changed files per PR; a larger diff cannot be classified completely. */
  maxFiles: 3000,
  maxPathLength: 1024,
  maxStringLength: 20_000,
  maxNodes: 50_000,
  maxDepth: 8,
} as const;

export const DEFAULT_CARD_REPO = "pmark/arcadia";

/** The documented authority-boundary list a PR card can name (one entry per boundary). */
export const PR_CARD_BOUNDARY_MEANING: Readonly<Record<AuthorityBoundary, string>> = {
  project_governance: "project governance documents (PROJECT.md, CONSTITUTION.md, AGENTS.md, CLAUDE.md)",
  decisions: "recorded Decisions",
  agent_permissions: "agent permission or allow rules",
  agent_guidance: "agent guidance procedures",
  production_policy: "production policy and admission code",
  dashboard_api_route: "dashboard routes that can mutate state",
  arcadia_control_state: "Arcadia control state (.arcadia/)",
  ci_and_gates: "CI workflows and merge gates",
  operator_authority: "operator scripts and the decision-card contract",
  dependency_manifest: "dependency manifests, lockfiles and package-manager config",
  deploy_config: "environment files and deployment config",
  unclassifiable_path: "a path that could not be safely classified",
};

/* --------------------------------- input -------------------------------- */

export interface DecisionFacts {
  id: string;
  status: string;
  question: string;
  options: ReadonlyArray<{ label: string; consequence: string; recommended?: boolean; effect?: DecisionOptionEffect | null }>;
  /** Last-updated stamp from the record; part of the pinned state. */
  updated?: string;
}

export interface OperatorScriptFacts {
  descriptor: {
    schema: string;
    id: string;
    title: string;
    script: string;
    success: { effect: string; next?: string };
    [key: string]: unknown;
  };
  /** SHA-256 (64 lowercase hex) of the descriptor and script bytes, computed by the caller. */
  descriptorSha256: string;
  /** Optional ISO expiry from the descriptor; an expired descriptor yields no card. */
  expires_at?: string;
}

export interface PullRequestFacts {
  number: number;
  title: string;
  headSha: string;
  baseRef: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  /** Why the PR needs the operator, in one sentence. */
  why: string;
  files: ReadonlyArray<BatchFileEntry>;
  /** The PR's own changed_files count; must equal files.length or the list is truncated. */
  changedFiles: number;
}

export type CardSourceInput =
  | { kind: "decision"; decision: DecisionFacts }
  | { kind: "operator-script"; script: OperatorScriptFacts }
  | { kind: "pull-request"; pr: PullRequestFacts };

export interface GenerateCardsInput {
  sources: ReadonlyArray<unknown>;
  now: Date;
  /** ISO expiry applied to every card (a descriptor's earlier expires_at wins). */
  expires: string;
  repo?: string;
}

/* --------------------------------- output ------------------------------- */

export type CardRefusalCode =
  | "bad_input"
  | "unreadable_source"
  | "unknown_source_kind"
  | "bad_source"
  | "missing_consequence"
  | "no_options"
  | "too_many_options"
  | "text_too_long"
  | "too_many_files"
  | "files_incomplete"
  | "bad_head_sha"
  | "bad_expires"
  | "expired_descriptor"
  | "conflicting_duplicate"
  | "invalid_card"
  | "source_limit";

export interface CardRefusal {
  index: number;
  sourceKind: string | null;
  sourceId: string | null;
  code: CardRefusalCode;
  message: string;
}

export type CardSkipReason = "decision_not_open" | "pr_draft" | "pr_closed" | "pr_merged";

export interface CardSkip {
  index: number;
  sourceKind: "decision" | "pull-request";
  sourceId: string;
  reason: CardSkipReason;
}

export interface GeneratedCard {
  card: DecisionCard;
  sourceKind: CardSourceInput["kind"];
  /** Authority boundaries the PR diff touches; empty for the other sources. */
  boundaries: AuthorityBoundary[];
}

export interface CardGeneration {
  cards: GeneratedCard[];
  skipped: CardSkip[];
  refusals: CardRefusal[];
  /** Card ids of identical repeats collapsed into the first occurrence. */
  deduped: string[];
  /** True when more sources arrived than `maxSources`; the excess is refused, not read. */
  truncated: boolean;
}

/* ------------------------------- snapshot -------------------------------- */

class Unreadable extends Error {}

/**
 * One read of every value into a fresh plain copy. Only plain objects, arrays,
 * finite numbers, booleans, strings and null survive; a getter is invoked once
 * and its single result is what everything downstream sees.
 */
function snapshot(value: unknown, depth: number, budget: { n: number }): unknown {
  if (++budget.n > CARD_SOURCE_LIMITS.maxNodes) throw new Unreadable("input is too large");
  if (depth > CARD_SOURCE_LIMITS.maxDepth) throw new Unreadable("input is nested too deeply");
  if (value === null || typeof value === "boolean" || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > CARD_SOURCE_LIMITS.maxStringLength) throw new Unreadable("a string is too long");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Unreadable("a number is not finite");
    return value;
  }
  if (Array.isArray(value)) {
    const length = value.length;
    if (length > CARD_SOURCE_LIMITS.maxFiles + 1) throw new Unreadable("an array is too long");
    const out: unknown[] = [];
    for (let i = 0; i < length; i++) out.push(snapshot(value[i], depth + 1, budget));
    return out;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) throw new Unreadable("only plain objects are accepted");
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (key === "__proto__") throw new Unreadable("a reserved key is present");
      Object.defineProperty(out, key, {
        value: snapshot((value as Record<string, unknown>)[key], depth + 1, budget),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  throw new Unreadable("an unsupported value type is present");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.replace(/[\s\p{Cf}\p{Cc}]/gu, "") !== "";
const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Deterministic encoding: sorted keys, no whitespace; no clock, no randomness. */
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`)
    .join(",")}}`;
}

const fingerprint = (kind: string, id: string, state: unknown): string =>
  createHash("sha256").update(`arcadia-card-source-v1\n${kind}\n${id}\n${canonical(state)}`).digest("hex");

/* ------------------------------ per source ------------------------------ */

type Built =
  | { ok: true; id: string; sourceKind: CardSourceInput["kind"]; candidate: Record<string, unknown>; stateKey: string; boundaries: AuthorityBoundary[] }
  | { ok: false; id: string | null; code: CardRefusalCode; message: string }
  | { ok: "skip"; id: string; sourceKind: "decision" | "pull-request"; reason: CardSkipReason };

const refuse = (id: string | null, code: CardRefusalCode, message: string): Built => ({ ok: false, id, code, message });

function overLimit(text: string, max: number): boolean {
  return text.length > max;
}

function earliest(a: string, b: string | null): string {
  if (b === null) return a;
  return (parseCardExpiry(b) as number) < (parseCardExpiry(a) as number) ? b : a;
}

function buildDecision(raw: unknown, expires: string): Built {
  if (!isRecord(raw)) return refuse(null, "bad_source", "decision must be an object");
  const id = raw.id;
  if (typeof id !== "string" || !ID_RE.test(id)) return refuse(null, "bad_source", "decision id must be a simple slug");
  if (raw.status !== "open") return { ok: "skip", id: `decision-${id}`, sourceKind: "decision", reason: "decision_not_open" };
  if (!nonEmpty(raw.question)) return refuse(`decision-${id}`, "bad_source", "decision has no question");
  const what = `Answer Decision ${id}: ${raw.question}`;
  if (overLimit(what, DECISION_CARD_LIMITS.what)) {
    return refuse(`decision-${id}`, "text_too_long", `The Decision question exceeds ${DECISION_CARD_LIMITS.what} characters; refused, not truncated.`);
  }
  if (!Array.isArray(raw.options) || raw.options.length === 0) {
    return refuse(`decision-${id}`, "no_options", "The Decision offers no options to answer between.");
  }
  if (raw.options.length > DECISION_CARD_LIMITS.maxOptions) {
    return refuse(`decision-${id}`, "too_many_options", `The Decision has more than ${DECISION_CARD_LIMITS.maxOptions} options.`);
  }
  const options: Array<{ id: string; label: string; consequence: string }> = [];
  const stateOptions: unknown[] = [];
  for (let i = 0; i < raw.options.length; i++) {
    const o: unknown = raw.options[i];
    if (!isRecord(o) || !nonEmpty(o.label)) return refuse(`decision-${id}`, "bad_source", `option ${i + 1} has no label`);
    if (!nonEmpty(o.consequence)) {
      return refuse(`decision-${id}`, "missing_consequence", `option ${i + 1} states no consequence; a card must show what each choice does.`);
    }
    if (overLimit(o.label, DECISION_CARD_LIMITS.label) || overLimit(o.consequence, DECISION_CARD_LIMITS.consequence)) {
      return refuse(`decision-${id}`, "text_too_long", `option ${i + 1} text exceeds its limit; refused, not truncated.`);
    }
    const effect = o.effect ?? null;
    if (effect !== null && !nonEmpty(effect)) return refuse(`decision-${id}`, "bad_source", `option ${i + 1} effect must be a non-empty string or absent`);
    // What the operator reads is what the pin binds: the machine effect is rendered.
    const shown = effect === null ? o.consequence : `${o.consequence} [effect: ${effect}]`;
    if (overLimit(shown, DECISION_CARD_LIMITS.consequence)) {
      return refuse(`decision-${id}`, "text_too_long", `option ${i + 1} consequence with its effect exceeds its limit; refused, not truncated.`);
    }
    options.push({ id: `option-${i + 1}`, label: o.label, consequence: shown });
    stateOptions.push({ label: o.label, consequence: o.consequence, recommended: o.recommended === true, effect });
  }
  const cardId = `decision-${id}`;
  const stateHash = fingerprint("decision", id, {
    id,
    status: raw.status,
    question: raw.question,
    options: stateOptions,
    updated: typeof raw.updated === "string" ? raw.updated : null,
  });
  return {
    ok: true,
    id: cardId,
    sourceKind: "decision",
    boundaries: [],
    stateKey: stateHash,
    candidate: {
      schema: DECISION_CARD_SCHEMA,
      id: cardId,
      kind: "decision",
      what,
      options,
      evidence: [{ label: `Decision ${id}`, fingerprint: stateHash }],
      verb: "answer",
      pins: { stateHash },
      expires,
      policy_match: null,
      receipt: null,
    },
  };
}

function buildScript(raw: unknown, now: number, expires: string): Built {
  if (!isRecord(raw) || !isRecord(raw.descriptor)) return refuse(null, "bad_source", "operator-script needs a descriptor object");
  const d = raw.descriptor;
  const id = d.id;
  if (d.schema !== "arcadia-operator-script-v1" || typeof id !== "string" || !ID_RE.test(id)) {
    return refuse(null, "bad_source", "descriptor schema or id is not an arcadia-operator-script-v1 entry");
  }
  const cardId = `script-${id}`;
  if (!nonEmpty(d.title) || typeof d.script !== "string" || d.script !== `${id}.sh`) {
    return refuse(cardId, "bad_source", "descriptor title or script name is incomplete");
  }
  if (typeof raw.descriptorSha256 !== "string" || !SHA256_RE.test(raw.descriptorSha256)) {
    return refuse(cardId, "bad_source", "descriptorSha256 must be 64 lowercase hex characters");
  }
  let cardExpires = expires;
  if (raw.expires_at !== undefined && raw.expires_at !== null) {
    const ms = parseCardExpiry(raw.expires_at);
    if (ms === null) return refuse(cardId, "bad_expires", "descriptor expires_at is not strict ISO-8601 with an offset");
    if (ms <= now) return refuse(cardId, "expired_descriptor", "The descriptor has expired; no card is generated for it.");
    cardExpires = earliest(expires, raw.expires_at as string);
  }
  const success = d.success;
  const consequence = isRecord(success) ? success.effect : undefined;
  if (!nonEmpty(consequence)) {
    return refuse(cardId, "missing_consequence", "The descriptor states no success effect; a card must show what pressing does.");
  }
  const what = `Run operator script: ${d.title}`;
  if (overLimit(what, DECISION_CARD_LIMITS.what) || overLimit(consequence, DECISION_CARD_LIMITS.consequence)) {
    return refuse(cardId, "text_too_long", "Descriptor title or effect exceeds the card limit; refused, not truncated.");
  }
  const state = {
    id,
    title: d.title,
    script: d.script,
    descriptorSha256: raw.descriptorSha256,
    effect: consequence,
    expires_at: typeof raw.expires_at === "string" ? raw.expires_at : null,
  };
  const stateHash = fingerprint("operator-script", id, state);
  return {
    ok: true,
    id: cardId,
    sourceKind: "operator-script",
    boundaries: [],
    stateKey: stateHash,
    candidate: {
      schema: DECISION_CARD_SCHEMA,
      id: cardId,
      kind: "operator-script",
      what,
      options: [
        { id: "run", label: `Run ${d.title}`, consequence },
        { id: "skip", label: "Do not run", consequence: "The script does not run; it stays in the library and the card stays open until it expires or the descriptor changes." },
      ],
      evidence: [{ label: `Descriptor ${id}`, fingerprint: raw.descriptorSha256 }],
      verb: "run",
      pins: { stateHash, previewFingerprint: raw.descriptorSha256 },
      expires: cardExpires,
      policy_match: null,
      receipt: null,
    },
  };
}

function fileNames(entry: unknown): { filename: string; previous: string | null } | null {
  if (typeof entry === "string") return { filename: entry, previous: null };
  if (!isRecord(entry) || typeof entry.filename !== "string") return null;
  const prev = entry.previous_filename;
  if (prev === undefined || prev === null) return { filename: entry.filename, previous: null };
  return typeof prev === "string" ? { filename: entry.filename, previous: prev } : null;
}

function buildPr(raw: unknown, repo: string, expires: string): Built {
  if (!isRecord(raw)) return refuse(null, "bad_source", "pull request must be an object");
  const n = raw.number;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) return refuse(null, "bad_source", "PR number must be a positive integer");
  const cardId = `pr-${n}`;
  if (raw.state !== "open" && raw.state !== "closed" && raw.state !== "merged") return refuse(cardId, "bad_source", "PR state must be open, closed or merged");
  if (typeof raw.draft !== "boolean") return refuse(cardId, "bad_source", "PR draft must be a boolean");
  if (raw.state === "merged") return { ok: "skip", id: cardId, sourceKind: "pull-request", reason: "pr_merged" };
  if (raw.state === "closed") return { ok: "skip", id: cardId, sourceKind: "pull-request", reason: "pr_closed" };
  if (raw.draft) return { ok: "skip", id: cardId, sourceKind: "pull-request", reason: "pr_draft" };
  if (!isPinnedHeadSha(raw.headSha)) return refuse(cardId, "bad_head_sha", "PR head must be a 40-character lowercase hex sha.");
  if (!nonEmpty(raw.title) || !nonEmpty(raw.why) || !nonEmpty(raw.baseRef)) return refuse(cardId, "bad_source", "PR title, why and baseRef are required");
  if (!Array.isArray(raw.files)) return refuse(cardId, "bad_source", "PR files must be a list");
  if (raw.files.length > CARD_SOURCE_LIMITS.maxFiles) {
    return refuse(cardId, "too_many_files", `The diff lists more than ${CARD_SOURCE_LIMITS.maxFiles} files; it cannot be classified completely.`);
  }
  if (typeof raw.changedFiles !== "number" || !Number.isSafeInteger(raw.changedFiles) || raw.changedFiles < 1 || raw.changedFiles !== raw.files.length) {
    return refuse(cardId, "files_incomplete", "changedFiles must be a safe integer equal to the listed files; the diff may be truncated, so its boundaries cannot be named.");
  }
  const names: Array<{ filename: string; previous: string | null }> = [];
  for (const f of raw.files) {
    const parsed = fileNames(f);
    if (parsed === null) return refuse(cardId, "bad_source", "a PR file entry is not a path or {filename, previous_filename}");
    if (parsed.filename.length > CARD_SOURCE_LIMITS.maxPathLength || (parsed.previous?.length ?? 0) > CARD_SOURCE_LIMITS.maxPathLength) {
      return refuse(cardId, "text_too_long", "a PR file path exceeds the path limit.");
    }
    names.push(parsed);
  }
  const head = raw.headSha;
  const boundaries = classifyAuthorityPaths(
    names.map((f) => (f.previous === null ? f.filename : { filename: f.filename, previous_filename: f.previous })),
  );
  const named = boundaries.map((b) => PR_CARD_BOUNDARY_MEANING[b]).join("; ");
  const boundaryText = boundaries.length === 0 ? "touches no authority boundary" : `touches authority boundary: ${named}`;
  const what = `Merge PR #${n} "${raw.title}" into ${raw.baseRef}: ${raw.why}`;
  if (overLimit(what, DECISION_CARD_LIMITS.what)) {
    return refuse(cardId, "text_too_long", `The PR title and reason exceed ${DECISION_CARD_LIMITS.what} characters; refused, not truncated.`);
  }
  const consequence = `Merges #${n} at head ${head.slice(0, 12)} into ${raw.baseRef}; ${boundaryText}. A merge cannot be undone by this card.`;
  if (overLimit(consequence, DECISION_CARD_LIMITS.consequence)) {
    return refuse(cardId, "text_too_long", "The merge consequence exceeds the card limit; refused, not truncated.");
  }
  const files = names
    .map((f) => ({ filename: f.filename, previous_filename: f.previous }))
    .sort((a, b) => {
      const x = a.filename + "\u0000" + (a.previous_filename ?? "");
      const y = b.filename + "\u0000" + (b.previous_filename ?? "");
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const stateHash = fingerprint("pull-request", cardId, {
    repo,
    number: n,
    title: raw.title,
    why: raw.why,
    baseRef: raw.baseRef,
    headSha: head,
    state: raw.state,
    draft: raw.draft,
    changedFiles: raw.changedFiles,
    files,
  });
  return {
    ok: true,
    id: cardId,
    sourceKind: "pull-request",
    boundaries,
    stateKey: stateHash,
    candidate: {
      schema: DECISION_CARD_SCHEMA,
      id: cardId,
      kind: "pr-merge",
      what,
      options: [
        { id: "merge", label: `Merge #${n}`, consequence },
        { id: "hold", label: "Hold", consequence: "Nothing merges; the card stays open until it expires or the head moves." },
      ],
      evidence: [
        {
          label: boundaries.length === 0 ? "No authority boundary touched" : `Authority boundary: ${boundaries.join(", ")}`,
          url: `https://github.com/${repo}/pull/${n}`,
          fingerprint: head,
        },
      ],
      verb: "merge",
      pins: { stateHash, headSha: head },
      expires,
      policy_match: null,
      receipt: null,
    },
  };
}

/* ------------------------------- generation ------------------------------ */

/**
 * Turn injected source facts into validated decision cards. Never throws and
 * never mutates its input.
 */
export function generateCardsFromSources(input: GenerateCardsInput): CardGeneration {
  const out: CardGeneration = { cards: [], skipped: [], refusals: [], deduped: [], truncated: false };
  const bad = (message: string): CardGeneration => {
    out.refusals.push({ index: -1, sourceKind: null, sourceId: null, code: "bad_input", message });
    return out;
  };
  let snap: { sources: unknown[]; expires: unknown; repo: unknown };
  let nowMs = Number.NaN;
  try {
    // One read of `now`, through the intrinsic: a Proxy or subclass trick refuses, never throws.
    nowMs = Date.prototype.getTime.call(input?.now);
    const shot = snapshot(
      { sources: input?.sources, expires: input?.expires, repo: input?.repo },
      0,
      { n: 0 },
    ) as { sources: unknown; expires: unknown; repo: unknown };
    if (!Array.isArray(shot.sources)) return bad("sources must be a list");
    snap = { sources: shot.sources, expires: shot.expires, repo: shot.repo };
  } catch (error) {
    return bad(error instanceof Unreadable ? error.message : "input could not be read safely (is now a real Date?)");
  }
  if (!Number.isFinite(nowMs)) return bad("now must be a valid Date");
  if (typeof snap.expires !== "string" || parseCardExpiry(snap.expires) === null) return bad("expires must be strict ISO-8601 with an offset");
  const repo = snap.repo === undefined ? DEFAULT_CARD_REPO : snap.repo;
  if (!isRepoSlug(repo)) return bad("repo must be owner/name");
  const now = new Date(nowMs);

  let sources = snap.sources;
  if (sources.length > CARD_SOURCE_LIMITS.maxSources) {
    out.truncated = true;
    out.refusals.push({
      index: CARD_SOURCE_LIMITS.maxSources,
      sourceKind: null,
      sourceId: null,
      code: "source_limit",
      message: `${sources.length - CARD_SOURCE_LIMITS.maxSources} sources beyond the ${CARD_SOURCE_LIMITS.maxSources} limit were not read.`,
    });
    sources = sources.slice(0, CARD_SOURCE_LIMITS.maxSources);
  }

  const seen = new Map<string, { stateKey: string }>();
  const conflicted = new Set<string>();
  sources.forEach((src, index) => {
    const kind = isRecord(src) && typeof src.kind === "string" ? src.kind : null;
    let built: Built;
    if (kind === "decision") built = buildDecision((src as Record<string, unknown>).decision, snap.expires as string);
    else if (kind === "operator-script") built = buildScript((src as Record<string, unknown>).script, nowMs, snap.expires as string);
    else if (kind === "pull-request") built = buildPr((src as Record<string, unknown>).pr, repo, snap.expires as string);
    else {
      out.refusals.push({ index, sourceKind: kind, sourceId: null, code: "unknown_source_kind", message: "source kind must be decision, operator-script or pull-request" });
      return;
    }
    if (built.ok === "skip") {
      out.skipped.push({ index, sourceKind: built.sourceKind, sourceId: built.id, reason: built.reason });
      return;
    }
    if (!built.ok) {
      out.refusals.push({ index, sourceKind: kind, sourceId: built.id, code: built.code, message: built.message });
      return;
    }
    const prior = seen.get(built.id);
    if (prior !== undefined) {
      if (prior.stateKey === built.stateKey) {
        out.deduped.push(built.id);
        return;
      }
      // Two different states claim one id: neither can be trusted.
      conflicted.add(built.id);
      out.refusals.push({ index, sourceKind: kind, sourceId: built.id, code: "conflicting_duplicate", message: `${built.id} appears with two different states.` });
      return;
    }
    const validated = validateDecisionCard(built.candidate, { now });
    if (!validated.ok) {
      seen.set(built.id, { stateKey: built.stateKey });
      out.refusals.push({
        index,
        sourceKind: kind,
        sourceId: built.id,
        code: "invalid_card",
        message: `The card did not validate: ${validated.errors.map((e) => `${e.code} at ${e.path}`).join(", ")}.`,
      });
      return;
    }
    seen.set(built.id, { stateKey: built.stateKey });
    out.cards.push({ card: validated.card, sourceKind: built.sourceKind, boundaries: built.boundaries });
  });

  if (conflicted.size > 0) {
    out.cards = out.cards.filter((c) => !conflicted.has(c.card.id));
  }
  // An id that was skipped or refused by one source and carded by another is a
  // contradiction regardless of order: no card, both outcomes stay reported.
  const blocked = new Set<string>();
  for (const k of out.skipped) blocked.add(k.sourceId);
  for (const r of out.refusals) if (r.sourceId !== null) blocked.add(r.sourceId);
  for (const c of out.cards.filter((x) => blocked.has(x.card.id))) {
    out.refusals.push({
      index: -1,
      sourceKind: c.sourceKind,
      sourceId: c.card.id,
      code: "conflicting_duplicate",
      message: `${c.card.id} was generated by one source and skipped or refused by another; no card is issued.`,
    });
  }
  out.cards = out.cards.filter((c) => !blocked.has(c.card.id));
  return out;
}

/** Exposed so tests and callers can assert the documented list is complete. */
export const PR_CARD_BOUNDARIES: readonly AuthorityBoundary[] = AUTHORITY_BOUNDARIES;

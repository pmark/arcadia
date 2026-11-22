import type { CapsulePr } from "./capsule.js";

/** One PR comment as the capsule reads it: the body (never stored) and its browsable link. */
export interface GateComment { body: string; html_url: string }

export interface GateInput {
  /** The PR's full head sha, or null when the PR could not be read. */
  head: string | null;
  isDraft: boolean;
  /** Oldest first. Only independent-review markers and `Arcadia worker:` comments are looked at. */
  comments: GateComment[];
  checks: CapsulePr["checks"];
  mergeState: string | null;
  /** A merge-freeze refusal message, or null. `readPrFromGh` always passes null: the freeze is applied after the PR cache. */
  freeze: string | null;
}

interface Marker { sha: string; verdict: string | null; next: string | null; tail: string | null; body: string; url: string }

const MARKER_LINE = /^[*_\s]*Independent review, head ([0-9a-f]{7,40})(.*)$/i;
const VERDICT = /^[\s*_`]*:[\s*_`]*([A-Za-z]+)(?:[*_`]*\s+([A-Za-z]+))?/;
const PASS_TAIL = /^[\s*_`]*:[\s*_`]*PASS[\s*_`]*[—–-]+\s*(.*)$/i;
const BLOCKING_LINE = /^(?:Blocking findings?\b|Blocking:)[\s:*_`(-]*([A-Za-z0-9]*)/i;

/** R0: a marker is a comment with a line that opens with the marker text; a quotation mid-text is not one. */
function parseMarker(comment: GateComment): Marker | null {
  for (const line of comment.body.split(/\r?\n/)) {
    const found = MARKER_LINE.exec(line);
    if (!found) continue;
    const verdict = VERDICT.exec(found[2]);
    return { sha: found[1], verdict: verdict?.[1].toUpperCase() ?? null, next: verdict?.[2]?.toUpperCase() ?? null, tail: PASS_TAIL.exec(found[2])?.[1] ?? null, body: comment.body, url: comment.html_url };
  }
  return null;
}

/** R4: the governed worker's FAIL comment opens with `Arcadia worker: `, says `**Do not merge` and names the head in backticks. */
function isWorkerFail(body: string, head: string): boolean {
  if (!/^\s*Arcadia worker: /.test(body) || !body.includes("**Do not merge")) return false;
  return [...body.matchAll(/`([0-9a-f]{7,40})`/g)].some((named) => head.startsWith(named[1]));
}

/** R2: a line that, stripped of leading markdown, opens `Blocking finding` or `Blocking:` blocks unless the next word is none, 0 or no. */
function hasBlockingLine(body: string): boolean {
  return body.split(/\r?\n/).some((line) => {
    const found = BLOCKING_LINE.exec(line.replace(/^[*_`\->#\s]+/, ""));
    return found !== null && !["none", "0", "no"].includes(found[1].toLowerCase());
  });
}

/** R5: the phrase must read "no" on an anchored line, or in the marker line's own `PASS —` tail; any "yes" or no mention is not "no". */
function readsNo(marker: Marker, phrase: string): boolean {
  const values = [...marker.body.matchAll(new RegExp(`^\\s*[*_\`-]*\\s*${phrase}:\\s*(no|yes)\\b`, "gim"))].map((found) => found[1].toLowerCase());
  for (const sentence of (marker.tail ?? "").split(/[.;]\s*/)) {
    const found = new RegExp(`^${phrase}:\\s*(no|yes)\\b`, "i").exec(sentence.trim());
    if (found) values.push(found[1].toLowerCase());
  }
  return values.length > 0 && values.every((value) => value === "no");
}

/**
 * Pure and advisory: the one-line gate for a PR, `<word>: <reason>`, the first match winning in this order: unknown, blocked, waiting,
 * frozen, operator, ready. It reads Decision 0230's list without applying it and grants nothing; the merger re-checks the list itself.
 */
export function deriveGate(input: GateInput): string {
  const { head } = input;
  if (!head) return "unknown: the PR is unreadable (no head sha)";
  const short = head.slice(0, 12);
  const worker = input.comments.find((comment) => isWorkerFail(comment.body, head));
  if (worker) return `blocked: worker FAIL on ${short} ${worker.html_url}`;
  const markers = input.comments.flatMap((comment) => parseMarker(comment) ?? []);
  const exact = markers.filter((marker) => head.startsWith(marker.sha)).at(-1);
  if (exact?.verdict === "FAIL") return `blocked: review FAIL on ${short} ${exact.url}`;
  if (exact && hasBlockingLine(exact.body)) return `blocked: review names a blocking finding on ${short} ${exact.url}`;
  if (input.checks === "fail") return "blocked: checks failing";
  if (input.isDraft) return "waiting: draft";
  if (!exact) {
    const newest = markers.at(-1);
    return `waiting: no review marker for head ${short}${newest ? ` (newest marker names ${newest.sha.slice(0, 12)})` : ""}`;
  }
  if (exact.sha.length !== 40) return "waiting: marker sha not full";
  if (exact.verdict !== "PASS" || exact.next === "WITH") return `waiting: verdict not PASS (${exact.verdict ?? "none"}${exact.next === "WITH" ? " WITH" : ""}) ${exact.url}`;
  if (input.checks !== "pass") return `waiting: checks ${input.checks}`;
  if (input.mergeState !== "CLEAN") return `waiting: merge state ${input.mergeState ?? "unknown"}`;
  if (input.freeze !== null) return `frozen: ${input.freeze}`;
  if (!readsNo(exact, "Loosens a gate") || !readsNo(exact, "Changes agent authority")) return `operator: PASS ${exact.url} lacks "Loosens a gate: no" and "Changes agent authority: no"; the merge is the operator's`;
  return `ready: ${exact.url}`;
}

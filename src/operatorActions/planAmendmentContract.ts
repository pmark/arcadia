import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

/** Version 1 is deliberately one existing Action, with no activation or queue flags. */
export interface PlanAmendmentInput {
  schema: "arcadia-plan-amendment-v1";
  checkout: { path: string; origin: string; branch: string; reviewedBase: string };
  ask: { path: string; sha256: string; proposal: string };
  settlement: { requestId: string; disposition: "accepted"; operator: true };
  envelope: {
    project: string;
    plan: string;
    action: string;
    projectUnchanged: Record<string, unknown>;
    planUnchanged: Record<string, unknown>;
    actionBefore: Record<string, unknown>;
    actionAfter: Record<string, unknown>;
    noChange: string[];
  };
  publication: { remote: "origin"; branch: string };
}
export class Refusal extends Error {
  constructor(public reason: string, message: string, public next: string) { super(message); }
}
export function refuse(reason: string, message: string, next = "Restore the named precondition and retry this same action; do not substitute another proposal."): never {
  throw new Refusal(reason, message, next);
}
export const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function exactKeys(value: object, keys: string[], label: string): void {
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), keys.sort())) refuse("INVALID_CONTRACT", `${label} has unsupported or missing fields.`);
}
function difference(actual: unknown, expected: unknown, label: string): string {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${label}.length: expected ${expected.length}, received ${actual.length}`;
    for (let index = 0; index < expected.length; index++) {
      if (!isDeepStrictEqual(actual[index], expected[index])) return difference(actual[index], expected[index], `${label}[${index}]`);
    }
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(e), ...Object.keys(a)])]) {
      if (!isDeepStrictEqual(a[key], e[key])) return difference(a[key], e[key], `${label}.${key}`);
    }
  }
  const short = (value: unknown) => {
    const text = JSON.stringify(value) ?? "missing";
    return text.length > 200 ? `${text.slice(0, 200)}… (sha256 ${hash(text)})` : text;
  };
  return `${label}: expected ${short(expected)}, received ${short(actual)}`;
}
export function equal(actual: unknown, expected: unknown, reason: string, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) refuse(reason, difference(actual, expected, label),
    "Review the named difference and restore it, or publish a newly reviewed envelope. This click changed no unvalidated governance.");
}
export function fieldsMatch(fields: Record<string, unknown>, pinned: Record<string, unknown>, label: string): void {
  for (const [key, value] of Object.entries(pinned)) equal(fields[key], value, "TARGET_STATE_DRIFT", `${label}.${key}`);
}
export function validatePlanAmendmentInput(input: PlanAmendmentInput): void {
  exactKeys(input, ["schema", "checkout", "ask", "settlement", "envelope", "publication"], "Runner input");
  equal(input.schema, "arcadia-plan-amendment-v1", "INVALID_CONTRACT", "Runner version");
  exactKeys(input.checkout, ["path", "origin", "branch", "reviewedBase"], "Checkout");
  exactKeys(input.ask, ["path", "sha256", "proposal"], "Ask");
  exactKeys(input.settlement, ["requestId", "disposition", "operator"], "Settlement flags");
  exactKeys(input.publication, ["remote", "branch"], "Publication");
  exactKeys(input.envelope, ["project", "plan", "action", "projectUnchanged", "planUnchanged", "actionBefore", "actionAfter", "noChange"], "Envelope");
  for (const value of [input.ask.proposal, input.settlement.requestId, input.envelope.project, input.envelope.plan, input.envelope.action]) {
    if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) refuse("INVALID_CONTRACT", "Pinned identifiers must be lowercase slugs.");
  }
  equal(input.settlement.disposition, "accepted", "INVALID_CONTRACT", "Disposition");
  equal(input.settlement.operator, true, "INVALID_CONTRACT", "Operator authority");
  equal(input.publication.remote, "origin", "INVALID_CONTRACT", "Publication remote");
  equal(input.publication.branch, input.checkout.branch, "INVALID_CONTRACT", "Publication branch");
  if (!/^[a-f0-9]{40}$/.test(input.checkout.reviewedBase) || !/^[a-f0-9]{64}$/.test(input.ask.sha256)) refuse("INVALID_CONTRACT", "Reviewed base or Ask hash is invalid.");
  const e = input.envelope;
  fieldsMatch(e.projectUnchanged, { slug: e.project }, "Pinned Project");
  fieldsMatch(e.planUnchanged, { slug: e.plan, project: e.project }, "Pinned Plan");
  for (const key of ["active_plan", "current_action"]) {
    if (!(key in e.projectUnchanged)) refuse("INVALID_CONTRACT", `Project no-change envelope omits ${key}.`);
  }
  for (const key of ["status", "current_action", "milestone"]) {
    if (!(key in e.planUnchanged)) refuse("INVALID_CONTRACT", `Plan no-change envelope omits ${key}.`);
  }
  for (const key of ["id", "responsibility", "status", "title", "decisions", "clarification"]) {
    if (!e.noChange.includes(key) || !(key in e.actionBefore)) refuse("INVALID_CONTRACT", `Action no-change envelope omits ${key}.`);
  }
  for (const key of e.noChange) equal(e.actionAfter[key], e.actionBefore[key], "INVALID_CONTRACT", `Preserved Action.${key}`);
  equal(e.actionBefore.id, e.action, "INVALID_CONTRACT", "Action id");
  const acceptance = e.actionAfter.acceptance_criteria;
  if (!Array.isArray(acceptance) || !acceptance.length || !acceptance.every((item) => typeof item === "string" && item.trim())) refuse("INVALID_CONTRACT", "Acceptance replacement must contain observable criteria.");
}

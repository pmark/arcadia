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

/**
 * Version 1 activates exactly one draft Plan at one first Action, returns the
 * previously active Plan to draft, and places the new Project segment at the
 * queue top. Every before-image and after-image is pinned; `null` means absent.
 */
export interface PlanActivationInput {
  schema: "arcadia-plan-activation-v1";
  checkout: { path: string; origin: string; branch: string; reviewedBase: string };
  ask: { path: string; sha256: string; proposal: string };
  settlement: { requestId: string; disposition: "accepted"; operator: true; activate: true; action: string; model: string; effort: string; placement: "top" };
  envelope: {
    project: string;
    plan: string;
    previousPlan: string;
    action: string;
    log: string;
    projectBefore: Record<string, unknown>;
    projectAfter: Record<string, unknown>;
    planBefore: Record<string, unknown>;
    planAfter: Record<string, unknown>;
    previousPlanBefore: Record<string, unknown>;
    previousPlanAfter: Record<string, unknown>;
    actionUnchanged: Record<string, unknown>;
    queueSegment: string[];
  };
  publication: { remote: "origin"; branch: string };
}
/** Pinned images treat `null` as an absent frontmatter field, as settlement writes it. */
export function pinnedFieldsMatch(fields: Record<string, unknown>, pinned: Record<string, unknown>, label: string, reason = "TARGET_STATE_DRIFT"): void {
  for (const [key, value] of Object.entries(pinned)) equal(fields[key] ?? null, value, reason, `${label}.${key}`);
}
export function validatePlanActivationInput(input: PlanActivationInput): void {
  exactKeys(input, ["schema", "checkout", "ask", "settlement", "envelope", "publication"], "Runner input");
  equal(input.schema, "arcadia-plan-activation-v1", "INVALID_CONTRACT", "Runner version");
  exactKeys(input.checkout, ["path", "origin", "branch", "reviewedBase"], "Checkout");
  exactKeys(input.ask, ["path", "sha256", "proposal"], "Ask");
  exactKeys(input.settlement, ["requestId", "disposition", "operator", "activate", "action", "model", "effort", "placement"], "Settlement flags");
  exactKeys(input.publication, ["remote", "branch"], "Publication");
  const e = input.envelope;
  exactKeys(e, ["project", "plan", "previousPlan", "action", "log", "projectBefore", "projectAfter", "planBefore", "planAfter", "previousPlanBefore", "previousPlanAfter", "actionUnchanged", "queueSegment"], "Envelope");
  for (const value of [input.ask.proposal, input.settlement.requestId, e.project, e.plan, e.previousPlan, e.action]) {
    if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) refuse("INVALID_CONTRACT", "Pinned identifiers must be lowercase slugs.");
  }
  if (e.plan === e.previousPlan) refuse("INVALID_CONTRACT", "Activation requires a different Plan from the active one.");
  const s = input.settlement;
  equal([s.disposition, s.operator, s.activate, s.placement], ["accepted", true, true, "top"], "INVALID_CONTRACT", "Activation flags");
  equal(s.action, e.action, "INVALID_CONTRACT", "Activation first Action");
  if (typeof s.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(s.model)) refuse("INVALID_CONTRACT", "Activation model must be a CLI model identifier.");
  if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(s.effort)) refuse("INVALID_CONTRACT", "Activation effort is unsupported.");
  equal(input.publication.remote, "origin", "INVALID_CONTRACT", "Publication remote");
  equal(input.publication.branch, input.checkout.branch, "INVALID_CONTRACT", "Publication branch");
  if (!/^[a-f0-9]{40}$/.test(input.checkout.reviewedBase) || !/^[a-f0-9]{64}$/.test(input.ask.sha256)) refuse("INVALID_CONTRACT", "Reviewed base or Ask hash is invalid.");
  if (typeof e.log !== "string" || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md$/.test(e.log)) refuse("INVALID_CONTRACT", "Log must be a repository-relative Markdown path.");
  exactKeys(e.projectBefore, ["slug", "active_plan", "current_action", "milestone"], "Project before-image");
  exactKeys(e.planBefore, ["slug", "project", "status", "current_action", "milestone"], "Plan before-image");
  exactKeys(e.previousPlanBefore, ["slug", "project", "status", "current_action"], "Previous Plan before-image");
  exactKeys(e.actionUnchanged, ["id", "title", "status", "responsibility", "clarification"], "First Action");
  equal([e.projectBefore.slug, e.projectBefore.active_plan], [e.project, e.previousPlan], "INVALID_CONTRACT", "Project before-image");
  equal([e.planBefore.slug, e.planBefore.project, e.planBefore.status], [e.plan, e.project, "draft"], "INVALID_CONTRACT", "Plan before-image");
  equal([e.previousPlanBefore.slug, e.previousPlanBefore.project, e.previousPlanBefore.status, e.previousPlanBefore.current_action],
    [e.previousPlan, e.project, "active", e.projectBefore.current_action], "INVALID_CONTRACT", "Previous Plan before-image");
  if (typeof e.planBefore.milestone !== "string" || !e.planBefore.milestone.trim()) refuse("INVALID_CONTRACT", "The activated Plan must carry its Milestone.");
  equal(e.projectAfter, { active_plan: e.plan, current_action: e.action, milestone: e.planBefore.milestone }, "INVALID_CONTRACT", "Project after-image");
  equal(e.planAfter, { status: "active", current_action: e.action, recommended_model: s.model, recommended_reasoning_effort: s.effort }, "INVALID_CONTRACT", "Plan after-image");
  equal(e.previousPlanAfter, { status: "draft", current_action: null }, "INVALID_CONTRACT", "Previous Plan after-image");
  equal(e.actionUnchanged.id, e.action, "INVALID_CONTRACT", "First Action id");
  if (e.actionUnchanged.status === "done" || !["agent", "autonomous"].includes(String(e.actionUnchanged.responsibility)) || e.actionUnchanged.clarification !== "clarified") {
    refuse("INVALID_CONTRACT", "The first Action must be unfinished, clarified and agent or autonomous-owned.");
  }
  const segment = e.queueSegment;
  if (!Array.isArray(segment) || !segment.length || new Set(segment).size !== segment.length ||
      !segment.every((key) => typeof key === "string" && key.startsWith(`${e.project}/`) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key.slice(e.project.length + 1))) ||
      !segment.includes(`${e.project}/${e.action}`)) {
    refuse("INVALID_CONTRACT", "Queue segment must list distinct Project Action keys including the first Action.");
  }
}

import type Database from "better-sqlite3";
import { getWorkItem, listWorkItemDependencies } from "../db/repositories.js";
import { listSplitRemainders } from "../docs/splitRemainders.js";
import type { WorkItemSummary } from "../domain/types.js";
import { completesGate, remainderOf, stepReason, unblocks, type StepReasonSource } from "./stepReason.js";
import type { GateStatus, NorthStarDocument, ResolvedGate } from "./types.js";

/**
 * The route from today to the declared target, as documented work.
 *
 * The Now screen answers "am I closer?" and "what do I do in the next hour?".
 * Neither question is the one asked while deciding whether a target is
 * reachable at all, which is "what is actually between here and there?" A gate
 * checklist cannot answer it: five checkboxes hide however many Actions stand
 * behind each one.
 *
 * This is deliberately not a task list. Every step is a projection of an
 * Action some plan document already declares, reached by walking the
 * `depends_on` edges those documents produced. Nothing can be added here, and
 * a step that disappears from a plan disappears from the path. The one thing
 * this surface adds is honesty about the parts nobody has planned yet, which a
 * checklist renders as blank space and a task list cannot render at all.
 */

export type PathStepState = "done" | "in_progress" | "blocked" | "planned";

/** Why a leg has no planned work, in the operator's terms rather than a code. */
export type PathGapReason =
  | "operator_owned"
  | "missing_action"
  | "undefined_next_move"
  | "no_declared_work";

export interface PathStep {
  kind: "action";
  workItemId: string;
  /**
   * The planned work item this step is, as `plan/<slug>#<action-id>`. It is
   * the step's link: the CLI prints it and the dashboard opens `workItemId`.
   * Null only for an Action no plan document declares.
   */
  docRef: string | null;
  title: string;
  /** One sentence on why this step is on the route. */
  reason: string;
  /** `declared` when the Action's own `why` supplied it, `derived` when the route's structure did. */
  reasonSource: StepReasonSource;
  state: PathStepState;
  nextAction: string | null;
  clarification: string | null;
  responsibility: string | null;
  projectName: string | null;
  /** Depth in the dependency walk; 0 is the gate's own Action. */
  depth: number;
}

export interface PathGap {
  kind: "gap";
  reason: PathGapReason;
  /** One sentence naming what is missing and who can supply it. */
  detail: string;
  /** Set only for `undefined_next_move`: the Action a resolution screen needs. */
  workItemId?: string;
  /** Set only for `missing_action`: the reference no plan document carries. There is nothing to link to. */
  missingRef?: string;
}

export type PathNode = PathStep | PathGap;

/** One gate, and everything documented between today and it. */
export interface PathLeg {
  gateId: string;
  gateTitle: string;
  gateStatus: GateStatus;
  actionRef: string | null;
  /** True when the gate's status came from a record rather than the document. */
  derived: boolean;
  /** Dependencies first, the gate's own Action last. */
  nodes: PathNode[];
  done: number;
  remaining: number;
}

export interface PathBrief {
  generatedAt: string;
  target: {
    declared: boolean;
    text: string;
    looksLike: string;
    /** Why this outranks everything else, in the operator's words. Empty when undeclared. */
    why: string;
    projectSlug: string | null;
    documentPath: string | null;
  };
  legs: PathLeg[];
  totals: {
    gates: number;
    gatesDone: number;
    steps: number;
    stepsDone: number;
    remaining: number;
    gaps: number;
  };
  warnings: string[];
}

/** How a step came to be on the route, which is what a derived reason says. */
type ChainOrigin =
  | { kind: "gate" }
  | { kind: "dependency"; dependentTitle: string }
  | { kind: "remainder"; parentTitle: string };

/** One entry of a walked chain: an Action, or a remainder no plan carries. */
type ChainEntry = { item: WorkItemSummary; depth: number; origin: ChainOrigin } | { missingRemainderRef: string };

/**
 * Walk the `depends_on` closure behind one Action, dependencies first, then
 * the Action, then the remainders of any split it names in `split_into`.
 *
 * Depth-first post-order is what puts a prerequisite ahead of the thing that
 * waits on it, which is the only ordering a path can honestly claim — plan
 * documents declare dependency, never dates. Cycles are possible in principle
 * because two documents can each declare the other, so visited ids terminate
 * the walk rather than trusting the data to be acyclic.
 *
 * A split Action is marked `done` for the slice it was narrowed to, and the
 * rest of its scope lives in its `split_into` remainders. That is not a
 * `depends_on` edge (see the comment in `src/ask/settlement.ts` on why), so
 * the walk follows it as its own edge and a remainder that is still open
 * shows up as a step instead of vanishing behind a `done` parent. A remainder
 * commonly depends on the Action it was split from, which `seen` already holds.
 */
function collectChain(
  db: Database.Database,
  rootId: string,
  seen: Set<string>,
  depth: number,
  out: ChainEntry[],
  origin: ChainOrigin
): void {
  if (seen.has(rootId)) return;
  seen.add(rootId);

  const item = getWorkItem(db, rootId);

  // The first Action to reach a prerequisite is the one it unblocks. A shared
  // prerequisite reached again is already `seen`, so it keeps that first reason.
  for (const dependency of listWorkItemDependencies(db, rootId)) {
    collectChain(db, dependency.workItemId, seen, depth + 1, out, {
      kind: "dependency",
      dependentTitle: item?.title ?? "a later step"
    });
  }

  if (!item) return;
  out.push({ item, depth, origin });

  for (const remainder of listSplitRemainders(db, item)) {
    if (remainder.item) {
      collectChain(db, remainder.item.id, seen, depth, out, { kind: "remainder", parentTitle: item.title });
    } else if (!seen.has(remainder.ref)) {
      seen.add(remainder.ref);
      out.push({ missingRemainderRef: remainder.ref });
    }
  }
}

function stateOf(item: WorkItemSummary): PathStepState {
  if (item.status === "done") return "done";
  if (item.status === "in_progress") return "in_progress";
  if (item.status === "blocked") return "blocked";
  return "planned";
}

/**
 * An Action whose next move is undefined is a step you cannot take, even
 * though it is written down. Saying so is the difference between a path and a
 * list of intentions.
 */
function nextMoveUndefined(item: WorkItemSummary): boolean {
  if (item.status === "done") return false;
  const clarification = item.clarification_status;
  return clarification === "unclarified" || clarification === "question_open";
}

function derivedReason(origin: ChainOrigin, gateTitle: string): string {
  switch (origin.kind) {
    case "gate":
      return completesGate(gateTitle);
    case "dependency":
      return unblocks(origin.dependentTitle);
    case "remainder":
      return remainderOf(origin.parentTitle);
  }
}

function legFor(db: Database.Database, gate: ResolvedGate): PathLeg {
  const base = {
    gateId: gate.id,
    gateTitle: gate.title,
    gateStatus: gate.status,
    actionRef: gate.actionRef,
    derived: gate.derived
  };

  if (!gate.workItemId) {
    // Two different absences, and collapsing them would hide which one this is.
    const gap: PathGap =
      gate.actionRef === null
        ? {
            kind: "gap",
            reason: gate.status === "done" ? "no_declared_work" : "operator_owned",
            detail:
              gate.status === "done"
                ? "Marked done by the operator. No Action tracked this, so there is no recorded work behind it."
                : "Operator-owned. No Action tracks this gate, so nothing here can be dispatched — you decide when it is true, with `arcadia gate complete`."
          }
        : {
            kind: "gap",
            reason: "missing_action",
            detail: `This gate tracks \`${gate.actionRef}\`, which no plan document currently carries. Either the reference is stale or the work was never written up. There is no Action to open.`,
            missingRef: gate.actionRef
          };

    return { ...base, nodes: [gap], done: gate.status === "done" ? 1 : 0, remaining: gate.status === "done" ? 0 : 1 };
  }

  const collected: ChainEntry[] = [];
  collectChain(db, gate.workItemId, new Set(), 0, collected, { kind: "gate" });

  const nodes: PathNode[] = [];
  for (const entry of collected) {
    if ("missingRemainderRef" in entry) {
      nodes.push({
        kind: "gap",
        reason: "missing_action",
        detail: `This work was split and \`${entry.missingRemainderRef}\` was named as its remainder, but no plan document currently carries it. Either the reference is stale or the remainder was never written up. There is no Action to open.`,
        missingRef: entry.missingRemainderRef
      });
      continue;
    }
    const { item, depth, origin } = entry;
    if (nextMoveUndefined(item)) {
      // The exact recorded question, not a paraphrase — a generic "not decided
      // yet" is what let an operator conflate this gap with an unrelated
      // Decision they had just answered elsewhere. Quoting it is the fix, and
      // carrying the Action id is what lets the screen offer somewhere to
      // actually answer it rather than just naming the blocker.
      const question = item.open_question?.trim();
      nodes.push({
        kind: "gap",
        reason: "undefined_next_move",
        detail: question
          ? `Blocked on one open question: "${question}"`
          : `"${item.title}" is planned but its next move is not decided yet (${item.clarification_status}). It cannot be started until that is answered.`,
        workItemId: item.id
      });
    }
    nodes.push({
      kind: "action",
      workItemId: item.id,
      docRef: item.doc_ref,
      title: item.title,
      ...stepReason(item.why, derivedReason(origin, gate.title)),
      state: stateOf(item),
      nextAction: item.next_action,
      clarification: item.clarification_status,
      responsibility: item.responsibility,
      projectName: item.project_name,
      depth
    });
  }

  const steps = nodes.filter((node): node is PathStep => node.kind === "action");
  const done = steps.filter((step) => step.state === "done").length;
  return { ...base, nodes, done, remaining: steps.length - done };
}

export function computePathBrief(
  db: Database.Database,
  northStar: NorthStarDocument | null,
  gates: ResolvedGate[]
): PathBrief {
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];

  if (!northStar) {
    return {
      generatedAt,
      target: { declared: false, text: "No target declared", looksLike: "", why: "", projectSlug: null, documentPath: null },
      legs: [],
      totals: { gates: 0, gatesDone: 0, steps: 0, stepsDone: 0, remaining: 0, gaps: 0 },
      warnings: ["No NORTH_STAR.md in this workspace, so there is no declared finish line to path toward."]
    };
  }

  const legs = gates.map((gate) => legFor(db, gate));
  const allSteps = legs.flatMap((leg) => leg.nodes.filter((node): node is PathStep => node.kind === "action"));
  const gaps = legs.flatMap((leg) => leg.nodes.filter((node) => node.kind === "gap")).length;

  if (gaps > 0) {
    warnings.push(`${gaps} point${gaps === 1 ? "" : "s"} on this path have no startable planned work.`);
  }

  return {
    generatedAt,
    target: {
      declared: true,
      text: northStar.target,
      looksLike: northStar.looksLike,
      why: northStar.why,
      projectSlug: northStar.projectSlug,
      documentPath: northStar.path
    },
    legs,
    totals: {
      gates: legs.length,
      gatesDone: legs.filter((leg) => leg.gateStatus === "done").length,
      steps: allSteps.length,
      stepsDone: allSteps.filter((step) => step.state === "done").length,
      remaining: allSteps.filter((step) => step.state !== "done").length,
      gaps
    },
    warnings
  };
}

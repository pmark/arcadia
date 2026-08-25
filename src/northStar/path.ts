import type Database from "better-sqlite3";
import { getWorkItem, listWorkItemDependencies } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";
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
  docRef: string | null;
  title: string;
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

/**
 * Walk the `depends_on` closure behind one Action, dependencies first.
 *
 * Depth-first post-order is what puts a prerequisite ahead of the thing that
 * waits on it, which is the only ordering a path can honestly claim — plan
 * documents declare dependency, never dates. Cycles are possible in principle
 * because two documents can each declare the other, so visited ids terminate
 * the walk rather than trusting the data to be acyclic.
 */
function collectChain(
  db: Database.Database,
  rootId: string,
  seen: Set<string>,
  depth: number,
  out: Array<{ item: WorkItemSummary; depth: number }>
): void {
  if (seen.has(rootId)) return;
  seen.add(rootId);

  for (const dependency of listWorkItemDependencies(db, rootId)) {
    collectChain(db, dependency.workItemId, seen, depth + 1, out);
  }

  const item = getWorkItem(db, rootId);
  if (item) out.push({ item, depth });
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
            detail: `This gate tracks \`${gate.actionRef}\`, which no plan document currently carries. Either the reference is stale or the work was never written up.`
          };

    return { ...base, nodes: [gap], done: gate.status === "done" ? 1 : 0, remaining: gate.status === "done" ? 0 : 1 };
  }

  const collected: Array<{ item: WorkItemSummary; depth: number }> = [];
  collectChain(db, gate.workItemId, new Set(), 0, collected);

  const nodes: PathNode[] = [];
  for (const { item, depth } of collected) {
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
      target: { declared: false, text: "No target declared", looksLike: "", projectSlug: null, documentPath: null },
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

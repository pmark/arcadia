import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanActionDoc, PlanDoc, ProjectDoc, ScopedOutDoc } from "../docs/types.js";
import { actionKeyOf } from "../scheduling/store.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ACTIVATION_HEADING = /^#{1,3}\s*(if not now|when this (?:becomes|activates)|activation|trigger)/i;

/** Counts of the Plan document's recorded Action statuses. */
export interface ActionCounts {
  open: number;
  in_progress: number;
  done: number;
  blocked: number;
  deferred: number;
}

export interface PlanRow {
  slug: string;
  status: string;
  /** false for a `dormant`/`proposed` plan: Arcadia does not evaluate or govern it. */
  governed: boolean;
  milestone: string | null;
  isActivePlan: boolean;
  actionCounts: ActionCounts | null;
  /** For an ungoverned plan, the paragraph under its own trigger heading, when it has one. */
  activationNote: string | null;
  relativePath: string;
}

export interface PlansCommandData {
  repoRoot: string;
  project: { slug: string; name: string; activePlan: string | null } | null;
  plans: PlanRow[];
}

/**
 * Every plan a repository holds, governed or not, and why each ungoverned one
 * has not started.
 *
 * `docket` and `next` only ever resolve the *one* current Action; a plan
 * sitting at `draft`, `dormant`, or `proposed` is invisible to both, which is
 * exactly the "I don't know what's out there" gap this closes. Reads
 * documents only, matching `docket`: this needs no workspace and says nothing
 * the checked-in repository does not already say.
 */
export function runPlansCommand(options: { repo: string; project?: string }): CommandSuccess<PlansCommandData> {
  const repoRoot = options.repo;
  const discovered = discoverDocs(repoRoot);

  const projects = discovered.docs.filter((doc): doc is ProjectDoc => doc.type === "project");
  const project = options.project
    ? projects.find((doc) => doc.slug.toLowerCase() === options.project!.toLowerCase())
    : projects[0];

  if (!project) {
    throw validationError(
      options.project
        ? `No PROJECT.md declaring slug "${options.project}" was found under ${repoRoot}.`
        : `No PROJECT.md with \`arcadia: v1\` frontmatter was found under ${repoRoot}.`,
      { repo: repoRoot, project: options.project ?? null }
    );
  }

  const governed = discovered.docs.filter(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project.toLowerCase() === project.slug.toLowerCase()
  );

  const ungoverned = discovered.docs
    .filter((doc): doc is ScopedOutDoc => doc.type === "scoped_out" && doc.sourceType === "plan")
    .map((doc) => readUngovernedPlan(doc.absolutePath, doc.relativePath, doc.sourceStatus))
    .filter((row): row is PlanRow => row !== null);

  const plans: PlanRow[] = [
    ...governed.map((plan): PlanRow => ({
      slug: plan.slug,
      status: plan.status,
      governed: true,
      milestone: plan.milestone,
      isActivePlan: project.activePlan === plan.slug,
      actionCounts: countActions(plan),
      activationNote: null,
      relativePath: plan.relativePath
    })),
    ...ungoverned
  ].sort((a, b) => a.slug.localeCompare(b.slug));

  return createSuccess({
    command: "plans",
    data: {
      repoRoot,
      project: { slug: project.slug, name: project.name, activePlan: project.activePlan },
      plans
    }
  });

  // Re-reads the file directly: `ScopedOutDoc` deliberately carries no parsed
  // fields beyond status, since Arcadia does not validate a dormant/proposed
  // plan's frontmatter. This is presentational only — never a validation claim.
  function readUngovernedPlan(absolutePath: string, relativePath: string, status: string | null): PlanRow | null {
    let raw: string;
    try {
      raw = readFileSync(absolutePath, "utf8");
    } catch {
      return null;
    }
    const match = FRONTMATTER.exec(raw);
    if (!match) {
      return null;
    }
    let front: Record<string, unknown>;
    try {
      front = (parseYaml(match[1]) as Record<string, unknown>) ?? {};
    } catch {
      return null;
    }
    const declaredProject = typeof front.project === "string" ? front.project : null;
    if (declaredProject === null || declaredProject.toLowerCase() !== project!.slug.toLowerCase()) {
      return null;
    }
    const slug = typeof front.slug === "string" ? front.slug : "";
    const milestone = typeof front.milestone === "string" ? front.milestone : null;
    const body = raw.slice(match[0].length);
    return {
      slug,
      status: status ?? "unknown",
      governed: false,
      milestone,
      isActivePlan: false,
      actionCounts: null,
      activationNote: findActivationNote(body),
      relativePath
    };
  }
}

export function countActions(plan: Pick<PlanDoc, "actions">): ActionCounts {
  const counts: ActionCounts = { open: 0, in_progress: 0, done: 0, blocked: 0, deferred: 0 };
  for (const action of plan.actions) {
    counts[action.status] += 1;
  }
  return counts;
}

/** The paragraph under this plan's own "if not now, then when?" heading, when it has one. */
function findActivationNote(body: string): string | null {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (ACTIVATION_HEADING.test(lines[i])) {
      const rest = lines
        .slice(i + 1)
        .join("\n")
        .trim();
      const paragraph = rest.split(/\r?\n\s*\r?\n/)[0]?.trim();
      return paragraph || null;
    }
  }
  return null;
}

export function renderPlansSuccess(response: CommandSuccess<PlansCommandData>): string[] {
  const { project, plans } = response.data;
  const lines: string[] = [];

  if (!project) {
    return ["No project resolved."];
  }

  lines.push(`${project.name} (${project.slug})`, `Active plan: ${project.activePlan ?? "none declared"}`, "");

  if (plans.length === 0) {
    lines.push("No plan documents found for this project.");
    return lines;
  }

  for (const plan of plans) {
    const marker = plan.isActivePlan ? "*" : " ";
    const statusLabel = plan.governed ? plan.status : `${plan.status} (ungoverned)`;
    lines.push(`${marker} ${plan.slug}  [${statusLabel}]`);
    if (plan.milestone) {
      lines.push(`    Milestone: ${plan.milestone}`);
    }
    if (plan.actionCounts) {
      const c = plan.actionCounts;
      const deferred = c.deferred > 0 ? ` · ${c.deferred} deferred` : "";
      lines.push(`    Actions: ${c.open} open · ${c.in_progress} in progress · ${c.blocked} blocked${deferred} · ${c.done} done`);
    }
    if (plan.activationNote) {
      lines.push(`    Becomes current when: ${plan.activationNote}`);
    } else if (!plan.governed) {
      lines.push(`    Becomes current when: not stated in ${plan.relativePath} — add an "If not now, then when?" trigger.`);
    }
    lines.push(`    ${plan.relativePath}`);
    lines.push("");
  }

  return lines;
}

export const PLAN_PROGRESS_SCHEMA = "arcadia-plan-progress-v1";
const NEXT_LIMIT = 5;

export interface PlanProgressAction {
  /** `<project>/<actionId>`, the key `schedule` uses (`actionKeyOf`). */
  key: string;
  /** The Plan document's recorded status, unmapped. */
  status: string;
  dependsOn: string[];
  title: string;
}

export interface PlanProgressEntry {
  key: string;
  title: string;
  status: string;
  /** Unfinished dependencies still ahead of this Action, when it has any. */
  waitingOn: string[];
}

export interface PlanProgressData {
  schema: typeof PLAN_PROGRESS_SCHEMA;
  source: { planSlug: string; planPath: string; updated: string };
  counts: ActionCounts & { total: number };
  isActivePlan: boolean;
  current: (PlanProgressEntry & { basis: "project_current_action" | "first_unfinished_ready" }) | null;
  /** Why `current` is null, when it is. */
  currentNote: string | null;
  next: PlanProgressEntry[];
  blocked: Array<PlanProgressEntry & { reason: string }>;
  actions: PlanProgressAction[];
  note: string;
}

export const PLAN_PROGRESS_NOTE =
  "Derived one-way view of the Plan document, recomputed on every call; nothing here is stored or read back. " +
  "Statuses are the Plan document's recorded statuses, not the scheduler's board statuses. " +
  "Done means the recorded Action status, not re-proven acceptance. " +
  "Ordering is plan-document order constrained by depends_on and is not the dispatch queue (use `arcadia next`).";

/**
 * One Plan's progress as a derived, workspace-free to-do view.
 *
 * Reads only PROJECT.md and the Plan document. Ordering of "next" is the Plan's
 * own document order, held back until an Action's unfinished prerequisites are
 * placed ahead of it; it is a reading aid, never the dispatch queue.
 */
export function runPlanProgressCommand(options: {
  repo: string;
  project?: string;
  plan: string;
}): CommandSuccess<PlanProgressData> {
  const discovered = discoverDocs(options.repo);
  const projects = discovered.docs.filter((doc): doc is ProjectDoc => doc.type === "project");
  const project = options.project
    ? projects.find((doc) => doc.slug.toLowerCase() === options.project!.toLowerCase())
    : projects[0];
  if (!project) {
    throw validationError(
      options.project
        ? `No PROJECT.md declaring slug "${options.project}" was found under ${options.repo}.`
        : `No PROJECT.md with \`arcadia: v1\` frontmatter was found under ${options.repo}.`,
      { repo: options.repo, project: options.project ?? null }
    );
  }

  const plans = discovered.docs.filter(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project.toLowerCase() === project.slug.toLowerCase()
  );
  const plan = plans.find((doc) => doc.slug.toLowerCase() === options.plan.toLowerCase());
  if (!plan) {
    throw validationError(
      `No governed Plan "${options.plan}" was found for project ${project.slug}. Run \`arcadia plans\` to list Plans.`,
      { repo: options.repo, project: project.slug, plan: options.plan, available: plans.map((doc) => doc.slug) }
    );
  }

  return createSuccess({ command: "plans", data: buildPlanProgress(project, plan) });
}

export function buildPlanProgress(
  project: Pick<ProjectDoc, "slug" | "activePlan" | "currentAction">,
  plan: PlanDoc
): PlanProgressData {
  const isActivePlan = project.activePlan === plan.slug;
  const byId = new Map(plan.actions.map((action) => [action.id, action]));
  const done = new Set(plan.actions.filter((action) => action.status === "done").map((action) => action.id));
  const entry = (action: PlanActionDoc): PlanProgressEntry => ({
    key: actionKeyOf(project.slug, action.id),
    title: action.title,
    status: action.status,
    waitingOn: action.dependsOn.filter((id) => !done.has(id))
  });

  // Only open and in-progress Actions can be worked: blocked ones are listed
  // apart, deferred ones are counted, and neither is offered as current or next.
  const workable = plan.actions.filter((action) => action.status === "open" || action.status === "in_progress");

  let current: PlanProgressData["current"] = null;
  let currentNote: string | null = null;
  if (isActivePlan) {
    const target = project.currentAction ? byId.get(project.currentAction) : undefined;
    if (target) {
      current = { ...entry(target), basis: "project_current_action" };
    } else {
      currentNote = project.currentAction
        ? `none (PROJECT.md current_action "${project.currentAction}" is not an Action of this Plan)`
        : "none (PROJECT.md declares no current_action)";
    }
  } else {
    const first = workable.find((action) => action.dependsOn.every((id) => done.has(id)));
    if (first) {
      current = { ...entry(first), basis: "first_unfinished_ready" };
    } else {
      currentNote = "none (Plan not active)";
    }
  }

  // Document order, but an Action waits until the workable prerequisites it
  // names have been placed. A dependency cycle degrades to document order.
  const remaining = [...workable];
  const ordered: PlanActionDoc[] = [];
  while (remaining.length > 0) {
    const pending = new Set(remaining.map((action) => action.id));
    const index = remaining.findIndex((action) => !action.dependsOn.some((id) => pending.has(id)));
    ordered.push(...remaining.splice(index === -1 ? 0 : index, 1));
  }
  const next = ordered
    .filter((action) => !current || actionKeyOf(project.slug, action.id) !== current.key)
    .slice(0, NEXT_LIMIT)
    .map(entry);

  const blocked = plan.actions
    .filter((action) => action.status === "blocked")
    .map((action) => ({
      ...entry(action),
      reason: action.question ?? action.nextAction ?? "no reason recorded in the Plan document"
    }));

  const counts = countActions(plan);
  return {
    schema: PLAN_PROGRESS_SCHEMA,
    source: { planSlug: plan.slug, planPath: plan.relativePath, updated: plan.updated },
    counts: { ...counts, total: plan.actions.length },
    isActivePlan,
    current,
    currentNote,
    next,
    blocked,
    actions: plan.actions.map((action) => ({
      key: actionKeyOf(project.slug, action.id),
      status: action.status,
      dependsOn: [...action.dependsOn],
      title: action.title
    })),
    note: PLAN_PROGRESS_NOTE
  };
}

function checkbox(status: string): string {
  if (status === "done") return "[x]";
  if (status === "blocked") return "[!]";
  return "[ ]";
}

function describeEntry(item: PlanProgressEntry): string {
  const tags: string[] = [];
  if (item.status === "in_progress") tags.push("in progress");
  if (item.status === "deferred") tags.push("deferred");
  if (item.waitingOn.length > 0) tags.push(`waits on ${item.waitingOn.join(", ")}`);
  const id = item.key.slice(item.key.indexOf("/") + 1);
  return `- ${checkbox(item.status)} ${id} — ${item.title}${tags.length ? ` (${tags.join("; ")})` : ""}`;
}

export function renderPlanProgressSuccess(response: CommandSuccess<PlanProgressData>, all = false): string[] {
  const data = response.data;
  const c = data.counts;
  const lines: string[] = [
    `Plan ${data.source.planSlug} — ${data.source.planPath} (updated ${data.source.updated})`,
    `Progress: ${c.done} done · ${c.in_progress} in progress · ${c.blocked} blocked · ${c.deferred} deferred · ${c.open} open · ${c.total} total`,
    ""
  ];

  if (data.current) {
    const label =
      data.current.basis === "project_current_action"
        ? "Current Action"
        : "Current Action (Plan not active; first unfinished with dependencies done)";
    lines.push(`${label}:`, describeEntry(data.current));
  } else {
    lines.push(`Current Action: ${data.currentNote ?? "none"}`);
  }
  lines.push("");

  lines.push(`Next ${NEXT_LIMIT} (plan-document order constrained by depends_on; not the dispatch queue):`);
  lines.push(...(data.next.length > 0 ? data.next.map(describeEntry) : ["- none"]));
  lines.push("");

  lines.push("Blocked:");
  if (data.blocked.length > 0) {
    for (const item of data.blocked) {
      lines.push(describeEntry(item), `    reason: ${item.reason}`);
    }
  } else {
    lines.push("- none");
  }

  if (all) {
    lines.push("", "All Actions (document order):");
    lines.push(
      ...data.actions.map((action) =>
        describeEntry({ key: action.key, title: action.title, status: action.status, waitingOn: [] })
      )
    );
  } else if (c.total > 0) {
    lines.push("", `${c.total} Actions in all: --all`);
  }

  lines.push("", data.note);
  return lines;
}

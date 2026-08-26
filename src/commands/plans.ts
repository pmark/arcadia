import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanDoc, ProjectDoc, ScopedOutDoc } from "../docs/types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ACTIVATION_HEADING = /^#{1,3}\s*(if not now|when this (?:becomes|activates)|activation|trigger)/i;

export interface PlanRow {
  slug: string;
  status: string;
  /** false for a `dormant`/`proposed` plan: Arcadia does not evaluate or govern it. */
  governed: boolean;
  milestone: string | null;
  isActivePlan: boolean;
  actionCounts: { open: number; in_progress: number; done: number; blocked: number } | null;
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

function countActions(plan: PlanDoc): PlanRow["actionCounts"] {
  const counts = { open: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const action of plan.actions) {
    if (action.status in counts) {
      counts[action.status as keyof typeof counts] += 1;
    }
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
      lines.push(`    Actions: ${c.open} open · ${c.in_progress} in progress · ${c.blocked} blocked · ${c.done} done`);
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

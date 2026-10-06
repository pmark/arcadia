import { parse as parseYaml } from "yaml";
import { workKindFor } from "../classify.js";
import { actorFromCoAuthors, actorFromEmail, strongestActor } from "../identity.js";
import { timelineEvent, type TimelineEvent } from "../schema.js";
import { readBlobsReadOnly, resolveBlobIds, shortSha, type Collector, type CollectorContext, type TimelineRepository } from "./context.js";

/**
 * Governed-record changes: what the checked-in records say happened, derived
 * from the commits on each repository's base branch that changed them.
 * PROJECT.md (active Plan, pointer, Milestone, status), Plans (status,
 * pointer, Actions created and their status), Decisions (raised, answered),
 * the Project Log, and proposals. Each fact is read by comparing the record's
 * frontmatter before and after the commit; nothing is inferred from a
 * commit message alone.
 */

const GOVERNED_PATHS = ["PROJECT.md", "MISSION_LOG.md", "docs/plans", "docs/decisions", "docs/proposals"];
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const FIELD = "\x1f";
const RECORD = "\x1e";

type Frontmatter = Record<string, unknown>;

export function parseFrontmatter(content: string | null | undefined): Frontmatter | null {
  if (!content) return null;
  const match = FRONTMATTER.exec(content);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Frontmatter) : null;
  } catch {
    return null;
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}

/**
 * A line scanner for Plan frontmatter: top-level scalars plus each Action's
 * id, title and status. Plans run to hundreds of kilobytes and a window holds
 * dozens of revisions, so a full YAML parse per revision costs seconds; the
 * fields read here are single-line scalars by the managed-document format.
 */
export function scanPlanFrontmatter(content: string | null | undefined): Frontmatter | null {
  if (!content) return null;
  const match = FRONTMATTER.exec(content);
  if (!match) return null;
  const result: Frontmatter = {};
  const actions: Array<Record<string, string>> = [];
  let inActions = false;
  let itemIndent = -1;
  let current: Record<string, string> | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (top) {
      inActions = top[1] === "actions";
      current = null;
      if (!inActions && top[2] !== "") result[top[1]] = unquote(top[2]);
      continue;
    }
    if (!inActions) continue;
    const item = /^(\s*)-\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (item && (itemIndent < 0 || item[1].length === itemIndent)) {
      itemIndent = item[1].length;
      current = { [item[2]]: unquote(item[3]) };
      actions.push(current);
      continue;
    }
    const field = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (current && field && field[1].length === itemIndent + 2 && field[3] !== "") current[field[2]] = unquote(field[3]);
  }
  result.actions = actions;
  return result;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

function actionStatuses(frontmatter: Frontmatter | null): Map<string, { status: string | null; title: string | null }> {
  const actions = new Map<string, { status: string | null; title: string | null }>();
  const list = frontmatter?.actions;
  if (!Array.isArray(list)) return actions;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = text(record.id);
    if (id) actions.set(id, { status: text(record.status), title: text(record.title) });
  }
  return actions;
}

export interface RecordFact {
  kind: string;
  summary: string;
  subjects: { plan?: string; action?: string; decision?: string; project?: string };
  attention?: boolean;
}

/** The facts one file change records. `before`/`after` are the file's content at the parent and at the commit. */
export function frontmatterFor(file: string, content: string | null | undefined): Frontmatter | null {
  return file.startsWith("docs/plans/") ? scanPlanFrontmatter(content) : parseFrontmatter(content);
}

export function diffGovernedFile(
  file: string,
  before: string | null,
  after: string | null,
  parse: (file: string, content: string | null) => Frontmatter | null = frontmatterFor
): RecordFact[] {
  const facts: RecordFact[] = [];
  const old = parse(file, before);
  const next = parse(file, after);
  const changed = (field: string): [string | null, string | null] | null => {
    const a = text(old?.[field]);
    const b = text(next?.[field]);
    return a === b ? null : [a, b];
  };

  if (file === "PROJECT.md") {
    const project = text(next?.slug) ?? text(old?.slug) ?? undefined;
    const plan = changed("active_plan");
    if (plan?.[1]) facts.push({ kind: "record.project.plan_activated", summary: `Plan ${plan[1]} is now the active Plan${plan[0] ? ` (was ${plan[0]})` : ""}`, subjects: { project, plan: plan[1] } });
    const pointer = changed("current_action");
    if (pointer) {
      facts.push({
        kind: "record.project.pointer_moved",
        summary: pointer[1] ? `Pointer moved to ${pointer[1]}${pointer[0] ? ` (from ${pointer[0]})` : ""}` : `Pointer cleared (was ${pointer[0]})`,
        subjects: { project, plan: text(next?.active_plan) ?? undefined, action: pointer[1] ?? undefined }
      });
    }
    const milestone = changed("milestone");
    if (milestone?.[1]) facts.push({ kind: "record.project.milestone_changed", summary: `Milestone is now "${milestone[1]}"`, subjects: { project } });
    const status = changed("status");
    if (status && old) facts.push({ kind: "record.project.status_changed", summary: `Project status ${status[0] ?? "none"} → ${status[1] ?? "none"}`, subjects: { project } });
    return facts;
  }

  if (file === "MISSION_LOG.md") {
    if (after !== null) facts.push({ kind: "record.log.appended", summary: "Project Log updated", subjects: {} });
    return facts;
  }

  const type = text(next?.type) ?? text(old?.type);
  if (file.startsWith("docs/plans/") && type === "plan") {
    const plan = text(next?.slug) ?? text(old?.slug) ?? file.replace(/^docs\/plans\//, "").replace(/\.md$/, "");
    const project = text(next?.project) ?? text(old?.project) ?? undefined;
    if (!old && next) facts.push({ kind: "record.plan.created", summary: `Plan ${plan} created (${text(next.status) ?? "no status"})`, subjects: { project, plan } });
    const status = changed("status");
    if (old && status) facts.push({ kind: "record.plan.status_changed", summary: `Plan ${plan} ${status[0] ?? "none"} → ${status[1] ?? "none"}`, subjects: { project, plan } });
    const pointer = changed("current_action");
    if (old && pointer?.[1]) facts.push({ kind: "record.plan.pointer_moved", summary: `Plan ${plan} pointer moved to ${pointer[1]}`, subjects: { project, plan, action: pointer[1] } });
    const before = actionStatuses(old);
    for (const [id, action] of actionStatuses(next)) {
      const prior = before.get(id);
      if (!prior) {
        facts.push({ kind: "record.action.created", summary: `Action ${id} created${action.title ? `: ${action.title}` : ""}`, subjects: { project, plan, action: id } });
      } else if (prior.status !== action.status) {
        const done = action.status === "done";
        facts.push({
          kind: done ? "record.action.done" : "record.action.status_changed",
          summary: done ? `Action ${id} done` : `Action ${id} ${prior.status ?? "none"} → ${action.status ?? "none"}`,
          subjects: { project, plan, action: id }
        });
      }
    }
    return facts;
  }

  if (file.startsWith("docs/decisions/") && type === "decision") {
    const id = text(next?.id) ?? text(old?.id) ?? file;
    const project = text(next?.project) ?? text(old?.project) ?? undefined;
    const question = text(next?.question) ?? text(old?.question) ?? "";
    if (!old && next) {
      facts.push({ kind: "record.decision.raised", summary: `Decision ${id} raised: ${question}`, subjects: { project, decision: id }, attention: text(next.status) === "open" });
    }
    const answer = changed("answer");
    const status = changed("status");
    if (old && (answer?.[1] || status)) {
      facts.push({
        kind: "record.decision.answered",
        summary: `Decision ${id} ${text(next?.status) ?? "updated"}${answer?.[1] ? `: ${answer[1]}` : ""}`,
        subjects: { project, decision: id }
      });
    } else if (!old && next && answer?.[1]) {
      facts.push({ kind: "record.decision.answered", summary: `Decision ${id} recorded already answered: ${answer[1]}`, subjects: { project, decision: id } });
    }
    return facts;
  }

  if (file.startsWith("docs/proposals/") && !before && after && type === "proposal") {
    facts.push({ kind: "record.proposal.added", summary: `Proposal filed: ${text(next?.question) ?? file}`, subjects: { project: text(next?.project) ?? undefined } });
  }
  return facts;
}

function baseRef(repository: TimelineRepository, context: CollectorContext): string {
  for (const candidate of ["refs/heads/main", "refs/heads/master"]) {
    if (context.git(repository.path, ["rev-parse", "--verify", "--quiet", candidate]).ok) return candidate;
  }
  return "HEAD";
}

interface GovernedChange {
  sha: string;
  parent: string | null;
  authorEmail: string;
  committedAt: string;
  subject: string;
  trailers: string[];
  files: Array<{ status: string; file: string }>;
}

export function collectGovernedRecords(repository: TimelineRepository, context: CollectorContext): TimelineEvent[] {
  const ref = baseRef(repository, context);
  const result = context.git(repository.path, [
    "log",
    ref,
    "--first-parent",
    "--diff-merges=first-parent",
    "--no-renames",
    "--name-status",
    `--since=${context.window.since.toISOString()}`,
    `--until=${context.window.until.toISOString()}`,
    `--max-count=${context.maxPerSource}`,
    `--format=${RECORD}%H${FIELD}%P${FIELD}%ae${FIELD}%cI${FIELD}%s${FIELD}%(trailers:key=Co-authored-by,valueonly,separator=%x1d)`,
    "--",
    ...GOVERNED_PATHS
  ]);
  if (!result.ok) throw new Error(`git log of governed records failed in ${repository.path}: ${result.stderr.trim().slice(0, 200)}`);

  const changes: GovernedChange[] = [];
  for (const record of result.stdout.split(RECORD).map((value) => value.trim()).filter(Boolean)) {
    const [header, ...lines] = record.split("\n");
    const [sha, parents, authorEmail, committedAt, subject, trailerField] = header.split(FIELD);
    const files = lines
      .map((line) => line.split("\t"))
      .filter((parts) => parts.length >= 2 && /^[AMD]$/.test(parts[0]))
      .map(([status, file]) => ({ status, file }))
      .filter(({ file }) => file === "PROJECT.md" || file === "MISSION_LOG.md" || (/^docs\/(plans|decisions|proposals)\/[^/]+\.md$/.test(file)));
    if (!sha || files.length === 0) continue;
    changes.push({
      sha,
      parent: (parents ?? "").split(" ").filter(Boolean)[0] ?? null,
      authorEmail: authorEmail ?? "",
      committedAt: committedAt ?? "",
      subject: subject ?? "",
      trailers: (trailerField ?? "").split("\x1d").map((value) => value.trim()).filter(Boolean),
      files
    });
  }

  const specs: string[] = [];
  for (const change of changes) {
    for (const { status, file } of change.files) {
      if (status !== "A" && change.parent) specs.push(`${change.parent}:${file}`);
      if (status !== "D") specs.push(`${change.sha}:${file}`);
    }
  }
  const ids = resolveBlobIds(repository.path, [...new Set(specs)]);

  // One read and one parse per distinct revision (a revision is the "after" of one commit and the
  // "before" of the next); only the parsed frontmatter is kept, never the file.
  const fileForOid = new Map<string, { file: string; size: number }>();
  for (const [spec, id] of ids) {
    const file = spec.slice(spec.indexOf(":") + 1);
    if (id && file !== "MISSION_LOG.md" && !fileForOid.has(id.oid)) fileForOid.set(id.oid, { file, size: id.size });
  }
  const parsed = new Map<string, Frontmatter | null>();
  readBlobsReadOnly(
    repository.path,
    [...fileForOid].map(([oid, { size }]) => ({ oid, size })),
    (oid, content) => parsed.set(oid, frontmatterFor(fileForOid.get(oid)?.file ?? "", content))
  );
  const byOid = (_file: string, oid: string | null): Frontmatter | null => (oid ? parsed.get(oid) ?? null : null);
  const oidOf = (spec: string): string | null => ids.get(spec)?.oid ?? null;

  const events: TimelineEvent[] = [];
  for (const change of changes) {
    const who = strongestActor([actorFromEmail(change.authorEmail, { operatorEmails: context.operatorEmails }), actorFromCoAuthors(change.trailers)]);
    let ordinal = 0;
    for (const { status, file } of change.files) {
      // Object ids stand in for contents: diffGovernedFile only parses them, through byOid.
      const before = status !== "A" && change.parent ? oidOf(`${change.parent}:${file}`) : null;
      const after = status !== "D" ? oidOf(`${change.sha}:${file}`) : null;
      for (const fact of diffGovernedFile(file, before, after, byOid)) {
        const event = timelineEvent({
          id: `governed-records:${repository.projectSlug}:${change.sha}:${ordinal++}`,
          time: change.committedAt,
          clock: "git-committer-date",
          source: "governed-records",
          kind: fact.kind,
          workKind: workKindFor(fact.kind),
          summary: fact.summary,
          subjects: {
            project: fact.subjects.project ?? repository.projectSlug,
            plan: fact.subjects.plan,
            action: fact.subjects.action,
            decision: fact.subjects.decision,
            commit: change.sha,
            repository: repository.path
          },
          actor: who.actor,
          attention: fact.attention ?? false,
          evidence: [
            { kind: "sha", value: change.sha },
            { kind: "path", value: file }
          ],
          provenance: {
            event: `frontmatter of ${file} compared at ${shortSha(change.parent)} and ${shortSha(change.sha)} on ${ref}`,
            actor: who.provenance,
            commit: change.subject
          },
          dedupeKeys: [`commit:${change.sha}`]
        });
        if (event) events.push(event);
      }
    }
  }
  return events;
}

export function governedRecordCollectors(repositories: TimelineRepository[]): Collector[] {
  return repositories.map((repository) => ({
    source: "governed-records" as const,
    describe: `governed records ${repository.projectSlug} (${repository.path})`,
    collect: (context: CollectorContext) => collectGovernedRecords(repository, context)
  }));
}

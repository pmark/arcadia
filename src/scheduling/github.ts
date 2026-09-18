import { spawnSync } from "node:child_process";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { applyOperatorOrder, minimalMoves, sameSequence } from "./order.js";
import { orderCandidates, writeProjectOrder, type ProjectSchedule, type ScheduledAction, type ScheduleStatus } from "./schedule.js";
import { recordSchedulingLog, upsertSchedulingAction, upsertSchedulingProject } from "./store.js";

/**
 * GitHub Projects is the operator-facing projection of a Project's queue:
 * one Issue per Action, one Project item per Issue, a single-select field
 * carrying the scheduling status, and item position carrying queue order.
 *
 * Arcadia's SQLite queue is canonical. Everything flows Arcadia -> GitHub,
 * with one exception: the operator dragging cards. Reconciliation reads the
 * board order back, compares it with the order Arcadia last projected,
 * applies a genuine operator change through the canonical rule (which keeps
 * tiers and dependencies intact) and re-projects whatever differs.
 *
 * `SchedulingBoard` is the whole surface the scheduler needs from GitHub, so
 * tests drive an in-memory board and production drives `gh`.
 */

export const BOARD_STATUS_FIELD = "Arcadia status";
export const BOARD_STATUSES = ["Needs operator", "Ready", "Running", "Blocked", "Done", "Backlog"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export interface BoardItem {
  itemId: string;
  issueNumber: number | null;
  title: string;
  status: string | null;
}

export interface SchedulingBoard {
  /** Every item in the board's own order. */
  listItems(): BoardItem[];
  createIssue(input: { title: string; body: string }): { number: number; url: string };
  /** Add an Issue to the Project; returns the new item id. */
  addIssue(input: { number: number; url: string }): string;
  setStatus(itemId: string, status: BoardStatus): void;
  /** Move an item directly after another, or to the top when `afterItemId` is null. */
  moveItem(itemId: string, afterItemId: string | null): void;
}

export function boardStatusFor(status: ScheduleStatus): BoardStatus {
  switch (status) {
    case "ready": return "Ready";
    case "running": return "Running";
    case "blocked": return "Blocked";
    case "needs_operator": return "Needs operator";
    case "done": return "Done";
    case "deferred": return "Backlog";
  }
}

export interface ProjectionResult {
  projectSlug: string;
  issuesCreated: string[];
  itemsAdded: string[];
  statusChanges: Array<{ actionKey: string; from: string | null; to: BoardStatus }>;
  moves: Array<{ actionKey: string; after: string | null }>;
  revision: number;
  changed: boolean;
}

/**
 * Push the schedule onto the board, touching only what differs: missing
 * Issues and items are created, statuses that changed are set, and the
 * queued items are moved with the fewest position updates that yield the
 * canonical order. Records the projected revision and order afterwards.
 */
export function projectScheduleToBoard(db: Database.Database, schedule: ProjectSchedule, board: SchedulingBoard): ProjectionResult {
  const result: ProjectionResult = { projectSlug: schedule.projectSlug, issuesCreated: [], itemsAdded: [], statusChanges: [], moves: [], revision: schedule.queueRevision, changed: false };
  const items = new Map(board.listItems().map((item) => [item.itemId, item]));
  const actions = schedule.actions.map((action) => ({ ...action }));

  for (const action of actions) {
    if (action.githubIssueNumber === null) {
      const issue = board.createIssue({ title: action.title, body: issueBody(schedule, action) });
      action.githubIssueNumber = issue.number;
      action.githubIssueUrl = issue.url;
      upsertSchedulingAction(db, action.key, { githubIssueNumber: issue.number, githubIssueUrl: issue.url });
      result.issuesCreated.push(action.key);
    }
    if (action.githubProjectItemId === null || !items.has(action.githubProjectItemId)) {
      const itemId = board.addIssue({ number: action.githubIssueNumber, url: action.githubIssueUrl ?? "" });
      action.githubProjectItemId = itemId;
      upsertSchedulingAction(db, action.key, { githubProjectItemId: itemId });
      items.set(itemId, { itemId, issueNumber: action.githubIssueNumber, title: action.title, status: null });
      result.itemsAdded.push(action.key);
    }
    const desired = boardStatusFor(action.status);
    const current = items.get(action.githubProjectItemId!)?.status ?? null;
    if (current !== desired) {
      board.setStatus(action.githubProjectItemId!, desired);
      result.statusChanges.push({ actionKey: action.key, from: current, to: desired });
    }
  }

  const itemByKey = new Map(actions.map((action) => [action.key, action.githubProjectItemId!]));
  const keyByItem = new Map(actions.map((action) => [action.githubProjectItemId!, action.key]));
  const boardOrder = board.listItems().map((item) => keyByItem.get(item.itemId)).filter((key): key is string => key !== undefined);
  const desiredQueue = schedule.queue;
  const currentQueueOrder = boardOrder.filter((key) => desiredQueue.includes(key));
  if (!sameSequence(currentQueueOrder, desiredQueue)) {
    // Only the relative order of queued items carries meaning, so the items
    // already in canonical relative order stay put and the rest move behind
    // their canonical predecessor (or to the top).
    for (const move of minimalMoves(currentQueueOrder, desiredQueue)) {
      board.moveItem(itemByKey.get(move.key)!, move.after === null ? null : itemByKey.get(move.after)!);
      result.moves.push({ actionKey: move.key, after: move.after });
    }
  }

  result.changed = result.issuesCreated.length > 0 || result.itemsAdded.length > 0 || result.statusChanges.length > 0 || result.moves.length > 0;
  upsertSchedulingProject(db, schedule.projectSlug, { lastProjectedRevision: schedule.queueRevision, lastProjectedOrder: desiredQueue });
  if (result.changed) {
    recordSchedulingLog(db, {
      projectSlug: schedule.projectSlug,
      actionKey: null,
      source: "arcadia",
      reason: `Projected queue revision ${schedule.queueRevision} to GitHub: ${result.issuesCreated.length} issue(s) created, ${result.itemsAdded.length} item(s) added, ${result.statusChanges.length} status change(s), ${result.moves.length} move(s).`,
      previous: { order: currentQueueOrder },
      next: { order: desiredQueue }
    });
  }
  return result;
}

function issueBody(schedule: ProjectSchedule, action: ScheduledAction): string {
  return [
    `Arcadia Action \`${action.key}\` in Plan \`${schedule.planSlug}\`${schedule.milestone ? ` (Milestone: ${schedule.milestone})` : ""}.`,
    "",
    `Scheduling class: ${action.schedulingClass}.`,
    action.dependsOn.length > 0 ? `Depends on: ${action.dependsOn.join(", ")}.` : "",
    "",
    "This Issue mirrors a governed Action; Arcadia's queue is canonical. Reordering cards on the Project board is the one operator input Arcadia reads back."
  ].filter((line, index, lines) => !(line === "" && lines[index - 1] === "")).join("\n");
}

export interface ReconcileResult {
  projectSlug: string;
  observedOrder: string[];
  operatorMoved: boolean;
  accepted: boolean;
  normalized: boolean;
  normalizationReasons: string[];
  canonical: string[];
  revision: number;
  projection: ProjectionResult | null;
}

/**
 * The reconciliation job: read the board, detect an operator reorder against
 * the last projected order, apply it through the canonical rule, log it, and
 * re-project when the board differs from canonical or the queue revision has
 * moved since the last projection.
 */
export function reconcileBoard(
  db: Database.Database,
  schedule: ProjectSchedule,
  board: SchedulingBoard,
  input: { requestId: string; rebuild: () => ProjectSchedule }
): ReconcileResult {
  const keyByItem = new Map(schedule.actions.filter((action) => action.githubProjectItemId).map((action) => [action.githubProjectItemId!, action.key]));
  const queued = new Set(schedule.queue);
  const observedOrder = board.listItems()
    .map((item) => keyByItem.get(item.itemId))
    .filter((key): key is string => key !== undefined && queued.has(key));
  const lastProjected = schedule.record.lastProjectedOrder.filter((key) => queued.has(key));
  const boardAlreadyProjected = schedule.record.lastProjectedRevision >= 0;
  const operatorMoved = boardAlreadyProjected && observedOrder.length > 0 && !sameSequence(observedOrder, lastProjected.filter((key) => observedOrder.includes(key)));

  let current = schedule;
  let accepted = false;
  let normalized = false;
  let normalizationReasons: string[] = [];
  if (operatorMoved) {
    const applied = applyOperatorOrder(orderCandidates(schedule.actions), observedOrder);
    normalized = applied.normalized;
    normalizationReasons = applied.normalizationReasons;
    if (applied.changed) {
      accepted = true;
      writeProjectOrder(db, schedule.projectSlug, applied.canonical, {
        requestId: `${input.requestId}:operator-order`,
        source: "github_operator",
        reason: `Operator reordered cards on the GitHub board: ${describeMoves(applied.before, applied.requested)}.`
      });
    }
    if (applied.normalized) {
      recordSchedulingLog(db, {
        projectSlug: schedule.projectSlug,
        actionKey: null,
        source: "arcadia",
        reason: `Board order normalized back to canonical: ${applied.normalizationReasons.join(" ")}`,
        previous: { order: applied.requested },
        next: { order: applied.canonical }
      });
    }
    current = input.rebuild();
  }

  const needsProjection = current.queueRevision !== current.record.lastProjectedRevision
    || !sameSequence(observedOrder, current.queue.filter((key) => observedOrder.includes(key)))
    || current.actions.some((action) => action.githubProjectItemId === null);
  const projection = needsProjection ? projectScheduleToBoard(db, current, board) : null;
  return {
    projectSlug: schedule.projectSlug,
    observedOrder,
    operatorMoved,
    accepted,
    normalized,
    normalizationReasons,
    canonical: current.queue,
    revision: current.queueRevision,
    projection
  };
}

function describeMoves(before: string[], requested: string[]): string {
  const moved = requested.filter((key, index) => before[index] !== key);
  return moved.length === 0 ? "no net change" : `moved ${moved.slice(0, 3).join(", ")}${moved.length > 3 ? ` and ${moved.length - 3} more` : ""}`;
}


// ---------------------------------------------------------------------------
// gh-backed board
// ---------------------------------------------------------------------------

export interface GitHubBoardConfig {
  owner: string;
  number: number;
  /** `owner/name` of the repository Issues are created in. */
  repository: string;
  /** Working directory for `gh`, so repository-relative defaults resolve. */
  cwd: string;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (cwd: string, command: string, args: string[]) => CommandResult;

export function runGh(cwd: string, command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return { ok: !result.error && result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

function ghJson<T>(run: CommandRunner, cwd: string, args: string[], what: string): T {
  const result = run(cwd, "gh", args);
  if (!result.ok) throw validationError(`GitHub ${what} failed: ${result.stderr.trim() || "gh returned a nonzero status."}`, { args });
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw validationError(`GitHub ${what} returned invalid JSON.`, { args });
  }
}

interface StatusField {
  id: string;
  options: Map<string, string>;
}

/**
 * Items, in the board's own order, with the `Arcadia status` value each one
 * carries.
 *
 * This is a GraphQL read rather than `gh project item-list` because the field
 * has to be addressed by its exact name. `item-list --format json` flattens
 * custom fields into camelCased keys derived from the field's title, so
 * "Arcadia status" arrives as some spelling this code would have to guess at;
 * guessing wrong reads every status as absent, and a projection that believes
 * every card is unset rewrites every status on every tick forever. GraphQL's
 * `fieldValueByName` takes the name verbatim and answers for that field only.
 */
const ITEMS_QUERY = `query($project: ID!, $status: String!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on Issue { number title }
            ... on PullRequest { number title }
            ... on DraftIssue { title }
          }
          fieldValueByName(name: $status) {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}`;

interface ItemsResponse {
  data?: {
    node?: {
      items?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: Array<{
          id: string;
          content?: { number?: number; title?: string } | null;
          fieldValueByName?: { name?: string } | null;
        }>;
      };
    };
  };
}

function listBoardItems(run: CommandRunner, config: GitHubBoardConfig, projectId: string): BoardItem[] {
  const items: BoardItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const args = ["api", "graphql", "-f", `query=${ITEMS_QUERY}`, "-F", `project=${projectId}`, "-f", `status=${BOARD_STATUS_FIELD}`];
    if (after) args.push("-F", `after=${after}`);
    const response = ghJson<ItemsResponse>(run, config.cwd, args, "project items query");
    const connection = response.data?.node?.items;
    for (const node of connection?.nodes ?? []) {
      items.push({
        itemId: node.id,
        issueNumber: typeof node.content?.number === "number" ? node.content.number : null,
        title: node.content?.title ?? "",
        status: typeof node.fieldValueByName?.name === "string" ? node.fieldValueByName.name : null
      });
    }
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) return items;
    after = connection.pageInfo.endCursor;
  }
  return items;
}

/**
 * Open an existing board for reading and projection. This never creates or
 * alters the board's schema: a missing `Arcadia status` field is a refusal
 * with the remedy, so a preview or a worker tick cannot mutate GitHub's
 * structure as a side effect of looking at it. `schedule github link` is the
 * one command that creates the field.
 */
export function createGitHubBoard(config: GitHubBoardConfig, run: CommandRunner = runGh): SchedulingBoard {
  const owner = config.owner;
  const number = String(config.number);
  const view = ghJson<{ id: string }>(run, config.cwd, ["project", "view", number, "--owner", owner, "--format", "json"], "project view");
  const projectId = view.id;
  const statusField = requireStatusField(run, config);

  return {
    listItems() {
      return listBoardItems(run, config, projectId);
    },
    createIssue(input) {
      const created = run(config.cwd, "gh", ["issue", "create", "--repo", config.repository, "--title", input.title, "--body", input.body]);
      if (!created.ok) throw validationError(`GitHub issue create failed: ${created.stderr.trim()}`);
      const url = created.stdout.trim().split(/\s+/).find((token) => token.startsWith("https://")) ?? "";
      const issueNumber = Number(url.split("/").pop());
      if (!url || !Number.isInteger(issueNumber)) throw validationError("GitHub issue create returned no issue URL.", { stdout: created.stdout });
      return { number: issueNumber, url };
    },
    addIssue(input) {
      const url = input.url || `https://github.com/${config.repository}/issues/${input.number}`;
      const added = ghJson<{ id: string }>(run, config.cwd, ["project", "item-add", number, "--owner", owner, "--url", url, "--format", "json"], "item-add");
      return added.id;
    },
    setStatus(itemId, status) {
      const optionId = statusField.options.get(status)!;
      const edited = run(config.cwd, "gh", [
        "project", "item-edit", "--project-id", projectId, "--id", itemId, "--field-id", statusField.id, "--single-select-option-id", optionId
      ]);
      if (!edited.ok) throw validationError(`GitHub item-edit failed: ${edited.stderr.trim()}`);
    },
    moveItem(itemId, afterItemId) {
      const query = afterItemId
        ? "mutation($project: ID!, $item: ID!, $after: ID!) { updateProjectV2ItemPosition(input: {projectId: $project, itemId: $item, afterId: $after}) { items(first: 1) { totalCount } } }"
        : "mutation($project: ID!, $item: ID!) { updateProjectV2ItemPosition(input: {projectId: $project, itemId: $item}) { items(first: 1) { totalCount } } }";
      const args = ["api", "graphql", "-f", `query=${query}`, "-F", `project=${projectId}`, "-F", `item=${itemId}`];
      if (afterItemId) args.push("-F", `after=${afterItemId}`);
      const moved = run(config.cwd, "gh", args);
      if (!moved.ok) throw validationError(`GitHub item move failed: ${moved.stderr.trim()}`);
    }
  };
}

/**
 * Create the `Arcadia status` field when the board does not have one yet. Only
 * `schedule github link` calls this, so board schema changes stay an explicit
 * operator act rather than something a read path performs on its own.
 */
export function ensureBoardStatusField(config: GitHubBoardConfig, run: CommandRunner = runGh): { created: boolean } {
  if (findStatusField(run, config)) return { created: false };
  const created = run(config.cwd, "gh", [
    "project", "field-create", String(config.number), "--owner", config.owner, "--name", BOARD_STATUS_FIELD,
    "--data-type", "SINGLE_SELECT", "--single-select-options", BOARD_STATUSES.join(",")
  ]);
  if (!created.ok) throw validationError(`GitHub field-create failed: ${created.stderr.trim()}`);
  requireStatusField(run, config);
  return { created: true };
}

function requireStatusField(run: CommandRunner, config: GitHubBoardConfig): StatusField {
  const field = findStatusField(run, config);
  if (!field) {
    throw validationError(`GitHub Project ${config.owner}/${config.number} has no "${BOARD_STATUS_FIELD}" field.`, {
      remedy: `Run \`arcadia schedule github link --project <slug> --owner ${config.owner} --number ${config.number}\` to create it; reading and projecting never create board fields.`
    });
  }
  const missing = BOARD_STATUSES.filter((status) => !field.options.has(status));
  if (missing.length > 0) {
    throw validationError(`GitHub field "${BOARD_STATUS_FIELD}" is missing option(s): ${missing.join(", ")}.`, {
      remedy: `Add the missing single-select option(s) to "${BOARD_STATUS_FIELD}" on Project ${config.owner}/${config.number}.`
    });
  }
  return field;
}

function findStatusField(run: CommandRunner, config: GitHubBoardConfig): StatusField | null {
  const data = ghJson<{ fields: Array<{ id: string; name: string; type?: string; options?: Array<{ id: string; name: string }> }> }>(
    run, config.cwd, ["project", "field-list", String(config.number), "--owner", config.owner, "--format", "json", "--limit", "100"], "field-list"
  );
  const field = data.fields.find((candidate) => candidate.name === BOARD_STATUS_FIELD);
  if (!field) return null;
  return { id: field.id, options: new Map((field.options ?? []).map((option) => [option.name, option.id])) };
}

/** Create a GitHub Project for an Arcadia Project and return its number and node id. */
export function createGitHubProject(input: { owner: string; title: string; cwd: string }, run: CommandRunner = runGh): { number: number; id: string; url: string } {
  const created = ghJson<{ number: number; id: string; url: string }>(
    run, input.cwd, ["project", "create", "--owner", input.owner, "--title", input.title, "--format", "json"], "project create"
  );
  return { number: created.number, id: created.id, url: created.url };
}

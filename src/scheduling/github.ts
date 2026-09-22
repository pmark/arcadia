import { spawnSync } from "node:child_process";
import type Database from "better-sqlite3";
import { ArcadiaError, validationError } from "../cli/errors.js";
import { batchSlotFor, resolveBatch, type BatchResolution, type BatchSlot } from "../docs/batch.js";
import { loadActionOrder } from "../dispatch/order.js";
import { applyOperatorOrder, minimalMoves, sameSequence } from "./order.js";
import { orderCandidates, writeProjectOrder, type ProjectSchedule, type ScheduledAction, type ScheduleStatus } from "./schedule.js";
import { recordSchedulingLog, upsertSchedulingAction, upsertSchedulingProject } from "./store.js";

/**
 * GitHub Projects is the operator-facing projection of a Project's queue:
 * one Issue per Action, one Project item per Issue, a single-select field
 * carrying the scheduling status, a second carrying the Action's place in the
 * current push, and item position carrying queue order.
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

/**
 * The push field. Bounded options, because a single-select's options must
 * exist before a card can carry one and the projection path may never change
 * the board's schema: the two push memberships, the four gates the batch walk
 * can stop at, and the two ways an Action is simply not in this push.
 *
 * The lane itself is not an option. A lane is a repository, and an Arcadia
 * board already holds one Project's Actions, so the only lane fact a card can
 * carry is whether its lane is ordered work.
 */
export const BOARD_PUSH_FIELD = "Arcadia push";
export const BOARD_PUSHES = [
  "This push",
  "This push · sequence",
  "Next push",
  "Decision needed",
  "Deferred",
  "Question open",
  "Review needed",
  "Not queued"
] as const;
export type BoardPush = (typeof BOARD_PUSHES)[number];

export function boardPushFor(slot: BatchSlot): BoardPush {
  switch (slot) {
    case "this_push": return "This push";
    case "this_push_sequence": return "This push · sequence";
    case "next_push": return "Next push";
    case "decision": return "Decision needed";
    case "deferred": return "Deferred";
    case "question_open": return "Question open";
    case "capacity_proof_run": return "Review needed";
    case "dependency":
    case "unavailable":
    case "not_queued": return "Not queued";
  }
}

export interface BoardItem {
  itemId: string;
  issueNumber: number | null;
  /** The content's own URL, so items can be matched across repositories where issue numbers repeat. */
  url: string | null;
  title: string;
  status: string | null;
  /** The `Arcadia push` value, or null when the board has no such field. */
  push: string | null;
}

export interface SchedulingBoard {
  /** The board's `Arcadia push` field, or null when the board has none. The
   *  push projection is skipped rather than failing: an existing board gains
   *  the field through `schedule github link`, and until then there is nothing
   *  to keep fresh. */
  readonly pushField: { id: string } | null;
  /** Every item in the board's own order. */
  listItems(): BoardItem[];
  createIssue(input: { title: string; body: string }): { number: number; url: string };
  /** Add an Issue to the Project; returns the new item id. */
  addIssue(input: { number: number; url: string }): string;
  setStatus(itemId: string, status: BoardStatus): void;
  /** Write the push label, when the board has an `Arcadia push` field. */
  setPush(itemId: string, push: BoardPush): void;
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
  pushChanges: Array<{ actionKey: string; from: string | null; to: BoardPush }>;
  moves: Array<{ actionKey: string; after: string | null }>;
  revision: number;
  changed: boolean;
}

/**
 * Push the schedule onto the board, touching only what differs: missing
 * Issues and items are created, statuses that changed are set, the computed
 * push label is refreshed, and the queued items are moved with the fewest
 * position updates that yield the canonical order. Records the projected
 * revision and order afterwards.
 *
 * The push label is recomputed here, on every projection, rather than read
 * from anywhere it could have been stored: the batch boundary moves as soon as
 * a Decision is answered or an Action completes, and a stale label on a card
 * is worse than none. `batch` is passed in by `reconcileBoard`, which needs the
 * same computation to decide whether the labels are stale; a direct caller
 * omitting it gets it computed from the schedule.
 */
export function projectScheduleToBoard(
  db: Database.Database,
  schedule: ProjectSchedule,
  board: SchedulingBoard,
  batch?: BatchResolution | null
): ProjectionResult {
  const result: ProjectionResult = { projectSlug: schedule.projectSlug, issuesCreated: [], itemsAdded: [], statusChanges: [], pushChanges: [], moves: [], revision: schedule.queueRevision, changed: false };
  // Mark the board as mid-projection before the first write. Every step below
  // can fail independently, and a board left half-moved matches neither the
  // canonical order nor the last projected one -- so until this clears, the
  // difference is this function's unfinished work and must never be read back
  // as an operator drag.
  upsertSchedulingProject(db, schedule.projectSlug, { projectionInFlight: true });
  const items = new Map(board.listItems().map((item) => [item.itemId, item]));
  const actions = schedule.actions.map((action) => ({ ...action }));
  const push = batch === undefined ? resolveProjectBatch(db, schedule) : batch;

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
      // `addIssue` can recover an item that was already on the board (GitHub's
      // "already exists" refusal) and hand back its real id, which `items`
      // (read from `listItems()` above) already holds with its true status.
      // Only synthesize a fresh entry -- and only count it as added -- when
      // this genuinely is new to the board; otherwise the real status is
      // overwritten with `null` and every recovered item gets rewritten and
      // misreported as added.
      if (!items.has(itemId)) {
        items.set(itemId, { itemId, issueNumber: action.githubIssueNumber, url: action.githubIssueUrl ?? null, title: action.title, status: null, push: null });
        result.itemsAdded.push(action.key);
      }
    }
    const desired = boardStatusFor(action.status);
    const current = items.get(action.githubProjectItemId)?.status ?? null;
    if (current !== desired) {
      board.setStatus(action.githubProjectItemId, desired);
      result.statusChanges.push({ actionKey: action.key, from: current, to: desired });
    }
    if (push && board.pushField) {
      const desiredPush = boardPushFor(batchSlotFor(push, schedule.projectSlug, action.actionId));
      const currentPush = items.get(action.githubProjectItemId)?.push ?? null;
      if (currentPush !== desiredPush) {
        board.setPush(action.githubProjectItemId, desiredPush);
        result.pushChanges.push({ actionKey: action.key, from: currentPush, to: desiredPush });
      }
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

  result.changed = result.issuesCreated.length > 0 || result.itemsAdded.length > 0 || result.statusChanges.length > 0 || result.pushChanges.length > 0 || result.moves.length > 0;
  // Reached only when every write above succeeded, so the board now genuinely
  // holds `desiredQueue` and the projection is no longer in flight.
  upsertSchedulingProject(db, schedule.projectSlug, {
    lastProjectedRevision: schedule.queueRevision,
    lastProjectedOrder: desiredQueue,
    projectionInFlight: false
  });
  if (result.changed) {
    recordSchedulingLog(db, {
      projectSlug: schedule.projectSlug,
      actionKey: null,
      source: "arcadia",
      reason: `Projected queue revision ${schedule.queueRevision} to GitHub: ${result.issuesCreated.length} issue(s) created, ${result.itemsAdded.length} item(s) added, ${result.statusChanges.length} status change(s), ${result.pushChanges.length} push change(s), ${result.moves.length} move(s).`,
      previous: { order: currentQueueOrder },
      next: { order: desiredQueue }
    });
  }
  return result;
}

/** The Project's own push, or null when it has no resolvable repository. */
function resolveProjectBatch(db: Database.Database, schedule: ProjectSchedule): BatchResolution | null {
  if (!schedule.repositoryRoot) return null;
  const positions = loadActionOrder(db).positions;
  return resolveBatch(
    [{ repositoryRoot: schedule.repositoryRoot, projectSlug: schedule.projectSlug }],
    { queuePosition: (key) => positions.get(key) ?? null }
  );
}

/**
 * True when a card's `Arcadia push` value differs from what the batch says it
 * should be. A board with no push field reports null for every item, which is
 * not staleness: there is nothing to correct yet.
 */
function pushLabelsStale(items: BoardItem[], expected: Map<string, BoardPush>): boolean {
  if (expected.size === 0) return false;
  for (const item of items) {
    const want = expected.get(item.itemId);
    if (want !== undefined && item.push !== want) return true;
  }
  return false;
}

/**
 * Every push label a projection of this schedule would write, keyed by board
 * item id — the expected state `reconcileBoard` compares the board against to
 * decide whether a re-projection is due.
 */
function expectedPushByItem(
  schedule: ProjectSchedule,
  batch: BatchResolution | null
): Map<string, BoardPush> {
  const expected = new Map<string, BoardPush>();
  if (!batch) return expected;
  for (const action of schedule.actions) {
    if (!action.githubProjectItemId) continue;
    expected.set(action.githubProjectItemId, boardPushFor(batchSlotFor(batch, schedule.projectSlug, action.actionId)));
  }
  return expected;
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
  /** This pass finished a projection an earlier one left half-written. */
  resumedProjection: boolean;
}

/**
 * The reconciliation job: read the board, detect an operator reorder against
 * the last projected order, apply it through the canonical rule, log it, and
 * re-project when the board differs from canonical or the queue revision has
 * moved since the last projection.
 *
 * `input.batch` is the push for this Project's *repository*, which a pass
 * computes once and shares across every Project in it. Leaving it undefined
 * makes this function resolve the batch for this Project alone, which is
 * right for a single-Project repository and for direct callers.
 */
export function reconcileBoard(
  db: Database.Database,
  schedule: ProjectSchedule,
  board: SchedulingBoard,
  input: { requestId: string; rebuild: () => ProjectSchedule; now?: Date; batch?: BatchResolution | null }
): ReconcileResult {
  const keyByItem = new Map(schedule.actions.filter((action) => action.githubProjectItemId).map((action) => [action.githubProjectItemId!, action.key]));
  const queued = new Set(schedule.queue);
  const items = board.listItems();
  const observedOrder = items
    .map((item) => keyByItem.get(item.itemId))
    .filter((key): key is string => key !== undefined && queued.has(key));
  const lastProjected = schedule.record.lastProjectedOrder.filter((key) => queued.has(key));
  const boardAlreadyProjected = schedule.record.lastProjectedRevision >= 0;
  // An unfinished projection is not an operator drag. Attributing one to the
  // operator would persist a half-applied intermediate order as their intent,
  // reverting part of an `advance queue` reorder and logging it against them.
  const projectionInFlight = schedule.record.projectionInFlight;
  const operatorMoved = boardAlreadyProjected
    && !projectionInFlight
    && observedOrder.length > 0
    && !sameSequence(observedOrder, lastProjected.filter((key) => observedOrder.includes(key)));

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

  // The push labels are part of the projection, not a separate sync: the same
  // computation decides whether they are stale and writes them when the
  // projection runs, so a card can never carry a batch position nobody
  // recomputed.
  const batch = input.batch === undefined ? resolveProjectBatch(db, current) : input.batch;
  const needsProjection = projectionInFlight
    || current.queueRevision !== current.record.lastProjectedRevision
    || !sameSequence(observedOrder, current.queue.filter((key) => observedOrder.includes(key)))
    || current.actions.some((action) => action.githubProjectItemId === null)
    || (board.pushField !== null && pushLabelsStale(items, expectedPushByItem(current, batch)));
  const projection = needsProjection ? projectScheduleToBoard(db, current, board, batch) : null;
  // The board was read this pass either way; record that so polling for drags
  // can be throttled independently of how often the scheduler runs.
  upsertSchedulingProject(db, schedule.projectSlug, { lastReconciledAt: (input.now ?? new Date()).toISOString() });
  return {
    projectSlug: schedule.projectSlug,
    observedOrder,
    operatorMoved,
    accepted,
    normalized,
    normalizationReasons,
    canonical: current.queue,
    revision: current.queueRevision,
    projection,
    resumedProjection: projectionInFlight
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

interface BoardFields {
  status: StatusField | null;
  push: StatusField | null;
}

/**
 * The board's stable GitHub ids: its node id, its status field and that
 * field's option ids, and — once resolved — its push field.
 *
 * These change only when someone edits the board's structure, but resolving
 * them costs a `project view` and a `field-list` call every time. The worker
 * ticks every two seconds, so re-resolving per tick spent thousands of
 * GraphQL points an hour on facts that had not changed -- enough to exhaust
 * the account's hourly limit and take every other `gh` call down with it.
 * Callers cache this on the Project's scheduling row and pass it back in.
 *
 * `pushField` distinguishes three states, which the cache stores verbatim:
 * `undefined` means it has not been resolved yet, `null` means the board has
 * no such field, and an object is the field. Only the first costs a call.
 */
export interface BoardIdentity {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  pushField?: { id: string; options: Record<string, string> } | null;
}

/**
 * Items, in the board's own order, with the `Arcadia status` and
 * `Arcadia push` values each one carries.
 *
 * This is a GraphQL read rather than `gh project item-list` because the fields
 * have to be addressed by their exact names. `item-list --format json`
 * flattens custom fields into camelCased keys derived from the field's title,
 * so "Arcadia status" arrives as some spelling this code would have to guess
 * at; guessing wrong reads every status as absent, and a projection that
 * believes every card is unset rewrites every status on every tick forever.
 * GraphQL's `fieldValueByName` takes the name verbatim and answers for that
 * field alone — and answers null for a field the board does not have, so the
 * same query works before and after `schedule github link` creates the push
 * field.
 */
const ITEMS_QUERY = `query($project: ID!, $status: String!, $push: String!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on Issue { number title url }
            ... on PullRequest { number title url }
            ... on DraftIssue { title }
          }
          fieldValueByName(name: $status) {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          push: fieldValueByName(name: $push) {
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
          content?: { number?: number; title?: string; url?: string } | null;
          fieldValueByName?: { name?: string } | null;
          push?: { name?: string } | null;
        }>;
      };
    };
  };
}

function listBoardItems(run: CommandRunner, config: GitHubBoardConfig, projectId: string): BoardItem[] {
  const items: BoardItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const args = [
      "api", "graphql", "-f", `query=${ITEMS_QUERY}`, "-F", `project=${projectId}`,
      "-f", `status=${BOARD_STATUS_FIELD}`, "-f", `push=${BOARD_PUSH_FIELD}`
    ];
    if (after) args.push("-F", `after=${after}`);
    const response = ghJson<ItemsResponse>(run, config.cwd, args, "project items query");
    const connection = response.data?.node?.items;
    for (const node of connection?.nodes ?? []) {
      items.push({
        itemId: node.id,
        issueNumber: typeof node.content?.number === "number" ? node.content.number : null,
        url: typeof node.content?.url === "string" ? node.content.url : null,
        title: node.content?.title ?? "",
        status: typeof node.fieldValueByName?.name === "string" ? node.fieldValueByName.name : null,
        push: typeof node.push?.name === "string" ? node.push.name : null
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
 *
 * A missing `Arcadia push` field is not a refusal. It is the optional half of
 * the projection — an existing board keeps working, and its cards simply carry
 * no push label until the operator links the field.
 */
export function createGitHubBoard(
  config: GitHubBoardConfig,
  run: CommandRunner = runGh,
  cached?: BoardIdentity | null
): SchedulingBoard & { identity: BoardIdentity } {
  const owner = config.owner;
  const number = String(config.number);
  const identity = cached ?? resolveBoardIdentity(config, run);
  const projectId = identity.projectId;
  const statusField: StatusField = { id: identity.statusFieldId, options: new Map(Object.entries(identity.statusOptions)) };
  const pushField = identity.pushField ?? null;

  return {
    identity,
    pushField,
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
      try {
        const added = ghJson<{ id: string }>(run, config.cwd, ["project", "item-add", number, "--owner", owner, "--url", url, "--format", "json"], "item-add");
        return added.id;
      } catch (error) {
        // GitHub refuses to add an Issue that is already an item on this
        // board. That happens when a prior pass added it but crashed before
        // `upsertSchedulingAction` persisted the item id locally, so the next
        // pass sees `githubProjectItemId === null` and tries again -- the item
        // already exists, so look it up and reuse it instead of treating
        // GitHub's refusal as fatal.
        if (error instanceof ArcadiaError && /content already exists in this project/i.test(error.message)) {
          // Match by URL, not issue number: a Project can hold Issues from more
          // than one repository, and numbers repeat across repositories, so a
          // number-only match could pick up an unrelated Issue's item here.
          const existing = listBoardItems(run, config, projectId).find((item) => item.url === url);
          if (existing) return existing.itemId;
        }
        throw error;
      }
    },
    setStatus(itemId, status) {
      const optionId = statusField.options.get(status)!;
      const edited = run(config.cwd, "gh", [
        "project", "item-edit", "--project-id", projectId, "--id", itemId, "--field-id", statusField.id, "--single-select-option-id", optionId
      ]);
      if (!edited.ok) throw validationError(`GitHub item-edit failed: ${edited.stderr.trim()}`);
    },
    setPush(itemId, push) {
      if (!pushField) throw validationError(`GitHub Project ${owner}/${number} has no "${BOARD_PUSH_FIELD}" field.`, {
        remedy: `Run \`arcadia schedule github link\` to add it; a projection never creates board fields.`
      });
      const optionId = pushField.options[push];
      const edited = run(config.cwd, "gh", [
        "project", "item-edit", "--project-id", projectId, "--id", itemId, "--field-id", pushField.id, "--single-select-option-id", optionId
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
 * Resolve the board's ids from GitHub. Two calls, so callers cache the result
 * and only come back here when the cache is absent or has gone stale. The push
 * field is optional and resolved in the same `field-list` as the status field,
 * so its presence or absence costs nothing extra.
 */
export function resolveBoardIdentity(config: GitHubBoardConfig, run: CommandRunner = runGh): BoardIdentity {
  const view = ghJson<{ id: string }>(
    run, config.cwd, ["project", "view", String(config.number), "--owner", config.owner, "--format", "json"], "project view"
  );
  const fields = findBoardFields(run, config);
  const status = requireStatusField(fields, config);
  const push = requirePushField(fields, config);
  return {
    projectId: view.id,
    statusFieldId: status.id,
    statusOptions: Object.fromEntries(status.options),
    pushField: push ? { id: push.id, options: Object.fromEntries(push.options) } : null
  };
}

/**
 * Create the `Arcadia status` and `Arcadia push` fields when the board does
 * not have them. Only `schedule github link` calls this, so board schema
 * changes stay an explicit operator act rather than something a read path
 * performs on its own.
 */
export function ensureBoardFields(
  config: GitHubBoardConfig,
  run: CommandRunner = runGh
): { statusCreated: boolean; pushCreated: boolean } {
  const fields = findBoardFields(run, config);
  let statusCreated = false;
  let pushCreated = false;

  if (!fields.status) {
    createField(config, run, BOARD_STATUS_FIELD, BOARD_STATUSES);
    statusCreated = true;
  }
  if (!fields.push) {
    createField(config, run, BOARD_PUSH_FIELD, BOARD_PUSHES);
    pushCreated = true;
  }

  // Re-read once so a creation that silently did nothing is a refusal here,
  // not a confusing failure on the next projection. Both fields are verified:
  // a push field missing an option would otherwise reach `setPush` as an
  // undefined option id and fail on the next projection instead.
  const created = findBoardFields(run, config);
  requireStatusField(created, config);
  requirePushField(created, config);
  return { statusCreated, pushCreated };
}

function createField(config: GitHubBoardConfig, run: CommandRunner, name: string, options: readonly string[]): void {
  const created = run(config.cwd, "gh", [
    "project", "field-create", String(config.number), "--owner", config.owner, "--name", name,
    "--data-type", "SINGLE_SELECT", "--single-select-options", options.join(",")
  ]);
  if (!created.ok) throw validationError(`GitHub field-create failed for "${name}": ${created.stderr.trim()}`);
}

function requireStatusField(fields: BoardFields, config: GitHubBoardConfig): StatusField {
  if (!fields.status) {
    throw validationError(`GitHub Project ${config.owner}/${config.number} has no "${BOARD_STATUS_FIELD}" field.`, {
      remedy: `Run \`arcadia schedule github link --project <slug> --owner ${config.owner} --number ${config.number}\` to create it; reading and projecting never create board fields.`
    });
  }
  const missing = BOARD_STATUSES.filter((status) => !fields.status!.options.has(status));
  if (missing.length > 0) {
    throw validationError(`GitHub field "${BOARD_STATUS_FIELD}" is missing option(s): ${missing.join(", ")}.`, {
      remedy: `Add the missing single-select option(s) to "${BOARD_STATUS_FIELD}" on Project ${config.owner}/${config.number}.`
    });
  }
  return fields.status;
}

/**
 * The push field with every option it needs, or null when the board has none.
 *
 * A present-but-incomplete push field is refused rather than half-used: the
 * projection writes one of eight fixed labels, and an option that does not
 * exist would reach `gh` as an undefined option id and fail on the next tick
 * instead of naming the malformed board.
 */
function requirePushField(fields: BoardFields, config: GitHubBoardConfig): StatusField | null {
  if (!fields.push) return null;
  const missing = BOARD_PUSHES.filter((push) => !fields.push!.options.has(push));
  if (missing.length > 0) {
    throw validationError(`GitHub field "${BOARD_PUSH_FIELD}" is missing option(s): ${missing.join(", ")}.`, {
      remedy: `Add the missing single-select option(s) to "${BOARD_PUSH_FIELD}" on Project ${config.owner}/${config.number}, or delete the field and run \`arcadia schedule github link\` to recreate it.`
    });
  }
  return fields.push;
}

/** Both fields from one `field-list`, since resolving either costs the same call. */
function findBoardFields(run: CommandRunner, config: GitHubBoardConfig): BoardFields {
  const data = ghJson<{ fields: Array<{ id: string; name: string; type?: string; options?: Array<{ id: string; name: string }> }> }>(
    run, config.cwd, ["project", "field-list", String(config.number), "--owner", config.owner, "--format", "json", "--limit", "100"], "field-list"
  );
  return {
    status: fieldNamed(data.fields, BOARD_STATUS_FIELD),
    push: fieldNamed(data.fields, BOARD_PUSH_FIELD)
  };
}

function fieldNamed(
  fields: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }>,
  name: string
): StatusField | null {
  const field = fields.find((candidate) => candidate.name === name);
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

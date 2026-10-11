import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Command } from "commander";
import { ArcadiaError } from "../cli/errors.js";
import { loadUserConfig, readExperimentWorkspace, type ExperimentWorkspace } from "./config.js";
import { getWorkspacePaths } from "./paths.js";
import { resolveWorkspace, type WorkspaceResolutionSource } from "./resolve.js";

/**
 * The experiment-workspace guard (Decision 0082): the single module that
 * decides which operations an experiment workspace may not perform.
 *
 * The stance is allow-by-default. An experiment workspace exists to give
 * agents room to move — Asks, queue and pointer moves, settlement, docs sync,
 * Project import, scratch fixture repositories, local Git and tests all run
 * unchanged. Only the short named list below is refused, and only because it
 * touches what every workspace shares: host-global configuration, launchd
 * services, the go-broker and its agent trust, GitHub and Discord, or the
 * production authorization. Read-only commands are never refused, and nothing
 * here applies when the resolved workspace is an ordinary one.
 *
 * Every CLI command must appear in `COMMAND_CLASSIFICATION`;
 * `tests/experiment-workspace-guard.test.ts` walks the Commander tree and
 * fails the build when a new command is not classified.
 */

export type CommandClassification =
  | { kind: "allowed" }
  | { kind: "exempt"; reason: string }
  | {
      kind: "guarded";
      reason: string;
      alternative: string;
      /** When present and true, this particular invocation stays inside the experiment and is allowed. */
      allowWhen?: (context: GuardContext) => boolean;
    };

export interface GuardContext {
  options: Record<string, unknown>;
  experiment: ExperimentWorkspace;
  /** How the experiment workspace was resolved (flag, environment variable, local marker, user config). */
  source: WorkspaceResolutionSource;
}

const ALLOWED: CommandClassification = { kind: "allowed" };

function exempt(reason: string): CommandClassification {
  return { kind: "exempt", reason };
}

function guarded(reason: string, alternative: string, allowWhen?: (context: GuardContext) => boolean): CommandClassification {
  return { kind: "guarded", reason, alternative, ...(allowWhen ? { allowWhen } : {}) };
}

const FROM_LIVE_TERMINAL =
  "Run it from an operator terminal against the live workspace, with no ARCADIA_WORKSPACE or --workspace naming the experiment.";

const PRODUCTION_ALTERNATIVE =
  "Inspect it here with `arcadia production preview` or `production status`; activation exists only in the live workspace, by the operator, under a Decision.";

const DELIVERY_RECEIPT = guarded(
  "Delivery receipts are recorded only by the live Discord sender; nothing from an experiment workspace is ever delivered.",
  "Read the pending outbox here with its list or compose command; delivery belongs to the live workspace's Discord bot."
);

const SHARED_INGRESS = (alternativeVerb: string): CommandClassification => guarded(
  "The default ingress root is the shared iCloud Drive folder the live ingress service drains.",
  `Pass --ingress-root <a directory inside the experiment workspace> to ${alternativeVerb} a private ingress folder.`,
  ({ options, experiment }) => typeof options.ingressRoot === "string" && isInside(experiment.workspacePath, options.ingressRoot)
);

/** A repository path a capability registers must obey the same containment as Project repositories. */
const INSIDE_ALLOWED_ROOT = (option: string, flag: string): CommandClassification => guarded(
  "Registers a repository path outside the experiment's allowed repository root.",
  `Omit ${flag}, or point it at a disposable fixture under the experiment's allowed repository root.`,
  ({ options, experiment }) => typeof options[option] !== "string" || isInside(experiment.allowedRepoRoot, options[option])
);

/**
 * One row per CLI command path (space-separated names below the program).
 * `allowed`: runs unchanged in an experiment workspace. `guarded`: refused
 * while an experiment workspace is resolved. `exempt`: does not act through
 * the resolved workspace at all (it names its own target, or is host- or
 * repository-level), so the guard has nothing to decide, and the CLI records
 * no activity row for it (`recordsActivity`). Mark a command exempt only when
 * neither it nor anything it calls resolves or opens a workspace database, or
 * (the pure observers `workspace leak-check` and `timeline`) opens one only
 * read-only: `tests/activity-no-record-commands.test.ts` runs every exempt
 * command and fails when one opens the default workspace writable or records
 * activity.
 */
export const COMMAND_CLASSIFICATION: Readonly<Record<string, CommandClassification>> = {
  "audit host-preview": exempt("Serves a named static directory on loopback; reads no workspace."),
  init: exempt("Creates the named workspace; `--profile experiment` carries its own refusals."),
  "config set defaultWorkspace": guarded(
    "Every live launchd service follows the user config default; changing it from an experiment context can repoint production.",
    `${FROM_LIVE_TERMINAL} An experiment workspace itself can never be the default.`,
    // Repair path: if a hand edit ever made an experiment the default, this
    // is the command that puts the live workspace back.
    ({ source }) => source === "user config"
  ),
  "config get defaultWorkspace": exempt("Reads the user config only."),
  "workspace resolve": exempt("Reports resolution only."),
  "workspace leak-check": exempt("Reads the live workspace read-only and host file hashes; records no activity."),
  "workspace guard": exempt("Is the guard: it evaluates a named operation for shell callers."),
  "dogfood init": ALLOWED,
  "dogfood ask": ALLOWED,
  "dogfood status": ALLOWED,
  "dogfood review": ALLOWED,
  "dogfood review show": ALLOWED,
  "dogfood review approve": ALLOWED,
  "dogfood review reject": ALLOWED,
  "dogfood review defer": ALLOWED,
  status: ALLOWED,
  ask: ALLOWED,
  "ask show": ALLOWED,
  "ask correct": ALLOWED,
  "ask report": exempt("Reads the resolved workspace database read-only, todo's own projection and the checked-in golden set; writes and records nothing."),
  "ask-trail": ALLOWED,
  "ask-rule test": ALLOWED,
  "agent-ask preview": ALLOWED,
  "agent-ask draft": ALLOWED,
  "agent-ask settle": ALLOWED,
  "agent-ask contract": exempt("Prints the static Agent Ask schema; reads no workspace."),
  "agent-ask pending": ALLOWED,
  "agent-ask notifications": ALLOWED,
  "agent-ask notification-sent": DELIVERY_RECEIPT,
  // Queueing is an outbox write, like `agent-ask settle`; only the live bot ever delivers.
  "ping send": ALLOWED,
  "ping pending": ALLOWED,
  "ping sent": DELIVERY_RECEIPT,
  "action settle": ALLOWED,
  capture: ALLOWED,
  "schedule status": ALLOWED,
  "schedule log": ALLOWED,
  // Calendar intake only captures proposals in the explicitly resolved workspace.
  // It starts no worker and grants no production, publication or delivery authority.
  "schedule register": ALLOWED,
  "schedule recurring": ALLOWED,
  "schedule enable": ALLOWED,
  "schedule pause": ALLOWED,
  "schedule tick": ALLOWED,
  "schedule retry": ALLOWED,
  "schedule prioritize": ALLOWED,
  "schedule classify": ALLOWED,
  "schedule discover": ALLOWED,
  // Board writes happen only for Projects bound by `schedule github link`, which is guarded.
  "schedule reconcile": ALLOWED,
  "schedule resume": ALLOWED,
  "schedule github link": guarded(
    "Creates or edits a GitHub Project board and its fields.",
    `${FROM_LIVE_TERMINAL} Experiment fixture repositories have no remote to project to.`
  ),
  "production status": ALLOWED,
  "production freeze-check": ALLOWED,
  "production preview": ALLOWED,
  "production activate": guarded("Grants the standing production authorization and its Grants.", PRODUCTION_ALTERNATIVE),
  "production reactivate-preview": ALLOWED,
  "production reactivate": guarded("Replays a production authorization and its Grants into a fresh epoch.", PRODUCTION_ALTERNATIVE),
  "production deactivate": ALLOWED,
  "production reset-repair-budget": ALLOWED,
  "production capacity": ALLOWED,
  "production capacity attest": guarded(
    "Writes the host-global operator capacity receipt under ~/.arcadia/telemetry that the live admission gate trusts.",
    `Read capacity here with \`arcadia production capacity\`. ${FROM_LIVE_TERMINAL}`
  ),
  "back-burner list": ALLOWED,
  "back-burner show": ALLOWED,
  "back-burner promote": ALLOWED,
  "back-burner archive": ALLOWED,
  defect: ALLOWED,
  "defect list": ALLOWED,
  "defect show": ALLOWED,
  "feedback record": ALLOWED,
  "feedback list": ALLOWED,
  "experiment brief": ALLOWED,
  "project create": ALLOWED,
  "project prepare": ALLOWED,
  "project list": ALLOWED,
  "project show": ALLOWED,
  "project import": ALLOWED,
  "project update": ALLOWED,
  "project metadata": ALLOWED,
  "project reply": ALLOWED,
  "project setup-context": ALLOWED,
  "inbox add": ALLOWED,
  "inbox import": ALLOWED,
  queue: ALLOWED,
  attention: ALLOWED,
  advance: ALLOWED,
  "advance queue": ALLOWED,
  "advance queue reorder": ALLOWED,
  "advance queue make-next": ALLOWED,
  "advance queue arrange": ALLOWED,
  "advance queue undo": ALLOWED,
  "session show": ALLOWED,
  "session preview-launch": ALLOWED,
  "session launch": ALLOWED,
  "session reconcile": ALLOWED,
  "pr assess-blast-radius": ALLOWED,
  "pr code-review": exempt("Reads a pull request's advisory review from GitHub for the named repository; reads no workspace."),
  "pr decline-finding": guarded(
    "Posts a reply on a GitHub review thread and resolves it.",
    `Read the review with \`arcadia pr code-review\`. ${FROM_LIVE_TERMINAL}`
  ),
  "decision new": ALLOWED,
  "decision approve": ALLOWED,
  "decision reverse": ALLOWED,
  "decision validate": ALLOWED,
  "decision list": ALLOWED,
  "blog sites": ALLOWED,
  "blog configure-site": INSIDE_ALLOWED_ROOT("contentRepoPath", "--content-repo-path"),
  "blog create-idea": ALLOWED,
  "blog prepare-schedule": ALLOWED,
  "blog draft-post": ALLOWED,
  "blog review": ALLOWED,
  "rebuster configure": INSIDE_ALLOWED_ROOT("repoPath", "--repo-path"),
  "rebuster status": ALLOWED,
  "rebuster create-rebus": ALLOWED,
  "rebuster ingest-event": ALLOWED,
  "dashboard snapshot": ALLOWED,
  "dashboard runs": ALLOWED,
  "codex list": ALLOWED,
  "codex sync": ALLOWED,
  "codex associate": ALLOWED,
  runtime: ALLOWED,
  "ingress list": ALLOWED,
  "ingress activity": ALLOWED,
  "ingress describe": SHARED_INGRESS("queue into"),
  "ingress capture": SHARED_INGRESS("capture into"),
  "ingress process": SHARED_INGRESS("process"),
  "ingress recover": guarded(
    "Applying a recovery requeues files in the shared iCloud Drive ingress folder.",
    "Omit --apply to see what would be requeued, or pass --ingress-root <a directory inside the experiment workspace>.",
    ({ options, experiment }) => options.apply !== true
      || (typeof options.ingressRoot === "string" && isInside(experiment.workspacePath, options.ingressRoot))
  ),
  "ingress service install": guarded("Writes and loads a host launchd service.", FROM_LIVE_TERMINAL),
  "ingress service status": ALLOWED,
  "ingress service doctor": ALLOWED,
  "ingress service run": guarded("Is the launchd service's own tick, which drains the shared ingress folder.", FROM_LIVE_TERMINAL),
  "ingress service uninstall": guarded("Unloads and removes a host launchd service.", FROM_LIVE_TERMINAL),
  "workflow list": ALLOWED,
  "workflow show": ALLOWED,
  "workflow match": ALLOWED,
  "workflow validate": ALLOWED,
  "workflow add": ALLOWED,
  "workflow enable": ALLOWED,
  "workflow disable": ALLOWED,
  "workflow run": ALLOWED,
  "workflow runs": ALLOWED,
  "workflow run-info show": ALLOWED,
  "digest compose": ALLOWED,
  "digest export": ALLOWED,
  "digest run": ALLOWED,
  "digest mark-posted": DELIVERY_RECEIPT,
  "artifact create": ALLOWED,
  "artifact list": ALLOWED,
  "artifact update": ALLOWED,
  "artifact validate-planning": ALLOWED,
  "work monitor": ALLOWED,
  "work prs": ALLOWED,
  "work list": ALLOWED,
  "work update": ALLOWED,
  "work add-subtask": ALLOWED,
  "work show-question": ALLOWED,
  "work resolve-question": ALLOWED,
  "work done": ALLOWED,
  "work archive": ALLOWED,
  "work unarchive": ALLOWED,
  "work plan": ALLOWED,
  "work seed-zero-prompt-rehearsal-packets": ALLOWED,
  "work run": ALLOWED,
  "run list": ALLOWED,
  "run show": ALLOWED,
  "run retry": ALLOWED,
  "log create": ALLOWED,
  "milestone list": ALLOWED,
  "milestone create": ALLOWED,
  "milestone complete": ALLOWED,
  "report status": ALLOWED,
  "report daily": ALLOWED,
  "report weekly": ALLOWED,
  "memory sync": ALLOWED,
  "memory system sync": ALLOWED,
  review: ALLOWED,
  "review open": ALLOWED,
  "review show": ALLOWED,
  "review reassess": ALLOWED,
  "review flag-agent": ALLOWED,
  "review approve": ALLOWED,
  "review reject": ALLOWED,
  "review defer": ALLOWED,
  "review resolve-reply": ALLOWED,
  "review weekly": ALLOWED,
  "qa list": ALLOWED,
  "qa record": ALLOWED,
  "qa status": ALLOWED,
  "qa fetch": ALLOWED,
  "qa verdict": ALLOWED,
  "qa switch": ALLOWED,
  "qa restart": guarded(
    "Restarts a QA target's services, which for Arcadia are the live dashboard, worker and Intelligence launchd services.",
    FROM_LIVE_TERMINAL
  ),
  "qa refresh": guarded(
    "Restarts a QA target's services after fast-forwarding it.",
    `Pass --skip-restart to only fast-forward the checkout, or ${FROM_LIVE_TERMINAL.charAt(0).toLowerCase()}${FROM_LIVE_TERMINAL.slice(1)}`,
    ({ options }) => options.skipRestart === true
  ),
  "qa pr": ALLOWED,
  "qa code-review": ALLOWED,
  "proof-target list": ALLOWED,
  "proof-target check": ALLOWED,
  clarify: ALLOWED,
  tidy: ALLOWED,
  "tidy list": exempt("Lists the named repository's quarantined tidy runs; reads no workspace."),
  "tidy undo": exempt("Restores one quarantined tidy run in the named repository; reads no workspace."),
  "push-unpushed": guarded(
    "Applying pushes branches to a Git remote.",
    "Omit --apply to see what would be pushed; experiment fixture repositories have no remote.",
    ({ options }) => options.apply !== true
  ),
  triggers: exempt("Reads the named repository's managed documents only."),
  docket: exempt("Reads the named repository's managed documents only; no workspace, no portfolio."),
  plans: exempt("Reads the named repository's managed documents only."),
  "operator-task list": exempt("Reads the named repository's operator-task records only; reads no workspace."),
  "operator-task show": exempt("Reads the named repository's operator-task records only; reads no workspace."),
  "operator-task raise": exempt("Writes the named repository's operator-task records only; reads no workspace."),
  "operator-task evidence": exempt("Writes the named repository's operator-task records only; reads no workspace."),
  "operator-task close": exempt("Writes the named repository's operator-task records only; reads no workspace."),
  "operator-task decline": exempt("Writes the named repository's operator-task records only; reads no workspace."),
  next: ALLOWED,
  "next history": ALLOWED,
  go: ALLOWED,
  "go-broker install": guarded(
    "Installs the one host-wide go-broker and writes Codex and Claude trust (~/.codex/config.toml, ~/.claude.json) for the resolved workspace's repositories.",
    `Check it with \`arcadia go-broker status\`. ${FROM_LIVE_TERMINAL}`
  ),
  "go-broker status": ALLOWED,
  "go-broker ensure": guarded(
    "May reinstall the one host-wide go-broker and rewrite Codex and Claude trust.",
    `Check it with \`arcadia go-broker status\`. ${FROM_LIVE_TERMINAL}`
  ),
  "docs sync": ALLOWED,
  "gate complete": ALLOWED,
  "gate reopen": ALLOWED,
  now: ALLOWED,
  path: ALLOWED,
  "identity resolve": exempt("Resolves an agent identity from the checked-in roster; reads no workspace."),
  "identity roster": exempt("Prints the checked-in roster; reads no workspace."),
  portfolio: ALLOWED,
  way: ALLOWED,
  "way propagate": guarded(
    "Opens, and for mechanical changes merges, pull requests in adopting repositories.",
    "Pass --dry-run to see what would be propagated.",
    ({ options }) => options.dryRun === true
  ),
  "worker start": guarded("Runs the production worker loop, which launches Sessions and posts to GitHub.", FROM_LIVE_TERMINAL),
  "worker stop": guarded("Stops the worker through the host-wide launchd label, which is the live worker's.", FROM_LIVE_TERMINAL),
  "worker status": ALLOWED,
  "worker install": guarded("Writes and loads the host launchd worker service.", FROM_LIVE_TERMINAL),
  "worker uninstall": guarded("Unloads and removes the host launchd worker service.", FROM_LIVE_TERMINAL),
  "intelligence serve": ALLOWED,
  "intelligence smoke-image": ALLOWED,
  "intelligence smoke-speech": ALLOWED,
  "intelligence narrate": ALLOWED,
  "intelligence list-jobs": ALLOWED,
  "intelligence usage": ALLOWED,
  "orientation entry add": ALLOWED,
  "orientation entry list": ALLOWED,
  "orientation entry confirm": ALLOWED,
  "orientation entry complete": ALLOWED,
  "orientation entry drop": ALLOWED,
  "orientation entry update": ALLOWED,
  "orientation fits": ALLOWED,
  "orientation timeline": ALLOWED,
  "orientation capacity set": ALLOWED,
  "orientation capacity show": ALLOWED,
  "orientation capacity clear": ALLOWED,
  "orientation packet compose": ALLOWED,
  "orientation packet export": ALLOWED,
  "orientation packet mark-sent": DELIVERY_RECEIPT,
  "orientation packet list": ALLOWED,
  "orientation reply": ALLOWED,
  "time log": ALLOWED,
  "time list": ALLOWED,
  activity: ALLOWED,
  todo: exempt("Reads the resolved workspace database read-only and the Projects' checked-in Decisions; writes and records nothing."),
  timeline: exempt("Reads the resolved workspace database read-only and its repositories with read-only Git; writes and records nothing."),
  "mission-control overview": ALLOWED,
  "mission-control node": ALLOWED,
  "mission-control fits": ALLOWED,
  "mission-control reply": ALLOWED
};

/**
 * Host-global operations reached outside a single CLI command, or deep inside
 * one, that call the same guard: the services script, the Discord bot, the
 * trust writes, the launchd plist writers, the `/runs` operator runner and the
 * Arcadia Project seed.
 */
export const GUARDED_OPERATIONS: Readonly<Record<string, { reason: string; alternative: string }>> = {
  "services.restart": {
    reason: "The restart script points the live worker and Intelligence launchd services at ARCADIA_WORKSPACE.",
    alternative: "Restart services from an operator terminal with no ARCADIA_WORKSPACE naming the experiment."
  },
  "services.stop": {
    reason: "Stops the host's live launchd services.",
    alternative: "Stop services from an operator terminal with no ARCADIA_WORKSPACE naming the experiment."
  },
  "discord-bot.start": {
    reason: "The Discord bot posts to the operator's real channel.",
    alternative: "Read the outbox with `arcadia agent-ask notifications` or `orientation packet list`; only the live workspace has a Discord sender."
  },
  "go-broker.trust-write": {
    reason: "Writes Codex and Claude trust into ~/.codex/config.toml and ~/.claude.json, which every workspace shares.",
    alternative: FROM_LIVE_TERMINAL
  },
  "launchd.plist-write": {
    reason: "Writes a host launchd service definition.",
    alternative: FROM_LIVE_TERMINAL
  },
  "operator-script.run": {
    reason: "The `/runs` operator runner settles and publishes to origin with operator authority.",
    alternative: "Settle in the experiment with `arcadia agent-ask settle`; operator scripts run only against the live workspace."
  },
  "arcadia-project.seed": {
    reason: "An experiment workspace never carries the real Arcadia Project.",
    alternative: "Register a disposable fixture repository under the workspace's allowed repository root instead."
  }
};

/**
 * Whether the CLI records an activity row for this command. An exempt command
 * reads no workspace state, so recording it would mean resolving a workspace
 * just for the row: with nothing inline that is the user config default, the
 * live workspace. Exempt commands therefore record nothing, and the decision is
 * made before any workspace is resolved or opened.
 */
export function recordsActivity(key: string): boolean {
  return COMMAND_CLASSIFICATION[key]?.kind !== "exempt";
}

/** The space-separated path of a command below the program, e.g. `production capacity attest`. */
export function commandKey(command: Command): string {
  const names: string[] = [];
  for (let current: Command | null = command; current?.parent; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(" ");
}

/** Every command in the tree that has its own action, in tree order. */
export function listActionCommands(program: Command): string[] {
  const keys: string[] = [];
  const walk = (parent: Command): void => {
    for (const child of parent.commands) {
      if ((child as unknown as { _actionHandler: unknown })._actionHandler) keys.push(commandKey(child));
      walk(child);
    }
  };
  walk(program);
  return keys;
}

export function experimentRefusalError(operation: string, experiment: ExperimentWorkspace, reason: string, alternative: string): ArcadiaError {
  return new ArcadiaError(
    "EXPERIMENT_WORKSPACE_REFUSED",
    `Refused in experiment workspace ${experiment.workspacePath}: ${operation}. ${reason}`,
    2,
    { operation, workspace: experiment.workspacePath, reason, alternative, decision: "0082" }
  );
}

function operationRule(operation: string): { reason: string; alternative: string } | null {
  const rule = COMMAND_CLASSIFICATION[operation];
  if (rule?.kind === "guarded") return { reason: rule.reason, alternative: rule.alternative };
  return GUARDED_OPERATIONS[operation] ?? null;
}

/** Whether `operation` names a guarded command or a guarded host operation. */
export function isGuardedOperation(operation: string): boolean {
  return operationRule(operation) !== null;
}

/**
 * Throws the named refusal when `workspacePath` is an experiment workspace;
 * does nothing for an ordinary or unresolved one.
 */
export function refuseInExperimentWorkspace(operation: string, workspacePath: string | null | undefined): void {
  if (!workspacePath) return;
  const experiment = readExperimentWorkspace(workspacePath);
  if (!experiment) return;
  const rule = operationRule(operation);
  if (!rule) throw new Error(`Unknown guarded operation: ${operation}`);
  throw experimentRefusalError(operation, experiment, rule.reason, rule.alternative);
}

/**
 * The CLI choke point: called before every command action. Allowed, exempt
 * and unknown commands pass without even resolving a workspace, so the guard
 * costs nothing on the overwhelmingly common path.
 */
export function guardCommandInvocation(command: Command): { refused: ArcadiaError; key: string; workspace: string } | null {
  const key = commandKey(command);
  if (COMMAND_CLASSIFICATION[key]?.kind !== "guarded") return null;
  return evaluateCommandGuard(key, command.optsWithGlobals<Record<string, unknown>>());
}

/** The guard's decision for one command path and its parsed options. */
export function evaluateCommandGuard(
  key: string,
  options: Record<string, unknown>
): { refused: ArcadiaError; key: string; workspace: string } | null {
  const rule = COMMAND_CLASSIFICATION[key];
  if (rule?.kind !== "guarded") return null;
  const workspace = typeof options.workspace === "string" ? options.workspace : undefined;
  const resolution = resolveWorkspace({ workspace });
  const resolved = resolution.workspacePath;
  if (!resolved) return null;
  const experiment = readExperimentWorkspace(resolved);
  if (!experiment) return null;
  if (rule.allowWhen?.({ options, experiment, source: resolution.source })) return null;
  return { refused: experimentRefusalError(key, experiment, rule.reason, rule.alternative), key, workspace: resolved };
}

// ---------------------------------------------------------------------------
// Repository containment
// ---------------------------------------------------------------------------

/**
 * realpath of the nearest existing ancestor, plus the not-yet-existing rest.
 * A dangling symlink counts as existing and is followed to its target, so
 * `<exp>/projects/x -> /outside/new` canonicalizes outside the experiment
 * instead of reading as a not-yet-created path inside it.
 */
export function canonicalPath(candidate: string, depth = 0): string {
  const absolute = path.resolve(candidate);
  const rest: string[] = [];
  let current = absolute;
  for (;;) {
    let stat: ReturnType<typeof lstatSync> | null;
    try { stat = lstatSync(current); } catch { stat = null; }
    if (stat) {
      if (stat.isSymbolicLink() && !existsSync(current)) {
        if (depth >= 32) throw new Error(`Too many symbolic links resolving ${candidate}`);
        const target = path.resolve(path.dirname(current), readlinkSync(current));
        return canonicalPath(path.join(target, ...rest), depth + 1);
      }
      return path.join(realpathSync(current), ...rest);
    }
    const parent = path.dirname(current);
    if (parent === current) return absolute;
    rest.unshift(path.basename(current));
    current = parent;
  }
}

/** Strictly inside: the root itself is not inside itself. */
export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(canonicalPath(root), canonicalPath(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * A Project repository registered in an experiment workspace must live under
 * its allowed root and must not be any repository the live workspace has
 * registered. An ordinary workspace is unaffected.
 */
export function assertRepoPathAllowed(workspacePath: string, repoPath: string, env: NodeJS.ProcessEnv = process.env): void {
  const experiment = readExperimentWorkspace(workspacePath);
  if (!experiment) return;
  if (!isInside(experiment.allowedRepoRoot, repoPath)) {
    throw new ArcadiaError(
      "EXPERIMENT_WORKSPACE_REFUSED",
      `An experiment workspace may register only repositories inside ${experiment.allowedRepoRoot}.`,
      2,
      {
        operation: "project.repo-path",
        workspace: experiment.workspacePath,
        repoPath: path.resolve(repoPath),
        allowedRepoRoot: experiment.allowedRepoRoot,
        alternative: `Create or clone a disposable fixture repository under ${experiment.allowedRepoRoot} and register that path.`,
        decision: "0082"
      }
    );
  }
  const live = liveRepositoryPaths(experiment, env);
  const candidate = canonicalPath(repoPath);
  if (live.includes(candidate)) {
    throw new ArcadiaError(
      "EXPERIMENT_WORKSPACE_REFUSED",
      "This repository is already registered in the live workspace; an experiment workspace never shares a repository with it.",
      2,
      {
        operation: "project.repo-path",
        workspace: experiment.workspacePath,
        repoPath: candidate,
        alternative: `Use a separate disposable clone under ${experiment.allowedRepoRoot}.`,
        decision: "0082"
      }
    );
  }
}

/**
 * Repository paths of the live workspace (the user config default), read
 * through a read-only connection. Fails closed: if the live database exists
 * but cannot be read, the registration is refused rather than unchecked.
 */
function liveRepositoryPaths(experiment: ExperimentWorkspace, env: NodeJS.ProcessEnv): string[] {
  const configured = loadUserConfig(env).defaultWorkspace;
  if (!configured?.trim()) return [];
  const liveRoot = path.resolve(configured);
  if (canonicalPath(liveRoot) === canonicalPath(experiment.workspacePath)) return [];
  const databaseFile = getWorkspacePaths(liveRoot).databaseFile;
  if (!existsSync(databaseFile)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(databaseFile, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_metadata'").get();
    if (!table) return [];
    const rows = db.prepare("SELECT repo_path FROM project_metadata WHERE repo_path IS NOT NULL AND repo_path != ''").all() as Array<{ repo_path: string }>;
    return rows.map((row) => canonicalPath(row.repo_path));
  } catch (error) {
    throw new ArcadiaError(
      "EXPERIMENT_WORKSPACE_REFUSED",
      "Could not read the live workspace's registered repositories, so this registration cannot be checked.",
      1,
      {
        operation: "project.repo-path",
        liveWorkspace: liveRoot,
        cause: error instanceof Error ? error.message : String(error),
        alternative: "Retry once the live workspace database is readable; the check never writes to it."
      }
    );
  } finally {
    db?.close();
  }
}

/**
 * The workspace a connection belongs to, from its file name
 * (`<workspace>/database/arcadia.sqlite3`), or null for any other database.
 */
export function workspaceOfDatabase(db: Database.Database): string | null {
  const file = db.name;
  if (!file || file === ":memory:" || !path.isAbsolute(file)) return null;
  if (path.basename(file) !== "arcadia.sqlite3" || path.basename(path.dirname(file)) !== "database") return null;
  return path.dirname(path.dirname(file));
}

import { execFileSync } from "node:child_process";
import path from "node:path";
import type Database from "better-sqlite3";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  buildCapsule,
  checkCapsule,
  hashSnapshotFile,
  readCapsuleFile,
  renderCapsuleMarkdown,
  writeLiveCapsule,
  type Capsule,
  type CapsuleCheck,
  type CapsuleSources
} from "../coordinator/capsule.js";
import {
  acceptGeneration,
  assertCoordinatorCustody,
  clearVerifyPass,
  currentCustodian,
  custodianOf,
  relayCoordinatorSessions,
  type CustodyAdmission,
  type RelaySessionVerdict
} from "../coordinator/generations.js";
import { withRelayLock } from "../coordinator/lock.js";
import { coordinatorPaths } from "../coordinator/paths.js";
import { defaultCapsuleSources } from "../coordinator/sources.js";
import {
  appendJournal,
  normalizeNoteText,
  parsePrNumbers,
  readCoordinatorState,
  writeCoordinatorState
} from "../coordinator/state.js";
import { verifyGeneration, type VerifyResult } from "../coordinator/verify.js";
import { renewCoordinator, systemRelayDeps, type RelayDeps, type RenewResult } from "../coordinator/relay.js";
import { observeProviderCapacity } from "../codingAgents/capacity.js";
import { checkProviderSignIn } from "../codingAgents/signIn.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import { queueOperatorPing } from "../ping/operatorPing.js";
import { loadWorkspaceConfig, unmeteredProviderSelector } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";

interface Scope { workspace: string; project: string; role: string }
type SourceOverride = { sources?: CapsuleSources; repo?: string };

export function repositoryRoot(explicit?: string): string {
  if (explicit) return explicit;
  // The launcher changes into Arcadia's own checkout, so the repository is the
  // one the operator stood in (invocationRoot), not process.cwd().
  const from = invocationRoot();
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: from, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || from;
  } catch {
    return from;
  }
}

/**
 * The repository `renew` cuts the successor's worktree from: always the main
 * worktree, so a renew run from a coordinator's own linked worktree never nests
 * the successor inside it. An explicit --repo wins. Null when the invocation
 * directory is not inside a repository with a main worktree.
 */
export function mainWorktreeRoot(explicit?: string): string | null {
  if (explicit) return explicit;
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: invocationRoot(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return common !== "" && path.basename(common) === ".git" ? path.dirname(common) : null;
  } catch {
    return null;
  }
}

function sourcesFor(db: Database.Database, workspacePath: string, scope: Scope, options: SourceOverride, now: Date): CapsuleSources {
  return options.sources ?? defaultCapsuleSources({
    db, repoRoot: repositoryRoot(options.repo), project: scope.project, paths: coordinatorPaths(workspacePath, scope.project, scope.role), now
  });
}

function generationOf(admission: CustodyAdmission): number | null {
  return admission.kind === "unfenced" ? null : admission.generation.generation;
}

/** Rebuilds the live projection from canonical sources and the coordinator's own state. Callers hold the relay lock. */
function refreshLive(db: Database.Database, workspacePath: string, scope: Scope, sources: CapsuleSources, now: Date): Capsule {
  const paths = coordinatorPaths(workspacePath, scope.project, scope.role);
  const custodian = currentCustodian(db, scope.project, scope.role);
  const capsule = buildCapsule({
    project: scope.project, role: scope.role, generation: custodian?.generation ?? null, custodian: custodianOf(custodian),
    assignment: { briefPath: custodian?.briefPath ?? null, briefSha: custodian?.briefSha ?? null, directives: [] },
    state: readCoordinatorState(paths), sources, now
  });
  writeLiveCapsule(paths, capsule);
  return capsule;
}

export interface CoordinatorCapsuleData { livePath: string; capsule: Capsule; check: CapsuleCheck; markdown: string | null }

/** `arcadia coordinator capsule`: refresh and print the live view; `--check` fails on a stale journal or a missing next move. */
export function runCoordinatorCapsuleCommand(options: Scope & SourceOverride & { now?: Date; check?: boolean; markdown?: boolean }): CommandSuccess<CoordinatorCapsuleData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const paths = coordinatorPaths(workspacePath, options.project, options.role);
  const data = withDatabase(workspacePath, (db) => withRelayLock(paths.root, () => {
    const capsule = refreshLive(db, workspacePath, options, sourcesFor(db, workspacePath, options, options, now), now);
    return { livePath: paths.live, capsule, check: checkCapsule(capsule, now), markdown: options.markdown ? renderCapsuleMarkdown(capsule, now) : null };
  }));
  if (options.check && !data.check.passed) process.exitCode = 1;
  return createSuccess({ command: "coordinator.capsule", workspace: workspacePath, data });
}

export function renderCoordinatorCapsuleSuccess(response: CommandSuccess<CoordinatorCapsuleData>): string[] {
  const { data } = response;
  if (data.markdown) return [data.markdown.trimEnd()];
  return [
    `Capsule for ${data.capsule.role} (${data.capsule.project}), generation ${data.capsule.generation ?? "none"}: ${data.livePath}`,
    data.check.passed ? "Check: passed." : `Check: ${data.check.problems.length} problem(s).`,
    ...data.check.problems.map((problem) => `- ${problem}`)
  ];
}

export interface CoordinatorNoteData { journalEntries: number; nextMove: string | null; chatOnlyApprovals: number; prs: number[] }

/** `arcadia coordinator note`: the agent's short journal of judgements, written as it goes. Guarded. */
export function runCoordinatorNoteCommand(options: Scope & {
  text: string; nextMove?: boolean; chatApproval?: boolean; pr?: string[]; now?: Date; env?: NodeJS.ProcessEnv;
}): CommandSuccess<CoordinatorNoteData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const text = normalizeNoteText(options.text);
  const prs = parsePrNumbers(options.pr);
  if (options.nextMove && options.chatApproval) throw validationError("A note is either --next-move or --chat-approval, not both.", { reason: "note_kind_conflict" });
  const paths = coordinatorPaths(workspacePath, options.project, options.role);
  const data = withDatabase(workspacePath, (db) => withRelayLock(paths.root, () => {
    const admission = assertCoordinatorCustody(db, { command: "note", env: options.env, project: options.project, role: options.role, now });
    const entry = { at: now.toISOString(), text, generation: generationOf(admission) };
    let state = readCoordinatorState(paths);
    if (options.nextMove) state = { ...state, nextMove: entry };
    else if (options.chatApproval) state = { ...state, chatOnlyApprovals: [...state.chatOnlyApprovals, entry] };
    else state = appendJournal(state, entry);
    state = { ...state, prs: [...new Set([...state.prs, ...prs])] };
    writeCoordinatorState(paths, state);
    return { journalEntries: state.journal.length, nextMove: state.nextMove?.text ?? null, chatOnlyApprovals: state.chatOnlyApprovals.length, prs: state.prs };
  }));
  return createSuccess({ command: "coordinator.note", workspace: workspacePath, data });
}

export function renderCoordinatorNoteSuccess(response: CommandSuccess<CoordinatorNoteData>): string[] {
  const { data } = response;
  return [`Noted. Journal ${data.journalEntries}/20; next move: ${data.nextMove ?? "none"}; chat-only approvals: ${data.chatOnlyApprovals}; tracked PRs: ${data.prs.map((pr) => `#${pr}`).join(", ") || "none"}.`];
}

export interface CoordinatorSubscribeData { subscriptions: Array<{ command: string; cursor: string; armedByGeneration: number | null; inherited: boolean }>; fromSnapshot: string | null }

/**
 * `arcadia coordinator subscribe "<command line>" --cursor <c>` registers a
 * checked-in watcher; `--from-snapshot <sha>` records every watcher the pinned
 * snapshot lists as inherited and unarmed, starting nothing (design section e).
 * Guarded; the incoming generation may run `--from-snapshot`, and a plain
 * subscribe only for a watcher inherited from its snapshot, which arms it.
 */
export function runCoordinatorSubscribeCommand(options: Scope & {
  commandLine?: string; cursor?: string; fromSnapshot?: string; now?: Date; env?: NodeJS.ProcessEnv;
}): CommandSuccess<CoordinatorSubscribeData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  if (options.fromSnapshot ? options.commandLine !== undefined : options.commandLine === undefined) {
    throw validationError("Give either a watcher command line with --cursor, or --from-snapshot <sha>.", { reason: "subscribe_form" });
  }
  const paths = coordinatorPaths(workspacePath, options.project, options.role);
  const data = withDatabase(workspacePath, (db) => withRelayLock(paths.root, () => {
    const at = now.toISOString();
    let state = readCoordinatorState(paths);
    if (options.fromSnapshot) {
      const admission = assertCoordinatorCustody(db, { command: "subscribe-from-snapshot", env: options.env, project: options.project, role: options.role, snapshotSha: options.fromSnapshot, now });
      if (admission.kind === "unfenced") {
        throw validationError("subscribe --from-snapshot records inherited watchers for a relay-launched generation; run it with that generation's coordinator identity.", { reason: "subscribe_from_snapshot_identity" });
      }
      const file = admission.generation.snapshotPath;
      if (!file || hashSnapshotFile(file) !== options.fromSnapshot) {
        throw validationError(`The snapshot for generation ${admission.generation.generation} is missing or does not match ${options.fromSnapshot}; nothing was recorded.`, { reason: "snapshot_mismatch" });
      }
      const snapshot = readCapsuleFile(file);
      // Recorded as inherited and unarmed: the CLI starts no process, and only
      // the successor running the watcher itself may then arm it with a plain
      // `subscribe "<command>" --cursor <c>`. Verify reports the true state.
      const inherited = snapshot.subscriptions.map((subscription) => ({ command: subscription.command, cursor: subscription.cursor, armedAt: at, armedByGeneration: null, inherited: true }));
      const kept = state.subscriptions.filter((have) => !inherited.some((next) => next.command === have.command));
      state = { ...state, subscriptions: [...kept, ...inherited] };
      // Re-flagging watchers invalidates any earlier verify pass: accept needs a fresh one.
      clearVerifyPass(db, options.project, options.role, admission.generation.generation, now);
    } else {
      const admission = assertCoordinatorCustody(db, { command: "subscribe", env: options.env, project: options.project, role: options.role, now });
      const command = (options.commandLine ?? "").trim();
      if (command === "") throw validationError("A subscription needs its checked-in command line.", { reason: "empty_subscription" });
      // The incoming generation may register any watcher the state already holds: one inherited
      // from the snapshot, or one the predecessor registered after it (a late watcher).
      if (admission.kind === "incoming" && !state.subscriptions.some((have) => have.command === command)) {
        throw validationError("The incoming generation may register only a watcher the predecessor already recorded (run subscribe --from-snapshot first, then give that exact command line).", { reason: "subscribe_not_inherited" });
      }
      if (!options.cursor) throw validationError("A subscription needs --cursor <c> (its last event cursor).", { reason: "subscription_cursor" });
      const next = { command, cursor: options.cursor, armedAt: at, armedByGeneration: generationOf(admission) };
      state = { ...state, subscriptions: [...state.subscriptions.filter((have) => have.command !== command), next] };
    }
    writeCoordinatorState(paths, state);
    return {
      subscriptions: state.subscriptions.map((subscription) => ({ command: subscription.command, cursor: subscription.cursor, armedByGeneration: subscription.armedByGeneration, inherited: subscription.inherited === true })),
      fromSnapshot: options.fromSnapshot ?? null
    };
  }));
  return createSuccess({ command: "coordinator.subscribe", workspace: workspacePath, data });
}

export function renderCoordinatorSubscribeSuccess(response: CommandSuccess<CoordinatorSubscribeData>): string[] {
  return [
    response.data.fromSnapshot
      ? `Inherited watchers from snapshot ${response.data.fromSnapshot}; none is registered by you yet. Run each in the background yourself, then register it with subscribe "<command>" --cursor <c>.`
      : "Subscription registered (a record; it does not prove the watcher process is running).",
    ...response.data.subscriptions.map((subscription) => `- ${subscription.command} (cursor ${subscription.cursor}, ${subscription.inherited ? "inherited, not registered by this generation" : `registered by generation ${subscription.armedByGeneration ?? "none"}`})`)
  ];
}

/** `arcadia coordinator verify --generation N`: exits 0 only when items 1 to 3 pass. */
export function runCoordinatorVerifyCommand(options: Scope & SourceOverride & { generation: number; snapshotSha?: string; now?: Date }): CommandSuccess<VerifyResult> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  if (!Number.isInteger(options.generation) || options.generation < 1) throw validationError("--generation must be a positive integer.", { reason: "invalid_generation" });
  const data = withDatabase(workspacePath, (db) => verifyGeneration(db, workspacePath, {
    project: options.project, role: options.role, generation: options.generation, snapshotSha: options.snapshotSha,
    sources: sourcesFor(db, workspacePath, options, options, now), now
  }));
  if (!data.passed) process.exitCode = 1;
  return createSuccess({ command: "coordinator.verify", workspace: workspacePath, data });
}

export function renderCoordinatorVerifySuccess(response: CommandSuccess<VerifyResult>): string[] {
  const { data } = response;
  return [
    `Verify generation ${data.generation}: ${data.passed ? "passed" : "FAILED"} (snapshot ${data.snapshotSha ?? "none"}).`,
    ...data.items.map((item) => `${item.passed ? "ok  " : item.required ? "FAIL" : "warn"} ${item.id}. ${item.detail}`),
    ...data.cursorChanges.map((change) => `  cursor changed (warning, not a refusal): ${change.command}: ${change.from} -> ${change.to}`),
    ...data.drift.map((change) => `  changed during handoff: ${change.field}: ${JSON.stringify(change.snapshot)} -> ${JSON.stringify(change.now)}`),
    ...(data.journal.length > 0 ? ["Journal (advisory: model-written, not authority):"] : []),
    ...data.journal.map((entry) => `  ${entry.ageMinutes} min${entry.stale ? " (stale)" : ""}: ${entry.text}`),
    ...data.lostApprovals.map((approval) => `  lost chat-only approval: ${approval.text}`)
  ];
}

export interface CoordinatorAcceptData { custodian: number; handedOff: number | null; snapshotSha: string; warnings?: string[] }

/** `arcadia coordinator accept --generation N --snapshot-sha <sha>`: the custody transfer (design step 5). */
export function runCoordinatorAcceptCommand(options: Scope & { generation: number; snapshotSha: string; now?: Date; env?: NodeJS.ProcessEnv }): CommandSuccess<CoordinatorAcceptData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const paths = coordinatorPaths(workspacePath, options.project, options.role);
  const data = withDatabase(workspacePath, (db) => withRelayLock(paths.root, () => {
    const admission = assertCoordinatorCustody(db, { command: "accept", env: options.env, project: options.project, role: options.role, snapshotSha: options.snapshotSha, now });
    if (admission.kind !== "incoming" || admission.generation.generation !== options.generation) {
      throw validationError(`accept is run by the incoming generation ${options.generation} itself, with its own coordinator identity.`, { reason: "accept_identity" });
    }
    const result = acceptGeneration(db, paths, admission.generation, now);
    return { ...result, snapshotSha: options.snapshotSha };
  }));
  return createSuccess({ command: "coordinator.accept", workspace: workspacePath, data });
}

export function renderCoordinatorAcceptSuccess(response: CommandSuccess<CoordinatorAcceptData>): string[] {
  const { data } = response;
  return [
    `Generation ${data.custodian} is now custodian${data.handedOff ? `; generation ${data.handedOff} is handed_off and fenced from the guarded coordinator and ping commands` : ""}.`,
    ...(data.warnings ?? []).map((warning) => `warning: ${warning}`)
  ];
}

/**
 * `arcadia coordinator renew`: the relay launch (change 3). Inert until the
 * standing Decision recording answer A is on main (RELAY_LAUNCH_DECISION_ID).
 * Custody-guarded: a caller with a coordinator identity must be the custodian.
 */
export function runCoordinatorRenewCommand(options: Scope & { repo?: string; effort?: string; env?: NodeJS.ProcessEnv; deps?: RelayDeps }): CommandSuccess<RenewResult> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = mainWorktreeRoot(options.repo);
  const data = withDatabase(workspacePath, (db): RenewResult => {
    assertCoordinatorCustody(db, { command: "renew", env: options.env, project: options.project, role: options.role });
    const deps = options.deps ?? systemRelayDeps({
      sources: () => defaultCapsuleSources({ db, repoRoot: repoRoot ?? repositoryRoot(), project: options.project, paths: coordinatorPaths(workspacePath, options.project, options.role), now: new Date() }),
      ping: (message) => { queueOperatorPing(db, { message, kind: "attention", agent: "coordinator-relay" }); },
      signIn: (provider) => checkProviderSignIn(provider, workspacePath),
      capacity: (provider) => {
        const registries = loadPhase3Registries(workspacePath);
        validatePhase3Registries(registries);
        const unmeteredProvider = unmeteredProviderSelector(loadWorkspaceConfig(getWorkspacePaths(workspacePath).configFile).codingAgent);
        const decision = observeProviderCapacity(registries.codingAgents.profiles, { now: new Date(), unmeteredProvider }).providers.find((entry) => entry.providerId === provider);
        return decision ? { admitted: decision.admitted, reason: decision.reason } : { admitted: false, reason: `No capacity reading for ${provider}.` };
      }
    });
    return renewCoordinator(db, workspacePath, { project: options.project, role: options.role, repoRoot, effort: options.effort ?? "e3_deep" }, deps);
  });
  if (data.outcome !== "launched") process.exitCode = 1;
  return createSuccess({ command: "coordinator.renew", workspace: workspacePath, data });
}

export interface CoordinatorRelaySessionsData { project: string; allowed: string[]; sessions: RelaySessionVerdict[] }

/**
 * `arcadia coordinator relay-sessions --project <slug>`: read-only. Names the
 * exact tmux sessions of registered, relay-launched, current custodians that
 * START's no-competing-Session check tolerates (see relayCoordinatorSessions).
 * It starts, stops and records nothing.
 */
export function runCoordinatorRelaySessionsCommand(options: { workspace: string; project: string }): CommandSuccess<CoordinatorRelaySessionsData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const sessions = withDatabase(workspacePath, (db) => relayCoordinatorSessions(db, options.project));
  return createSuccess({
    command: "coordinator.relay-sessions", workspace: workspacePath,
    data: { project: options.project, allowed: sessions.filter((session) => session.allowed).map((session) => session.tmuxName), sessions }
  });
}

export function renderCoordinatorRelaySessionsSuccess(response: CommandSuccess<CoordinatorRelaySessionsData>): string[] {
  const { data } = response;
  if (data.sessions.length === 0) return [`No relay-registered tmux session for ${data.project}.`];
  return data.sessions.map((session) => `${session.allowed ? "allowed" : "held   "} ${session.tmuxName}: ${session.reason}`);
}

export function renderCoordinatorRenewSuccess(response: CommandSuccess<RenewResult>): string[] {
  const { data } = response;
  if (data.outcome === "launched") {
    return [
      `Launched ${data.tmuxName} as generation ${data.generation} (session ${data.sessionId}, attempt ${data.attempts}); prompt delivered. Custody moves when it runs accept.`,
      ...(data.warnings ?? []).map((warning) => `warning: ${warning}`)
    ];
  }
  if (data.outcome === "refused") return [`Not launched (${data.reason}): ${data.detail}`];
  return [`Not launched after ${data.attempts} attempts; operator pinged.`, ...data.failures.map((failure) => `- ${failure}`)];
}

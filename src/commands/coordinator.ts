import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
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
  correctCustodianGeneration,
  currentCustodian,
  custodianOf,
  listGenerations,
  newestLaunching,
  recordStandDown,
  relayCoordinatorSessions,
  seedCustodianGeneration,
  type CustodyAdmission,
  type RelaySessionVerdict
} from "../coordinator/generations.js";
import { withRelayLock } from "../coordinator/lock.js";
import { confirmSessionChallenge, findSessionTranscript, issueSessionChallenge, TRANSCRIPT_FRESH_MS, type ChallengePurpose, type VerifiedSession } from "../coordinator/sessionIdentity.js";
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
import { stopPredecessorAfterAccept, systemClaudeStop, type PredecessorStopDeps, type PredecessorStopResult } from "../coordinator/predecessorStop.js";
import { systemTmux } from "../sessions/index.js";
import { RELAY_ROLES, renewCoordinator, startPressInProgressIn, systemRelayDeps, type RelayDeps, type RenewResult, type StartPressStatus } from "../coordinator/relay.js";
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
 * subscribe only for a watcher the state already holds (inherited from its
 * snapshot, or registered by the predecessor after it), which records it.
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
      const previous = state.subscriptions.find((have) => have.command === command);
      const generation = generationOf(admission);
      const handedOverCursor = previous ? (previous.armedByGeneration === generation ? previous.handedOverCursor : previous.cursor) : undefined;
      const next = { command, cursor: options.cursor, armedAt: at, armedByGeneration: generation, ...(handedOverCursor !== undefined ? { handedOverCursor } : {}) };
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

export interface CoordinatorAcceptData { custodian: number; handedOff: number | null; snapshotSha: string; warnings?: string[]; predecessorStop: PredecessorStopResult | null }

/**
 * `arcadia coordinator accept --generation N --snapshot-sha <sha>`: the custody transfer (design step 5). After the
 * transfer it stops the handed-off predecessor by its exact recorded identity (gate 10, the stop half), still under the
 * relay lock so a renew cannot launch between the check and the stop.
 */
export function runCoordinatorAcceptCommand(options: Scope & { generation: number; snapshotSha: string; now?: Date; env?: NodeJS.ProcessEnv; repo?: string; stopDeps?: PredecessorStopDeps }): CommandSuccess<CoordinatorAcceptData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const paths = coordinatorPaths(workspacePath, options.project, options.role);
  const data = withDatabase(workspacePath, (db) => withRelayLock(paths.root, () => {
    const admission = assertCoordinatorCustody(db, { command: "accept", env: options.env, project: options.project, role: options.role, snapshotSha: options.snapshotSha, now });
    if (admission.kind !== "incoming" || admission.generation.generation !== options.generation) {
      throw validationError(`accept is run by the incoming generation ${options.generation} itself, with its own coordinator identity.`, { reason: "accept_identity" });
    }
    const result = acceptGeneration(db, paths, admission.generation, now);
    const predecessorStop = result.handedOff === null ? null : stopPredecessorAfterAccept(db, {
      workspace: workspacePath, project: options.project, role: options.role,
      successor: options.generation, predecessor: result.handedOff, repoRoot: mainWorktreeRoot(options.repo)
    }, options.stopDeps ?? systemPredecessorStopDeps(db));
    return { ...result, snapshotSha: options.snapshotSha, predecessorStop };
  }));
  return createSuccess({ command: "coordinator.accept", workspace: workspacePath, data });
}

/** The real host dependencies of the predecessor stop: exact tmux and `claude stop`, the START interlock, and the operator ping. */
function systemPredecessorStopDeps(db: Database.Database): PredecessorStopDeps {
  return {
    tmux: systemTmux,
    claudeStop: systemClaudeStop,
    startPressInProgress: relayStartPressInterlock,
    ping: (message) => { queueOperatorPing(db, { message, kind: "attention", agent: "coordinator-relay" }); },
    now: () => new Date()
  };
}

export function renderCoordinatorAcceptSuccess(response: CommandSuccess<CoordinatorAcceptData>): string[] {
  const { data } = response;
  const stop = data.predecessorStop;
  const stopLine = stop === null
    ? []
    : [`Predecessor generation ${stop.predecessor}: ${stop.outcome}${stop.reused ? " (earlier receipt)" : ""}. ${stop.detail}${stop.receipt ? ` Receipt: ${stop.receipt}` : ""}`];
  return [
    `Generation ${data.custodian} is now custodian${data.handedOff ? `; generation ${data.handedOff} is handed_off and fenced from the guarded coordinator and ping commands` : ""}.`,
    ...stopLine,
    ...(data.warnings ?? []).map((warning) => `warning: ${warning}`)
  ];
}

/**
 * `arcadia coordinator renew`: the relay launch (change 3). Inert until the
 * standing Decision recording answer A is on main (RELAY_LAUNCH_DECISION_ID).
 * Custody-guarded: a caller with a coordinator identity must be the custodian.
 */
/** The START-press interlock `renew` passes to the relay: the primary checkout's operator-scripts library. */
export const relayStartPressInterlock = (repo: string): StartPressStatus => startPressInProgressIn(path.join(repo, "artifacts", "generated", "operator-scripts"));

export function runCoordinatorRenewCommand(options: Scope & { repo?: string; effort?: string; env?: NodeJS.ProcessEnv; deps?: RelayDeps }): CommandSuccess<RenewResult> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = mainWorktreeRoot(options.repo);
  const data = withDatabase(workspacePath, (db): RenewResult => {
    assertCoordinatorCustody(db, { command: "renew", env: options.env, project: options.project, role: options.role });
    const deps = options.deps ?? systemRelayDeps({
      sources: () => defaultCapsuleSources({ db, repoRoot: repoRoot ?? repositoryRoot(), project: options.project, paths: coordinatorPaths(workspacePath, options.project, options.role), now: new Date() }),
      ping: (message) => { queueOperatorPing(db, { message, kind: "attention", agent: "coordinator-relay" }); },
      signIn: (provider) => checkProviderSignIn(provider, workspacePath),
      startPressInProgress: relayStartPressInterlock,
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

const TIERS = new Set(["light", "standard", "heavy"]);

export type CoordinatorSessionBindData =
  | { step: "challenge"; purpose: ChallengePurpose; nonce: string; expiresAt: string; next: string }
  | { step: "confirmed"; purpose: ChallengePurpose; generation: number; verified: VerifiedSession; tier: string; identity: string };

export type CoordinatorStandDownData = CoordinatorSessionBindData | { step: "recorded"; generation: number; successor: number; method: string };

export interface SessionBindOptions {
  challenge?: boolean; confirm?: string; sessionId?: string;
  /** Test seam: Claude Code's projects directory (default ~/.claude/projects). */
  claudeProjectsDirectory?: string; now?: Date;
}

function challengeStep(paths: ReturnType<typeof coordinatorPaths>, purpose: ChallengePurpose, command: string, now: Date): CoordinatorSessionBindData {
  const issued = issueSessionChallenge(paths, { purpose, now });
  return {
    step: "challenge", purpose, nonce: issued.nonce, expiresAt: issued.expiresAt,
    next: `${command} --confirm ${issued.nonce} --session-id <this Session's id>. Run it from the same Session that printed this nonce, before ${issued.expiresAt}.`
  };
}

/**
 * `arcadia coordinator register`: first registration (or, with `--correct`, correction) of a coordinator as the
 * generation-1 custodian, bound to a VERIFIED Session identity (Decision 0227 A; design gate 9). Two steps:
 * `--challenge` prints a nonce, `--confirm <nonce> --session-id <id>` proves that Session's transcript carries it and
 * records the provider and model the transcript names. Only the coordinator roles; claude only. A correction needs the
 * same proof for the replacing Session and is refused while the recorded Session is still live (unless it is the same
 * Session correcting its own label), while a successor is launching, or for a relay-launched custodian.
 */
export function runCoordinatorRegisterCommand(options: Scope & SessionBindOptions & { correct?: boolean; tier?: string; identity?: string }): CommandSuccess<CoordinatorSessionBindData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const purpose: ChallengePurpose = options.correct ? "correct" : "register";
  if (!RELAY_ROLES.has(options.role)) throw validationError(`Only the coordinator roles ${[...RELAY_ROLES].join(" and ")} register, not ${options.role}.`, { reason: "role_not_allowed" });
  if (Boolean(options.challenge) === (options.confirm !== undefined)) throw validationError("Give exactly one of --challenge or --confirm <nonce> (with --session-id, --tier and --identity).", { reason: "register_form" });
  const projectsDirectory = options.claudeProjectsDirectory ?? path.join(homedir(), ".claude", "projects");
  const paths = coordinatorPaths(workspacePath, options.project, options.role);
  const command = `arcadia coordinator register --project ${options.project} --role ${options.role}${options.correct ? " --correct" : ""}`;
  const data = withDatabase(workspacePath, (db) => withRelayLock(paths.root, (): CoordinatorSessionBindData => {
    const custodian = currentCustodian(db, options.project, options.role);
    if (options.correct) {
      if (!custodian) throw validationError(`${options.role} for ${options.project} has no custodian to correct; register it first.`, { reason: "no_custodian" });
      if (custodian.relayLaunched) throw validationError(`Generation ${custodian.generation} was launched by the relay; its custody moves only through accept, never a correction.`, { reason: "correction_relay_custodian" });
      if (newestLaunching(db, options.project, options.role)) throw validationError(`A successor of ${options.role} is launching; no correction until it is accepted or fails.`, { reason: "launch_in_progress" });
    } else if (listGenerations(db, options.project, options.role).length > 0) {
      throw validationError(`${options.role} for ${options.project} is already registered; use --correct to fix it.`, { reason: "generation_exists" });
    }
    if (options.challenge) return challengeStep(paths, purpose, command, now);
    const tier = options.tier ?? "";
    const identity = (options.identity ?? "").trim();
    if (!TIERS.has(tier)) throw validationError("--tier must be light, standard or heavy.", { reason: "invalid_tier" });
    if (identity === "" || identity.length > 120) throw validationError("--identity must be 1 to 120 characters (the Session's resolved identity label).", { reason: "invalid_identity" });
    // A live Session keeps its custody record: only itself may relabel it, or the recorded Session must be gone.
    // Checked before the challenge is consumed, so a refusal costs the caller no new nonce.
    if (options.correct && custodian && custodian.nativeSessionId !== options.sessionId) {
      const recorded = custodian.nativeSessionId ? findSessionTranscript(projectsDirectory, custodian.nativeSessionId) : null;
      if (recorded !== null && now.getTime() - statSync(recorded).mtimeMs <= TRANSCRIPT_FRESH_MS) {
        throw validationError(`The recorded custodian Session ${custodian.nativeSessionId} is still live (its transcript was written within ${TRANSCRIPT_FRESH_MS / 60_000} minutes); it must correct itself, or end first.`, { reason: "custodian_session_live" });
      }
    }
    const verified = confirmSessionChallenge(paths, { purpose, nonce: options.confirm ?? "", sessionId: options.sessionId ?? "", projectsDirectory, now });
    const generation = {
      provider: verified.provider, model: verified.model, tier, identity, nativeSessionId: verified.sessionId, transcriptPath: verified.transcriptPath,
      project: options.project, role: options.role, now, lockHeld: true,
      verification: { method: "transcript_challenge", sessionId: verified.sessionId, transcriptPath: verified.transcriptPath, model: verified.model }
    };
    if (options.correct && custodian) {
      const corrected = correctCustodianGeneration(db, workspacePath, generation);
      return { step: "confirmed", purpose, generation: corrected.generation, verified, tier, identity };
    }
    const seeded = seedCustodianGeneration(db, workspacePath, generation);
    return { step: "confirmed", purpose, generation: seeded.generation, verified, tier, identity };
  }));
  return createSuccess({ command: "coordinator.register", workspace: workspacePath, data });
}

export function renderCoordinatorSessionBindSuccess(response: CommandSuccess<CoordinatorSessionBindData>): string[] {
  const { data } = response;
  if (data.step === "challenge") return [`Session challenge (${data.purpose}): ${data.nonce}`, `Expires ${data.expiresAt}.`, `Next: ${data.next}`];
  return [`Verified session ${data.verified.sessionId} (${data.verified.provider} ${data.verified.model}); ${data.purpose === "register" ? "registered" : "corrected"} as generation ${data.generation} custodian (tier ${data.tier}, identity ${data.identity}).`];
}

/**
 * `arcadia coordinator stand-down --successor N`: the current custodian records that it stands down for the launching
 * successor, which `accept` requires first. A relay-launched custodian proves itself with its custody token; a seeded
 * one (no token) with the transcript challenge, which must verify the Session recorded in its row. Records only: the
 * predecessor stops itself afterwards.
 */
export function runCoordinatorStandDownCommand(options: Scope & SessionBindOptions & { successor: number; env?: NodeJS.ProcessEnv }): CommandSuccess<CoordinatorStandDownData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  if (!Number.isInteger(options.successor) || options.successor < 1) throw validationError("--successor must be a positive integer.", { reason: "invalid_generation" });
  const projectsDirectory = options.claudeProjectsDirectory ?? path.join(homedir(), ".claude", "projects");
  const paths = coordinatorPaths(workspacePath, options.project, options.role);
  const command = `arcadia coordinator stand-down --project ${options.project} --role ${options.role} --successor ${options.successor}`;
  const data = withDatabase(workspacePath, (db) => withRelayLock(paths.root, (): CoordinatorStandDownData => {
    const custodian = currentCustodian(db, options.project, options.role);
    if (!custodian) throw validationError(`No custodian of ${options.role} is recorded for ${options.project}; there is nothing to stand down.`, { reason: "no_custodian" });
    if (custodian.relayLaunched) {
      const admission = assertCoordinatorCustody(db, { command: "stand-down", env: options.env, project: options.project, role: options.role, now });
      if (admission.kind !== "custodian") throw validationError("stand-down is run by the current custodian itself, with its own coordinator identity (a relay-launched custodian has a custody token).", { reason: "stand_down_identity" });
      recordStandDown(db, workspacePath, { project: options.project, role: options.role, successor: options.successor, now, lockHeld: true });
      return { step: "recorded", generation: custodian.generation, successor: options.successor, method: "custody_token" };
    }
    // A seeded custodian has no token: bind to its recorded Session by the transcript challenge.
    if (Boolean(options.challenge) === (options.confirm !== undefined)) throw validationError("Give exactly one of --challenge or --confirm <nonce> with --session-id.", { reason: "stand_down_form" });
    if (options.challenge) return challengeStep(paths, "stand-down", command, now);
    if (!custodian.nativeSessionId) throw validationError(`Generation ${custodian.generation} has no recorded Session id, so its stand-down cannot be verified; correct the registration first.`, { reason: "custodian_session_unrecorded" });
    if (options.sessionId !== custodian.nativeSessionId) throw validationError(`stand-down must come from the recorded custodian Session ${custodian.nativeSessionId}, not ${options.sessionId ?? "none"}.`, { reason: "stand_down_identity" });
    const verified = confirmSessionChallenge(paths, { purpose: "stand-down", nonce: options.confirm ?? "", sessionId: options.sessionId, projectsDirectory, now });
    recordStandDown(db, workspacePath, { project: options.project, role: options.role, successor: options.successor, now, lockHeld: true });
    return { step: "recorded", generation: custodian.generation, successor: options.successor, method: `transcript_challenge:${verified.sessionId}` };
  }));
  return createSuccess({ command: "coordinator.stand-down", workspace: workspacePath, data });
}

export function renderCoordinatorStandDownSuccess(response: CommandSuccess<CoordinatorStandDownData>): string[] {
  const { data } = response;
  if (data.step === "recorded") return [`Generation ${data.generation} recorded its stand-down for generation ${data.successor} (${data.method}). The successor may now accept; stop this Session afterwards.`];
  return renderCoordinatorSessionBindSuccess({ ...response, data });
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
  // Read-only open: START's P2 is documented as making no mutation. A workspace that predates the table has no relay session.
  const sessions = withReadOnlyDatabase(workspacePath, (db) => {
    try { return relayCoordinatorSessions(db, options.project); } catch (error) {
      if (error instanceof Error && /no such table/i.test(error.message)) return [];
      throw error;
    }
  });
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
      `Launched ${data.tmuxName} as generation ${data.generation} (session ${data.sessionId}, attempt ${data.attempts}); prompt delivered. Next: record your stand-down with "arcadia coordinator stand-down --project <project> --role <role> --successor ${data.generation}"; custody moves when it then runs accept.`,
      ...(data.warnings ?? []).map((warning) => `warning: ${warning}`)
    ];
  }
  if (data.outcome === "refused") return [`Not launched (${data.reason}): ${data.detail}`];
  return [`Not launched after ${data.attempts} attempts; operator pinged.`, ...data.failures.map((failure) => `- ${failure}`)];
}

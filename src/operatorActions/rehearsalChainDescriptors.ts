import type { OperatorScriptDescriptor } from "./libraryContract.js";
import { chainActionIds, chainLibraryIds, completionRequestId, isUnfilled, type ChainKind, type ChainRunParams } from "./rehearsalChain.js";

/**
 * The per-run /runs descriptors of the rehearsal-chain operator script set,
 * rendered from one reviewed parameter file. A new run is a new parameter file
 * plus `scripts/render-rehearsal-chain-operator-scripts.ts`; the descriptors
 * and launchers it writes are checked byte for byte against this renderer.
 */
/** A library descriptor plus the operator command (and, for the reset, its parameters) the run-5 descriptors also carried. */
export type ChainDescriptor = OperatorScriptDescriptor & { operator_command: string; parameters?: Record<string, string> };

const LIBRARY = "/Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts";
const FIXTURE_REPO = "pmark/arcadia-three-action-rehearsal-20261004";
const DECISION_0058 = "Decision 0058 delegates bounded candidate integration for the Actions a grant names, under an explicit expiry; the operator's answer to #925 (recorded in Log operator-answers-rehearsal-run2-2026-10-05, commit 133e503dc, clarified by 49b1342a8) is that Decision 0058 covers gh pr ready, the settled-head push and the reviewer model's spend during a managed rehearsal. Neither limits the number of Actions: the 'three fixture Actions only' wording of the run-1 to run-5 Grants was those Grants' own scope, not a limit in the Decision or the answer, and that answer created no Decision and grants nothing by itself";

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (ids: string[]) => ids.length <= 2 ? ids.join(" and ") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;

function context(params: ChainRunParams) {
  const ids = chainLibraryIds(params.runId);
  const actions = chainActionIds(params.actionCount);
  const previous = params.previousRun;
  const head = previous.bindings.resetHead;
  const localMain = previous.bindings.localMain;
  const startsFrom = isUnfilled(head)
    ? `${previous.label}'s reset head on GitHub main (the newHead of ${previous.label}'s succeeded ${previous.resetId} receipt, still to be filled in the parameter file; until then every script refuses)`
    : `${previous.label}'s reset head ${head} on GitHub main`;
  const localNote = isUnfilled(localMain) || isUnfilled(head)
    ? `If ${previous.label} integrated work by local fast-forward, the fixture clone's local main is ahead of that head; the parameter file must then pin it (from ${previous.label}'s G8 receipt, fixtureMain) and the reset moves only the clone's local main back after proving it is preserved remotely.`
    : localMain === head
      ? `${capital(previous.label)}'s terminal Off recorded the clone's local main at that same head, so no local-main move is needed.`
      : `${capital(previous.label)} integrated work by local fast-forward: its terminal Off recorded the clone's local main at ${localMain}, ahead of GitHub main. The reset moves ONLY the clone's local main back to ${head}, after proving ${localMain} is contained in an earlier candidate's remote branch and pull request (every pinned candidate untouched), and pushes no base other than its single validated reset commit.`;
  return {
    ids, actions, previous, startsFrom, localNote,
    actionList: list(actions),
    scoped: actions.map((id) => `three-action-rehearsal/${id}`),
    completions: actions.map((id) => completionRequestId(id, params.runId)),
    command: (id: string, mode = "run") => `${LIBRARY}/${id}.sh ${mode}`,
    whys: params.requiredCommits.map((entry) => entry.why).join("; "),
    runParamsFile: `rehearsal-chain/params/${params.runId}.json`
  };
}

function resetDescriptor(params: ChainRunParams): ChainDescriptor {
  const c = context(params);
  const env = `ARCADIA_REHEARSAL_GITHUB_REPO=${FIXTURE_REPO}`;
  return {
    schema: "arcadia-operator-script-v1",
    id: c.ids.reset,
    title: `Rehearsal chain ${params.runLabel}: reset the fixture as a ${params.actionCount}-Action serial chain from ${c.previous.label}'s reset head (moves only the clone's local main back when ${c.previous.label} integrated locally; settles nothing; no production change)`,
    script: `${c.ids.reset}.sh`,
    repeatable: false,
    problem: `Each rehearsal run used to clone a four-script set by hand (about an hour each). This set is one shared implementation (rehearsal-chain/reset.sh) driven by one reviewed parameter file (${c.runParamsFile}). ${capital(c.previous.label)} left the fixture with passed development attempts for its Actions' inputs (never relaunched for an unchanged input), settled completion ids, and possibly work integrated by local fast-forward only (the clone's local main ahead of GitHub main). A pending proposal or open Decision naming an in-scope Action makes the dispatch gate answer 'decision' and the tick launch nothing (Issue #968). ${c.localNote}`,
    desired_effect: `The new line starts from ${c.startsFrom}. Render the fixture Plan as a serial chain of ${params.actionCount} tiny dependent Actions (${c.actionList}), each with a fresh requirement input revision, the fresh unused completion id complete-<action>-${params.runId} and the leave-git-status-clean rule; validate it with Arcadia's own discovery, docs sync, ready set and requirementIdentity and a read-only live dry-run docs sync (every Action an update or create, no error, only write-start-marker ready); refuse any pending fixture proposal or open Decision gating a chain Action (it settles none); then commit once, push without force, run docs sync and write a receipt naming the new head, the starting head, every earlier candidate's tip and the ${params.actionCount} Action ids and completion ids, which this run's G6 and G7 bind. Preview it read-only first: ${env} ${c.command(c.ids.reset, "--dry-run")}. Run it from a terminal: ${env} ${c.command(c.ids.reset)}`,
    operator_command: `${env} ${c.command(c.ids.reset)}`,
    parameters: {
      ARCADIA_REHEARSAL_GITHUB_REPO: "Required environment variable: the exact owner/name of the fixture repository G1 prepared. The owner must be the authenticated gh user and the name must match ^arcadia-three-action-rehearsal(-[a-z0-9]{1,24})?$. Launched from /runs without it, the script refuses with a receipt and changes nothing.",
      parameterFile: `${c.runParamsFile}: the run id, the Action count N (3 to 12), the previous run's receipt ids and bindings (its reset receipt and reset head, its terminal-Off receipt and the local main it recorded, every earlier candidate) and the required Arcadia commits. Any binding still starting with UNFILLED refuses.`,
      "--dry-run": "Read-only: every read and validation, then the exact planned change and every refusal; writes only into a fresh temporary directory. Only a dry run honours ARCADIA_REHEARSAL_RECEIPTS_DIR, so it can be run from a candidate checkout against the main checkout's receipts."
    },
    authority: {
      does: [
        `Refuses before any other step unless started through this run's published launcher with its own parameter file (${c.runParamsFile}), the launcher, descriptor, parameter file and shared implementation are tracked and unmodified at the checkout's HEAD (reviewed and committed, not merely rendered), the parameter file is valid (including the fixed required-commit floor) with every previous-run binding filled, and ARCADIA_REHEARSAL_GITHUB_REPO is exactly owner/name with a safe disposable-fixture name; requires the Arcadia checkout clean on main, ARCADIA_WORKSPACE not exported, the CLI default workspace martianrover from user config, and production readable, Inactive and with zero live admissions (rechecked before the local-main move, the commit and the push)`,
        `Requires ${c.previous.label}'s records exactly as the parameter file binds them: a succeeded G1 receipt for this repository (its genesis); the succeeded ${c.previous.resetId} receipt in runs/<resetRunId> with newHead and remoteMainAfter equal to the bound reset head; the succeeded, Off-confirmed ${c.previous.terminalOffId} receipt in runs/<terminalOffRunId> whose fixtureMain is the bound local main, with no later refused run of it; and the parameter file's candidates covering that G8's work reconciliation (every integrated or preserved Session's branch, tip and pull request pinned, and nothing it reconciled left live, dirty or unreconciled)`,
        "Requires the local fixture clean on main with G1's manifest, origin and single genesis root, holding the bound reset head; the Project three-action-rehearsal registered from this fixture under G1's registration marker with no prepared or running fixture Session (read-only probe); the GitHub repository owned by the gh user, private, not archived, not a fork and carrying G1's disposable-fixture description",
        "Requires every earlier candidate the parameter file pins (branch, tip, pull request) to be identical locally, on GitHub and as its pull request head, checked before any change and again after the push; records every tip and pull request state in candidatesBefore and candidatesAfter",
        "Starts the new line from the previous run's reset head on GitHub main, never from local main. When the clone's local main is ahead of it (work the previous run integrated by local fast-forward), it requires that local main to be exactly the bound commit, to descend from the reset head and to be contained in at least one pinned candidate's remote branch and pull request (the tested pure rule decideFixtureStart), and only then moves ONLY the clone's local main back to GitHub main: a compare-and-swap ref update from the bound commit (recorded in the clone's reflog) and a two-tree switch of the clean working tree that refuses on any local change. GitHub main and every other ref are untouched by that step",
        "Renders the fixture Plan from the reset head's Plan with the tested pure renderer (renderChainPlan): G1's three Actions keep every line except next_action, chain-step-04 onward are appended in order, each reading its predecessor's output (chain-step-04 reads MARKER.md's last line, each later step CHAIN.md's last line, so the chain is genuinely ordered); every next_action carries a run note naming this run's fresh completion id and the leave-git-status-clean rule; the Plan's updated: date becomes the reset's UTC date (an earlier host date refuses) and its token budget names N; a base Plan that is not a canonical prefix of the chain refuses",
        "Validates the amendment in dot-directories Arcadia's discovery skips, before any change: only the Plan file changed; Arcadia's discovery, a throwaway dry-run docs sync, resolveReadySet and requirementIdentity show zero errors, the pointer at write-start-marker, the serial depends_on chain, every Action open and agent-owned, only write-start-marker ready and every base Action changed only in next_action with a fresh requirement input revision and an unchanged criteria fingerprint; reads the live attempt lineage read-only and refuses if any amended input already has an attempt or an earlier Session that passed a chain Action is live, unpreserved or dirty; a read-only live dry-run docs sync must report every chain Action as exactly one update or create (unchanged only when resuming a reset already pushed), with no error and nothing skipped",
        "Reads, read-only through Arcadia's resolveOperatorGate and the proposal store, every pending proposal or open Decision that would gate a chain Action and every pending fixture proposal, and refuses untouched on any of them, naming each with its own governed settle path; records every fixture proposal's disposition (settled ones are left exactly as they are); refuses unless every completion id is unused in the workspace and in the fixture tree",
        "Only after all of that: moves the clone's local main back if needed, commits exactly the validated Plan file once on the reset head and pushes refs/heads/main without force; then confirms GitHub main is the new head, rechecks every earlier candidate, runs arcadia docs sync --project three-action-rehearsal --apply and confirms every chain Action synced exactly once",
        "Resumes safely: a local main already moved back starts from GitHub main; a reset commit already made but not pushed is re-validated byte for byte and pushed; one already pushed proceeds to docs sync; after a succeeded run a rerun refuses as already reset",
        "--dry-run performs every read and validation above read-only (production status through the same command function, so no CLI activity row is written) and prints the exact planned change (the local-main move, the reset commit's Plan diff, every Action's completion id and input revision, the live dry-run sync) and every refusal, writing only into a fresh temporary directory; only a dry run honours ARCADIA_REHEARSAL_RECEIPTS_DIR",
        "Writes a timestamped receipt under runs/<timestamp-pid>/ (chainRunId, githubRepository, genesis, previousMain, startingHead, localMainMove, localMainPreservedOn, newHead, remoteMainAfter, candidatesBefore, candidatesAfter, actionIds, completionIds, actions with their input revisions, fixtureProposalsBefore) on success and refusal, plus a failure handoff on refusal"
      ],
      never_does: [
        "Never previews, activates or deactivates production, and never creates, presses or changes a Grant or a Decision",
        "Never settles, accepts, rejects, previews or edits any Agent Ask proposal",
        "Never changes an existing Action's acceptance criteria, status, responsibility or title, PROJECT.md, the genesis check, the CI workflow or the fixture manifest",
        "Never touches an earlier candidate's branch, worktree or pull request, and never comments on, merges, closes or edits a pull request",
        "Never force-pushes, rewrites, rebases or resets fixture history; never pushes anything but one fast-forward of fixture main to its single validated reset commit; never moves any ref other than the clone's local main (back to GitHub main, only from the bound commit, only after proving it is preserved remotely) and that commit's own fast-forward",
        "Never deletes, renames, archives or changes the visibility of a repository",
        "Never changes anything before the amended fixture validates, and never edits the workspace database directly",
        "Never restarts a service or worker, reinstalls the broker, or launches a Session",
        "Never guesses or defaults the repository identifier or a parameter, and never exports ARCADIA_WORKSPACE"
      ]
    },
    success: {
      effect: `Fixture main on GitHub and locally is one reset commit on ${c.previous.label}'s reset head that renders the ${params.actionCount}-Action chain and changes only the fixture Plan; the clone's local main was moved back first when ${c.previous.label} had integrated locally (that work stays on its candidate branch and pull request); nothing gates the fixture; docs sync applied every chain Action with zero errors; the receipt carries the new head, the starting head, every earlier candidate's untouched tip and the Action and completion ids. Production is unchanged.`,
      next: `If Arcadia main moved on a runtime path since the last install, run recover-arcadia-host-services from a terminal with ARCADIA_WORKSPACE set inline on that one command (never exported). Then run this run's G6 preflight ${c.ids.preflight}, which binds this receipt, and have the operator press this run's G7 ${c.ids.grant} within 30 minutes of its passing receipt without pushing to Arcadia main, reinstalling, restarting services or running any G8 in between.`
    },
    failure: {
      effect: "The receipt and failure handoff name the failed precondition, the fixture state found, and whether this run moved the clone's local main, committed or pushed. Nothing was forced, rewritten or deleted, no proposal was settled, and production, Grants and every earlier candidate were not touched.",
      next: "Correct the named precondition and rerun; a local-main move, commit or push this script already made is recognized and resumed, not repeated. If the handoff names pending proposals or Decisions, give each its own governed disposition first. If it says the fixture moved by another path, do not edit it by hand: correct the parameter file through a reviewed change, or ask for a new reviewed reset."
    }
  };
}

function preflightDescriptor(params: ChainRunParams): ChainDescriptor {
  const c = context(params);
  return {
    schema: "arcadia-operator-script-v1",
    id: c.ids.preflight,
    title: `G6 (rehearsal chain ${params.runLabel}): preflight the ${params.actionCount}-Action chain at its reset fixture head (observation only; refuses on unknown, stale, paid, unfilled or unavailable evidence, or a pending item gating dispatch)`,
    script: `${c.ids.preflight}.sh`,
    repeatable: true,
    problem: `This run's G7 Grant must not activate production unless the host can actually run the ${params.actionCount}-Action chain: current production state and installed release, the required Arcadia commits of the parameter file (${c.whys}), a worker-context Claude Code sign-in, a read-only Codex reviewer with real included capacity, a GitHub fixture repository whose checks report, and nothing pending that silently gates dispatch (Issue #968). Guessing any of these spends tokens or stalls unattended work.`,
    desired_effect: `Make only bounded observations and write one timestamped receipt listing every check and its verdict, bound to the main revision, installed release, workspace, policy revision, fixture and the fixture head recorded by this run's latest succeeded chain reset receipt (${c.ids.reset}) for the manifest's repository: one reset commit on the parameter file's bound reset head, carrying exactly the Actions ${c.actionList} and their completion ids. The receipt succeeds only when every check passes; this run's G7 (${c.ids.grant}) accepts it for 30 minutes, and only while Arcadia main and the installed release stay exactly where this preflight observed them: do not push to main, reinstall, restart services or press any G8 between this run and the G7 press.`,
    operator_command: c.command(c.ids.preflight),
    authority: {
      does: [
        `Refuses unless started through this run's published launcher with its own parameter file, the launcher, descriptor, parameter file and shared implementation tracked and unmodified at HEAD, the file valid (including the fixed floor #922, #924, #983, #987) and with every value filled (an UNFILLED required commit or binding refuses before any observation)`,
        "Reads Git state of the Arcadia checkout and the fixture, observes origin main afresh with a 30-second git ls-remote that must equal local main (unknown or ahead refuses), every required commit of the parameter file on main, the configured workspace, production status, go-broker status (the installed release must be ready and runtime-identical to main), worker status and active Session leases (read-only database probe)",
        `Finds this run's latest succeeded ${c.ids.reset} receipt for the manifest's exact repository and refuses unless its newHead is local fixture main, its previousMain is the bound reset head (the only parent of local main), its genesis is the fixture's single root, GitHub main was recorded at the same head and its chainRunId, actionIds and completionIds are exactly this run's`,
        `Observes read-only, through Arcadia's own resolveOperatorGate, that no pending proposal or open Decision would gate any of the ${params.actionCount} chain Actions, and refuses naming each one that would`,
        "Runs the worker-context claude-code-cli sign-in check and records only its verdict (signed_in, signed_out, unknown or unavailable); refuses when ANTHROPIC_API_KEY is set, without reading its value",
        "Runs codex --version and codex login status with 20-second bounds and records only whether sign-in is a ChatGPT subscription, an API key (paid, refused) or unknown (refused)",
        "Observes Codex capacity directly, ignoring the workspace's unmetered standing choice, and refuses unless it is admitted, fresh, observed or attested, included, not simulated and not unavailable; checks a read-only codex reviewer profile exists",
        "With this explicit operator press as authorization, reads GitHub only through gh auth status, the exact fixture repository, its main branch (which must be the chain reset head) and the check runs of that head, waiting at most five minutes for those checks",
        "Writes the receipt and, on any refusal, a failure handoff under runs/<timestamp-pid>/"
      ],
      never_does: [
        "Never prints, copies or logs a token value or the raw codex or gh sign-in output",
        "Never previews or activates production, presses G7, or changes any policy, packet, proposal, Decision or capacity receipt",
        "Never writes to GitHub, the fixture or the parameter file, starts or restarts a service, installs anything, or invokes a model",
        "Never treats unknown, stale, paid, simulated, unfilled or unavailable evidence as passing"
      ]
    },
    success: {
      effect: "Every check passed; the receipt binds the observed main, installed release, workspace, policy revision, fixture, chain reset head, reset receipt and Action set, and nothing pending gates a chain Action.",
      next: `Within 30 minutes, press this run's one-shot G7 Grant (${c.ids.grant}) after reading its operator acknowledgement. Until then nothing may push to Arcadia main, reinstall the broker, restart services or run any G8: each moves what this receipt bound and G7 then refuses, so this preflight must be rerun.`
    },
    failure: {
      effect: "Nothing changed. The receipt lists each refused check and why; the failure handoff says not to press G7.",
      next: "Fix each refused check through its reviewed path (an UNFILLED parameter through a reviewed parameter change; reinstall-go-broker or recover-arcadia-host-services for a stale release; verify-claude-code-token for sign-in; the item's own governed settle for a pending proposal or Decision), then rerun this preflight."
    }
  };
}

function grantDescriptor(params: ChainRunParams): ChainDescriptor {
  const c = context(params);
  const n = params.actionCount;
  return {
    schema: "arcadia-operator-script-v1",
    id: c.ids.grant,
    kind: "grant",
    title: `G7 (rehearsal chain ${params.runLabel}): Grant the disposable ${n}-Action serial chain at its reset fixture head (one press, ${n} Actions, 12h; accepts Decision 0058 for PR readiness, settled-head pushes and reviews of all ${n}; never GitHub merge)`,
    script: `${c.ids.grant}.sh`,
    repeatable: false,
    next_after: {
      id: c.ids.preflight,
      within_minutes: 30,
      voided_by: [...new Set([c.ids.terminalOff, c.previous.terminalOffId, "recover-arcadia-host-services", "reinstall-go-broker", c.ids.reset, c.previous.resetId])],
      when_production: "inactive"
    },
    problem: `OPERATOR ACKNOWLEDGEMENT REQUIRED BEFORE PRESSING (https://github.com/pmark/arcadia/issues/925). ONE PRESS AUTHORISES ${n} ACTIONS: for each of the ${n} disposable fixture Actions ${c.actionList}, in that order and with no further operator step until G8, the production tick may admit it, launch one claude-code-cli Session, preserve its work to a draft PR, push the settled head, mark the PR ready, spend reviewer-model tokens on both independent reviews (code review and QA) of that exact head, integrate it by local fast-forward of the fixture clone's main, and admit the next; at most one Session at a time, all of it expiring 12 hours after the press. It never authorises a GitHub merge or a base-branch push. The tick does the readiness, push and review steps only when the policy carries BOTH --remote-preservation AND a current Decision 0058 integration grant naming the Action, which this Grant sets for exactly these ${n} Actions. ${DECISION_0058}. Pressing records that you accept Decision 0058 for that use for exactly these ${n} fixture Actions and until the 12-hour expiry; if you do not, do not press. Press it within 30 minutes of a passing G6 of this run (${c.ids.preflight}), with nothing pushed to Arcadia main, reinstalled or restarted and no G8 run in between.`,
    desired_effect: `Pressing accepts Decision 0058 for exactly the ${n} fixture Actions ${c.actionList}: readying each PR, pushing each settled head and reviewer-model spend for both reviews of each, until the 12-hour expiry. After fail-closed preconditions (the parameter file valid and filled, its required commits on main), the fixture exactly at the chain reset head recorded in this run's latest succeeded reset receipt, a passing G6 receipt of this run no older than 30 minutes bound to the same main, installed release, workspace, fixture, reset head, reset receipt, Action set and policy revision, and a passing host replay of tests/rehearsal-three-action.test.ts (all three variants including the tick-driven review variant, five-minute bound), recheck main, release, fixture head, leases and policy, preview at the current policy revision, preview again immediately before activation requiring the identical fingerprint and revision, activate once with that expected revision and request id ${c.ids.grant}, then verify the activated fingerprint equals the preview and turn this Grant Off on any mismatch: Project three-action-rehearsal, Plan autonomous-three-action-rehearsal, Actions ${c.scoped.join(", ")} in order, provider claude-code-cli, concurrency one, transitions validation, acceptance, pointer and packet_approval with a 12-hour packet-approval expiry, --remote-preservation, and a 12-hour Decision 0058 integration grant naming each of the ${n} Actions.`,
    operator_command: c.command(c.ids.grant),
    authority: {
      does: [
        `Requires the #925 acknowledgement at the start of the problem: one press accepts Decision 0058 for pushing each settled head, readying each PR and reviewer spend for exactly these ${n} fixture Actions, until expiry`,
        "Runs only when launched from /runs (exact id and descriptor) outside any agent sandbox, through this run's published launcher and its own parameter file, with the launcher, descriptor, parameter file and shared implementation tracked and unmodified at HEAD, the file valid (including the fixed required-commit floor #922, #924, #983, #987) and every value filled",
        "Requires main clean, level with last-fetched origin/main and with a fresh 30-second git ls-remote of origin main, containing every required commit of the parameter file, Decision 0058 approved, an installed broker release that is ready and runtime-identical to main, and fresh host transports",
        `Requires the fixture clean on main with G1's manifest and origin at exactly the chain reset head this run's latest succeeded ${c.ids.reset} receipt for its repository recorded (newHead, previousMain the bound reset head as its only parent, genesis the fixture's single root, GitHub main confirmed at that head, this run's Actions), production Inactive with zero live admissions, and this run's latest G6 receipt (${c.ids.preflight}) succeeded, at most 30 minutes old and bound to the same main, installed release, workspace, fixture, reset head, reset receipt, Action set and policy revision`,
        "Runs the hermetic three-Action rehearsal on the host before any preview; failure, timeout, a missing tick variant or an agent sandbox prevents activation; afterwards it rechecks main, the installed release, the fixture head, fixture leases and the policy revision before previewing",
        `Previews at the current policy revision, previews again immediately before activation and requires the identical fingerprint and revision, activates once with request id ${c.ids.grant} and --expected-revision, then verifies the activated fingerprint; the preview must name exactly the ${n} chain Actions in order for both the scope and the Decision 0058 integration grant`,
        "Permits only the reviewed scope and draft-PR remote preservation, and, under Decision 0058 for this use (#925, answered yes), pushing the settled head, readying the host-created PR and running arcadia qa code-review and arcadia qa pr before local fast-forward integration, for each named Action in turn",
        `After any activation attempt that does not verify (including a failed, timed-out or unparsable activate, or SIGTERM/SIGINT), reads production status back, returns only its own Grant to Off if it is Active, and records the observed state (or UNKNOWN, telling you to run G8 now) in a timestamped receipt and failure handoff. SIGKILL or a host crash cannot be handled by any trap; if the run vanishes after activation, run this run's G8 (${c.ids.terminalOff}) from the Terminal panel or /runs, which turns off exactly this Grant's policy`
      ],
      never_does: [
        "Never authorizes a GitHub merge or a push to any base branch; integration is the local fast-forward and origin main never moves",
        `Never grants another Project, Plan, Action (anything beyond the ${n} named), provider, transition or a concurrency above one, and never lifts the concurrency gate`,
        "Never launches, terminates or resumes a Session, restarts a service, or reactivates production after Off",
        "Never activates twice under its request id: it refuses when the current policy already carries this request id, and a later rerun with the same id cannot add an activation; the one-shot button stays disabled after success",
        "Never changes credentials, branch protection, repository settings, the parameter file or any Decision",
        `Never changes the fixture, its Plan or any earlier candidate or pull request, and never reuses an earlier run's Grant or request id (${c.previous.grantId} included)`
      ]
    },
    success: {
      effect: `One scoped, expiring policy is Active under request id ${c.ids.grant} whose recorded fingerprint equals both previews; the receipt names the ${n} admitted Actions, the expiry, the chain reset head, the installed release and the G6 and reset receipts it relied on.`,
      next: `Observe the tick admit write-start-marker, then each dependent Action in turn, through production status and the dashboard. When the chain ends or anything looks wrong, run this run's G8 (${c.ids.terminalOff}) from the Terminal panel or /runs, never from a non-interactive shell.`
    },
    failure: {
      effect: "If no activation was attempted, policy is unchanged. After an attempt, the script reads production status back, returns only its own Grant to Off when it is Active, and records the observed result (not_active, returned_off, other_grant_active, OFF_FAILED or UNKNOWN).",
      next: `Do not press again blindly. Read the handoff; if it says OFF_FAILED or UNKNOWN, run this run's G8 (${c.ids.terminalOff}) now from the Terminal panel or /runs. Otherwise resolve the named drift, rerun this run's G6 and request a fresh G7.`
    }
  };
}

function terminalOffDescriptor(params: ChainRunParams): ChainDescriptor {
  const c = context(params);
  return {
    schema: "arcadia-operator-script-v1",
    id: c.ids.terminalOff,
    title: `G8 (rehearsal chain ${params.runLabel}): restore and prove terminal Off after the ${params.actionCount}-Action chain (governed Off of this run's G7 policy only, worker logs copied, pinned reviewed restart; run from the Terminal panel or /runs, never a non-interactive shell)`,
    script: `${c.ids.terminalOff}.sh`,
    repeatable: true,
    problem: `When the chain ends, fails or looks wrong, production must reach a proven terminal Off: no new admission, no live Session or lease, a clean restart through the reviewed host-service path, every committed candidate accounted for, and the worker log preserved (the restart recreates it; run 5's log after its G8 held nothing from runs 1 to 5). Killing processes or discarding candidates would lose work and evidence. This run activates under its own request id (${c.ids.grant}); this G8 owns that policy and nothing else. It must be launched from /runs or an interactive host terminal such as the Terminal panel: from a non-interactive shell it refuses at its launch guard with 'launch this action through /runs or from an interactive host terminal' and does nothing.`,
    desired_effect: `When launched from /runs or the Terminal panel (never a non-interactive shell), turn production Off through arcadia production deactivate as the first Arcadia command only if the Active policy is this run's G7 Grant (request id ${c.ids.grant}, with exactly the fixture Project, Plan and the ${params.actionCount} Actions ${c.actionList}), or record that it is already Inactive; any other Active policy refuses without being touched. Prove Inactive with zero live admissions and zero prepared or running Sessions across three consecutive bounded observations, copy every worker log into this run's evidence folder, restart only through the hash-pinned recover-arcadia-host-services action and its hash-pinned restart implementation with override variables unset, prove the same after restart, classify every fixture Session's work (every run's, so all of this run's candidates) as integrated, preserved or empty, and write an inactive receipt, a restart receipt and an intervention ledger.`,
    operator_command: c.command(c.ids.terminalOff),
    authority: {
      does: [
        `Runs only from the main-library /runs launcher (exact id and descriptor) or an interactive host terminal such as the Terminal panel (stdin is a TTY), never inside an agent sandbox; a non-interactive shell refuses at the launch guard before any Arcadia command. Prefer the terminal whenever the restart is expected: the restart also restarts the dashboard that runs /runs actions. As its first Arcadia command it turns production Off through arcadia production deactivate with a per-run request id ONLY when the Active policy's request id is ${c.ids.grant} and its scope is exactly Project three-action-rehearsal, Plan autonomous-three-action-rehearsal and the ${params.actionCount} chain Actions in order (read from the parameter file's run id and Action count only, so unfilled previous-run bindings never block an Off); the ledger records the revoked request id and scope. An already-Inactive policy proceeds to the observations and restart`,
        "Refuses WITHOUT deactivating when any other policy is Active, and its handoff names the separate governed Off path that policy needs: the dashboard production Off switch or arcadia production deactivate run by the operator",
        "Observes production status and a read-only Session database probe every 15 seconds, requiring three consecutive quiet observations (zero prepared or running Sessions host-wide, not only in the fixture) within 30 minutes after Off and within 5 minutes after restart; committed work is allowed to finish",
        "Before the restart, copies every worker.out.log and worker.err.log under ~/Library/Logs/arcadia-services-*/ into evidence/worker-logs/ of this run's folder, verifies each copy's sha256 against its source and records them in the receipt; refuses (production already Off, nothing restarted) when no worker.out.log exists",
        "Restarts services only by running recover-arcadia-host-services (published in this library at its reviewed bytes) after verifying its script and descriptor sha256 and the sha256 of the restart implementation scripts/services.sh delegates to (~/.codex/skills/restart-arcadia-services/scripts/restart-services.sh), with ARCADIA_WORKSPACE set to the resolved martianrover path, ARCADIA_RESTART_SCRIPT, ARCADIA_RESTART_ATTEMPTS, ARCADIA_RESTART_RETRY_DELAY, ARCADIA_MISE_BIN, ARCADIA_NODE_BIN and ARCADIA_WORKSPACE_DEFAULT unset, and a 15-minute bound",
        "That reviewed restart path runs go-broker install, which rewrites host ~/.codex and ~/.claude configuration and shared skills (with timestamped backups), then unloads Arcadia's launchd services and may SIGTERM Arcadia's own service processes; this script itself sends no signal except the SIGTERM that a bounded timeout sends on expiry; if the 15-minute restart bound expires mid-restart, services can be left stopped and the run refuses with that stated in its handoff",
        "Classifies each fixture Session as integrated, preserved, no committed work (only when no preservation commit exists), still live, uncommitted changes retained, or committed but unreconciled, and refuses unless every one is integrated, preserved or empty. Preserved means the clean tip is exactly the canonical preservation receipt's commit, or (through the tested read-only helper src/operatorActions/preservedCandidateReconciliation.ts) exactly one accepted-completion settlement of that Session's Action on top of it, with the fixture branch and the receipt's open pull request both at that exact tip, read through gh without changing GitHub. Any other descendant is committed but unreconciled, with a named refusal reason in work-reconciliation.jsonl",
        "Writes inactive-receipt.json, restart-receipt.json, intervention-ledger.jsonl, observation logs, evidence/worker-logs/, work-reconciliation.jsonl, a timestamped receipt (with fixtureMain, workerLogs and chainActionSessions, which the next run's parameter file binds) and, on refusal, a failure handoff under runs/<timestamp-pid>/"
      ],
      never_does: [
        "This script runs no kill or pkill command and never stops a tmux Session directly; its only signals are a bounded timeout's SIGTERM on expiry (the pinned restart path may also SIGTERM Arcadia's own service processes)",
        "Never removes, resets, rebases or force-updates a worktree, branch or candidate, and never discards uncommitted changes",
        `Never turns Off a production policy it does not own (any request id other than ${c.ids.grant}, or a different scope)`,
        "Never turns production back On, reactivates a saved configuration, or presses any Grant",
        "Never merges, pushes, deploys or changes GitHub, credentials or Decisions",
        "Never runs an unreviewed restart path: a changed or missing recover-arcadia-host-services or restart implementation refuses"
      ]
    },
    success: {
      effect: "Production is Inactive with zero live admissions and Sessions before and after the reviewed restart; every worker log was copied into the evidence folder first; every fixture candidate is integrated, preserved or empty, recorded in work-reconciliation.jsonl.",
      next: "Post WINDOW OPEN with the outcome, capture the evidence, file an Issue per defect, and fill the next run's parameter file's previous-run bindings from this receipt (runId, fixtureMain) and its work-reconciliation.jsonl, together with this run's reset receipt (runId, newHead)."
    },
    failure: {
      effect: "The receipt and failure handoff name the stage, whether Off is confirmed and whether services were restarted. Nothing was killed or discarded, and production was not turned back on.",
      next: "If Off is not confirmed, rerun this action or use the dashboard Off switch first. Otherwise resolve the named condition (draining work, an unreviewed restart path, a missing worker log, an unreconciled candidate) through its reviewed path and rerun; this action is repeatable."
    }
  };
}

export function chainDescriptor(kind: ChainKind, params: ChainRunParams): ChainDescriptor {
  switch (kind) {
    case "reset": return resetDescriptor(params);
    case "preflight": return preflightDescriptor(params);
    case "grant": return grantDescriptor(params);
    case "terminalOff": return terminalOffDescriptor(params);
  }
}

/** The exact descriptor file bytes. */
export const chainDescriptorText = (kind: ChainKind, params: ChainRunParams): string => `${JSON.stringify(chainDescriptor(kind, params), null, 2)}\n`;


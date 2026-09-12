# Arcadia process review — 2026-09-12

**Do a narrowly rescoped A first, then C; defer broad B.** Reliable preservation
and truthful approval are prerequisites. A general process redesign is not.
The proposals identify real friction but misdiagnose several existing paths.

Scope: bounded investigation at `57c023ce6b398783136ea889bafb19fd6438d6d1`.
Milestone: **Bootstrap managed production to build Flight Deck**. Classification:
read-only review; required Artifact: this report and its review PR. Recommended
next implementation: connect trusted candidate validation to protected
preservation. No implementation, Agent Ask, settlement, or governance edit was
performed. Source citations below refer to this revision.

## Six claims

### 1. Sandboxed agents cannot preserve their work — partly confirmed

The intended protected path is unreachable from the agent:

- `src/agentSetup/goBrokerAgentSetup.ts:355` returns only `advance` and
  `workMonitor`; both Codex rules and Claude permissions derive from that list
  (`:301`, `:342`).
- `src/goBroker.ts:29` explicitly rejects sandboxed `go` and `preserve`, telling
  Codex to use only the two read-only brokers. `advance` only delegates dispatch
  (`:88`); it does not preserve a candidate.
- The installed `/Users/pmark/.local/bin/arcadia-preserve-broker-codex` exists,
  pointing at release `71f6c2f3873b08cd1e343b34fc515434f1873767`.
  The inspected installed `arcadia-go/SKILL.md` contains no preserve-launcher
  instruction; its continuation calls the advance broker at line 29.
- `pnpm arcadia go-broker status --json` nevertheless returned `ready: true`,
  empty issues, and that installed revision. Installation readiness is not
  evidence that the production loop works.

The Git diagnosis needs precision: linked worktrees have **separate indexes**
inside administrative metadata under the common Git directory, not one shared
index (`src/sessions/candidatePreservation.ts:153`). The intended restriction
blocks those writes. This review's authorized branch creation independently
failed with `cannot lock ref ... unable to create directory for .git/refs/...`.
That demonstrates this session's restriction, not every possible agent profile.

“No work can be recorded at all” is too broad: host preservation code exists
(`src/commands/preserve.ts:48`). The supported unattended agent-to-host path is
incomplete. More seriously, even a host invocation through the current launcher
has no validation source: see claim 2.

### 2. Is `let-agent-preserve-its-candidate` solvable as scoped? — partly

The objective is feasible, but an allowlist-and-skill patch cannot satisfy it.
Its acceptance requires an agent-callable launcher, actual preservation,
integration/pointer advancement, and refusal without declared acceptance
evidence (plan `:430–435`).

`src/goBroker.ts:82–85` calls preservation with only workspace and source.
`src/commands/preserve.ts:97–100` then defaults validation to **failed**, explicitly
because Session-exit validation is not wired. The only programmatic input is
`{ passed, evidenceRef }` (`:30–36`). The preservation guard checks `passed`
(`src/sessions/candidatePreservation.ts:310`); it does not independently establish
that each acceptance criterion has been met. Running outside a sandbox grants
filesystem capability, not knowledge or trustworthiness of evidence.

Rescope the first slice to a protected host request that obtains validation from
a trusted producer, binds it to the exact candidate content, Action, packet and
policy, and rejects absent, failed, stale or caller-fabricated evidence. Prove
one disposable objective-criteria fixture through the real launcher. Keep
subjective acceptance and integration authority separately gated. Pull only
the necessary evidence-production seam forward from
`reconcile-session-exits-to-next-move` (plan `:176–195`).

Move the integration-and-pointer proof into the later end-to-end reconciliation
proof: preservation is not completion. `advance-approved-production-work`
explicitly owns the missing Session-outcome-to-completion bridge (plan
`:198–216`). An alternative is to preserve unaccepted WIP and gate completion
later, but that would deliberately change criterion 6; do not pretend it meets
the present contract.

### 3. `next` and broker disagree at identical state — partly; not reproduced

The claimed separate dispatch implementations are not present in current source.
`src/commands/next.ts:58` and `src/commands/go.ts:178` both call
`resolveDispatch`. It batches authoritative document errors
(`src/docs/dispatch.ts:104`) and calls the shared dependency check
(`:258`, `:375`). The installed revision's source has these same calls.

A read-only direct invocation of `resolveDispatch` and `resolveReadySet` from
the reviewed source returned:

```text
current: prove-zero-prompt-production-loop
blocker: Depends on "let-agent-preserve-its-candidate", which is "open", not done.
ready: expose-guarded-host-session-launch; let-agent-preserve-its-candidate;
       refuse-to-orphan-an-uncommitted-candidate; register-agent-workspace-trust;
       approval-must-apply-or-refuse
suggested: expose-guarded-host-session-launch
```

Thus Decision 0046's assertion that plain `next` ignores that dependency is
refuted for the current resolver. Historical contradictory output remains
unverified. `next` resolves its repository from workspace metadata
(`src/commands/next.ts:148–157`); `go` can select the base worktree after integration
(`src/commands/go.ts:176`). Repository commit identity alone does not establish
equal paths, working files, workspace metadata, or executable revisions.

### 4. R183 approval discarded its answer — partly

Decision 0046 is still `status: open` (`docs/decisions/0046-how-should-this-project-update-be-applied-set-the-work-pointer-to-let-agent-pres.md:7`).
Both pointers still name the rehearsal (`PROJECT.md:12`, plan `:500`).
Live R183 status could not be independently read in this session.

The defect mechanism is concrete: clarification approval routes through
`src/commands/review.ts:722`; `:1176–1195` records `approved` and the answer in
SQLite, optionally resets a work item's clarification, and writes no Decision
document or Project pointer. The answer is **stored but not applied**, rather
than discarded. Unsupported `project_update` targets create an open Decision
instead of a pointer patch (`src/ask/settlement.ts:246–258`). Approval cannot
magically supply the missing apply path. Fix apply-or-refuse behavior, preserving
an actionable unresolved item when no supported effect exists.

### 5. Computed answers have no execution path — partly

`go` prints the exact launch command (`src/commands/go.ts:453–455`) and has an
explicit launch path (`:320`). This is useful output; reconstructing it manually
was avoidable. The broader unattended launch contract remains unfinished.

There is no direct `next --accept-suggestion` control, but “nothing can accept
it” is false. `advance queue make-next` already exposes an explicit Action,
queue revision, request id and preview/apply fingerprint
(`src/cli.ts:1384–1415`). Its writer checks readiness and updates both pointers
(`src/dispatch/pointer.ts:66–82`, `:121–140`). Queue eligibility and authorization
still apply; this is not a promise that every suggestion can be blindly applied.

Moreover the suggestion is merely the current ready Action or the **first ready
entry in plan order** (`src/docs/dispatch.ts:660–664`). It computes eligibility,
not optimal priority. Automatically choosing C because it is first would not
resolve the operator's A-versus-C judgment.

### 6. Duplicate pointers must be synchronized by hand — partly

Both fields exist, but manual synchronization is not required. The writer above
updates the pair with restoration on failure. Completion settlement also updates
both (`src/ask/settlement.ts:528–534`). `PROJECT.md` already has precedence; the
plan field is a compatibility fallback and disagreement is a blocker
(`src/docs/dispatch.ts:187–195`). Removing duplication may simplify migration
later, but it is not a missing-source-of-truth emergency.

## Recommended order and highest leverage

1. **A, narrowly rescoped: trusted evidence into protected preservation.** It
   closes an actual dead end, reuses existing preservation machinery, and makes
   subsequent implementation recoverable. Merely adding launcher permissions
   would leave both the sandbox guard and failed-validation default intact.
   Correct any approval needed to authorize this work through the supported
   canonical path; if approval cannot apply, `approval-must-apply-or-refuse` is
   the immediate stop-the-line repair, not an excuse for a broad B programme.
2. **C: guarded launch → exit reconciliation → governed completion → worker →
   two-Action proof.** The plan already assigns these responsibilities. The
   rehearsal's amended criterion still requires reconciliation and pointer
   advancement (plan `:396`) while its dependency list only names preservation
   (`:398`). Removing unattended Action B launch did not remove those remaining
   missing prerequisites. Reconcile that scope before claiming the rehearsal
   can pass with zero hidden intervention.
3. **B only where measured friction survives the working loop.** Reuse the
   existing pointer writer for a direct confirmation surface. Add a read-only
   validation entry point when wiring the next admission/CI check. Defer a
   generic wizard until a repeated operator-only procedure remains after the
   loop runs. Defer pointer-field migration until compatibility is the observed
   cause of a failure. Drop a second readiness engine and new pointer machinery
   entirely: they already exist.

**Single highest-leverage change:** connect trusted, candidate-bound validation
to the existing protected preservation operation. It turns an already-built
commit/recovery mechanism into a usable path and supplies evidence the later
completion bridge also needs. It is more valuable than polishing the number of
flags around a loop that cannot yet finish.

The razor is incomplete. Replace “derivable means no round trip” with:
**If fresh authoritative state and existing authority determine one valid
mechanical transition, execute it idempotently and report the receipt. If
judgment or authority is missing, ask once with consequences. If evidence is
missing or contradictory, refuse with all known actionable reasons.**
Deterministically computing a choice does not authorize it.

## Where the existing analysis is wrong

- “Every validator reports only its first error” contradicts the proposal's own
  four-error example and `src/docs/dispatch.ts:104`. Some argument validation is
  serial; universalizing it points at an unnecessarily broad rewrite.
- Pointer movement has a guarded writer; the unsupported `project_update`
  route was the wrong mechanism. Duplicate storage is real, mandatory manual
  synchronization is not.
- Current `next` dependency checking exists. Diagnose the historical execution
  context before proposing another shared resolver.
- A host launcher cannot infer completion merely from its privilege. Evidence
  production is missing, not just an allowlist entry.
- “Prose was the problem” overstates what the wizard anecdote establishes. A
  guided surface may help human procedure; it does not repair preservation,
  approval effects, or missing autonomous reconciliation.

## Limits and reproducible evidence

The permitted `pnpm arcadia next --project arcadia --json`, `next --ready`, and
`review show R183 --json` failed with `SQLITE_WORKSPACE_WRITE_DENIED` against the
configured workspace. They were not successful live-state observations.
`src/db/connection.ts:6–18` opens a writable database, enables WAL and runs schema
setup; `next` additionally journals an event (`src/commands/next.ts:61`). A true
read-only helper already exists (`src/db/connection.ts:23`). This is another
specific correctness repair, not justification for broad sandbox permissions.

The direct resolver check used the existing exported functions, without database
access or changing fixtures:

```sh
mise exec -- node --import tsx --input-type=module -e 'import {resolveDispatch,resolveReadySet} from "./src/docs/dispatch.ts"; const r=resolveDispatch(process.cwd(),"arcadia"); const s=resolveReadySet(process.cwd(),"arcadia"); console.log(JSON.stringify({action:r.context?.action.id,blockers:r.blockers,ready:s.ready?.map(x=>x.actionId),suggested:s.suggestedCurrentAction},null,2))'
```

To settle R183, run `review show R183 --json` from an authorized host and compare
its intent, answer and status with Decision 0046. To settle the historical
dispatch discrepancy, capture both executable revisions, canonical repository
paths, workspace selection and working-file hashes alongside both outputs.
No mutating broker, activation, advance, or settlement was run. The day's
955-line/PR/Decision totals, red-main cause, and all-provider sandbox behavior
were not independently audited; they are not premises of this ordering.

## Delivery and next session

Local Git branch/worktree creation was denied at the shared metadata boundary.
The GitHub connector also refused branch creation: `MCP tool call requires
approval, but approval policy is never`. Therefore this report is locally saved,
not committed or represented by a PR. No implementation checks are claimed.
Recovery location: repository/worktree `/Users/pmark/Dev/MR/Arcadia/arcadia`,
branch `main`; the only path created by this review is the untracked
`docs/reports/arcadia-process-review-2026-09-12.md`. The attempted new branch was
not created. Do not commit this report directly on `main`.

Recovery: in an authorized host session, preserve only this report on
`codex/arcadia-process-review-2026-09-12` from the reviewed revision, push it and
open its review PR. The operator QA procedure is to inspect the one-file diff,
follow the cited source lines, and reproduce the read-only resolver check above;
the end-user procedure is the same. No new runnable surface exists because this
change is analysis only. The report and command output are the proof Artifacts;
implementation fixtures become available when the recommended work is built.

End this investigation after preservation. Use a new session to finish the
report handoff; after the operator settles the work order, open implementation
with `arcadia go` so the canonical pointer selects its scope. The evidence and
host boundary work warrants GPT-6 Astra with high effort; report preservation
needs only deterministic Git/PR operations.

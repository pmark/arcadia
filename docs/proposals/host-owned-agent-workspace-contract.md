---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia make managed multi-session coding reliable by owning Git and worktree lifecycle on the host while coding agents only edit and validate inside a prepared candidate workspace?
---

# Host-owned coding-agent workspace contract

## Recommendation

Make the execution boundary explicit: **Arcadia owns repository state; the coding
agent owns source changes inside the prepared candidate workspace.**

Do not grant a sandboxed agent broader Git metadata access merely so it can
commit, create branches, move worktrees, or repair repository state. Do not add
another workspace abstraction. Reuse the existing host-side preparation and
preservation machinery, and make candidate continuation a first-class managed
production behavior.

The practical unit is one **candidate workspace per governed Action**, not one
worktree for an entire Plan and not necessarily one new worktree per agent
process. A single Action may require multiple sequential coding-agent sessions;
those sessions may continue in the same candidate worktree after the previous
session is proven terminal. Once the Action is accepted and integrated, the next
Action receives a fresh candidate from the current governed base.

This preserves small, reviewable increments while eliminating repeated manual
worktree preparation between sessions working toward the same accepted outcome.

## Why this is needed

The 2026-09-12 process review confirms the important boundary already present in
the implementation:

- linked worktrees keep their index and administrative metadata under the Git
  common directory;
- the coding-agent sandbox intentionally cannot write that shared metadata;
- `prepareAgentWorktree()` already creates isolated host-side candidate
  branches/worktrees;
- Codex worktrees already default to `~/.codex/worktrees` and Claude worktrees
  to `~/.claude/worktrees`;
- host-side candidate preservation already exists, but the unattended
  agent-to-host path and trusted validation handoff are incomplete.

Therefore the problem is not that Arcadia chose the wrong directory. The current
agent-native roots are a good boring default. The missing contract is ownership:
Git control-plane mutations must remain host responsibilities, while agent
sessions operate only on the prepared working tree.

## Contract

### 1. Host preparation

Before launch, Arcadia resolves and binds:

- Project, Plan and Action;
- immutable packet and production-policy identity;
- canonical repository;
- exact governed base revision;
- provider/model/effort selection;
- candidate branch and worktree path;
- repository/candidate lease.

Arcadia creates the branch and linked worktree from the host before the agent is
started. Preparation is deterministic and idempotent for the admitted candidate.
The coding agent never creates or chooses its own worktree.

### 2. Stable, agent-native worktree location

Keep the existing placement rule in `src/sessions/worktreePreparation.ts`:

- Codex: `~/.codex/worktrees/...`
- Claude: `~/.claude/worktrees/...`

A configured host override may exist for tests or deployment constraints, but
managed production does not negotiate location per Project or ask the agent to
pick one. Ergonomic adjacency to the source checkout is not a requirement.

### 3. Agent responsibilities

A coding-agent session may:

- inspect the admitted candidate;
- edit source and documentation within it;
- run allowed tests, builds, linters and read-only Git inspection;
- report evidence, blockers and remaining work.

It does not own:

- `git worktree add/remove/move`;
- branch creation or switching;
- stash/rebase/reset/merge;
- commit or push as a required continuation mechanism;
- integration into the governed base;
- cleanup of branches or worktrees.

Those operations either require Git common-directory writes or affect recovery
and governance, so they remain host-controller operations.

### 4. Candidate continuation across sessions

The existing safety rule should be refined from “one coding session gets one
branch and one worktree” to the actual isolation invariant:

> One candidate worktree may have at most one live conflicting coding-agent
> execution. Sequential sessions may reuse that candidate after the previous
> session is proven terminal and the candidate lease is transferred or renewed.

If an Action is incomplete but its candidate is valid and preserved enough for
continuation, Arcadia launches the next bounded session in the same worktree and
branch. The new session receives the same Action/candidate identity plus fresh
instructions describing the remaining acceptance gap.

The agent conversation is disposable. The candidate workspace and Arcadia Run
state are durable.

### 5. Host validation and preservation

After each terminal session, Arcadia observes the exact candidate state and runs
trusted validation bound to:

- candidate content/revision or tree fingerprint;
- Action and immutable packet;
- production-policy epoch;
- acceptance criteria and evidence source.

The host-side preservation broker then creates the recoverable checkpoint when
policy permits. Missing, failed, stale or caller-fabricated validation must not
be converted into accepted evidence merely because the host has permission to
commit.

Preservation is not completion. Completion and pointer advancement remain the
separate governed reconciliation step already assigned to managed production.

### 6. Fresh candidate between accepted Actions

Do not keep one giant Plan worktree alive across already accepted Actions by
default. After an Action is accepted and integrated, create the next Action's
candidate from the current governed base revision.

This keeps blast radius small, makes review and recovery easier, and prevents a
long-running Plan workspace from quietly accumulating unrelated state.

### 7. Mechanical failure states

Worktree problems should become ordinary Arcadia state, not reasons for operator
Git surgery. At minimum distinguish:

- `candidate_preparation_failed`
- `candidate_conflict`
- `session_incomplete`
- `validation_failed`
- `preservation_failed`
- `candidate_preserved`
- `candidate_ready_for_continuation`
- `requires_human_decision`

Each non-human state should have one deterministic retry, recovery, or refusal
path. Escalate only when judgment, authority, credentials, destructive recovery,
or contradictory evidence is required.

## Smallest useful implementation

Do not redesign managed production. Reuse:

- `prepareAgentWorktree()` for host-side candidate creation;
- existing Session and repository leases;
- the host preserve broker;
- existing criterion-level validation work;
- existing reconciliation and canonical completion writers.

Add only the missing continuation seam:

1. give a prepared candidate a durable identity independent of one provider
   process;
2. allow a terminal Session to leave that candidate in a resumable state;
3. launch a subsequent bounded Session against the same candidate when the same
   Action still owns it;
4. keep the one-live-execution lease invariant;
5. preserve/checkpoint through the host, never through broadened sandbox Git
   permissions;
6. retire the candidate only after accepted integration or explicit abandonment
   proves no unique work will be lost.

No new daemon, queue, Git abstraction, workspace root, agent framework, or
provider-specific orchestration layer is required.

## Acceptance criteria

The first proof should use a disposable repository and one objective governed
Action deliberately split across at least two coding-agent sessions.

It is accepted when:

1. Arcadia creates the candidate branch/worktree from the exact admitted base
   without agent involvement.
2. Session A changes the candidate and exits without needing write permission to
   the Git common directory.
3. Arcadia validates/preserves the candidate through the protected host path.
4. Session B launches against the same candidate, sees Session A's changes, and
   completes the remaining bounded work without manual Git/worktree preparation.
5. A concurrent second live execution against that candidate is refused.
6. A crash or lost launcher response can reconcile to the existing candidate and
   Session identity instead of creating a competing worktree blindly.
7. Missing/stale validation prevents accepted preservation/completion with an
   actionable reason.
8. Accepted completion integrates through the existing governed path, then the
   next Action receives a fresh candidate from the new governed base.
9. Cleanup cannot remove a candidate containing unique unpreserved work.
10. The complete two-session proof requires no operator shell command, branch
    creation, worktree repair, commit, stash, rebase or cleanup.

## Non-goals

This proposal does not authorize:

- making `.git` or the Git common directory writable to coding agents;
- agent-owned commits as the durability mechanism;
- concurrent agents sharing one candidate worktree;
- one long-lived worktree for an entire multi-Action Plan;
- automatic merge, deployment, publication, spending or credential expansion;
- a second scheduler or readiness engine;
- changing the current Codex/Claude worktree roots merely for aesthetics.

## Relationship to existing managed-production work

This is a narrow execution-contract clarification, not a replacement Plan.
Implementation should be absorbed into the existing bootstrap Actions that own
protected preservation, Session exit reconciliation, production advancement and
the zero-prompt multi-Action proof.

Relevant existing artifacts:

- `docs/working-copy-safety.md`
- `docs/reports/arcadia-process-review-2026-09-12.md`
- `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`
- `docs/plans/mission-control-view/17-managed-production-contract.md`
- `src/sessions/worktreePreparation.ts`
- `src/sessions/candidatePreservation.ts`
- `src/commands/preserve.ts`

The architectural rule is deliberately small:

**Arcadia owns Git and candidate lifecycle. Coding agents edit and validate the
workspace Arcadia gives them. Sessions may be disposable; the candidate and Run
state are not.**

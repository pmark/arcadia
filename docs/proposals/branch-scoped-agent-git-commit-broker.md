---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia adopt a host-owned automated-session lifecycle that preserves sandboxed agent isolation, validates and independently reviews immutable candidates before publication, and permits only tightly bounded agent-branch commits and publication through audited host brokers?
---

# Safe automated-session lifecycle

## Why this project needs it

Codex `workspace-write` permits source edits in a prepared worktree but denies
writes to its linked Git common directory. `git add` therefore cannot create
the worktree index lock. This is intentional sandbox isolation, and the
current Arcadia host-preservation path safely commits the candidate after the
agent exits.

The current agent-facing guidance is internally inconsistent: the protected
Arcadia Go skill directs sandboxed agents to host preservation, while the
broader continuation rules still tell them to commit, push, open pull requests,
and merge base changes. That contradiction encourages unsafe attempts to escape
the sandbox, and it leaves the safe owner of pre-publication review and PR
publication underspecified.

## Outcome

Every managed Session has one reliable lifecycle: an agent edits only its
registered worktree; a host controller owns Git metadata and credentials; an
immutable candidate receives deterministic proof and a typed advisory review
decision before publication; and publication, remote QA, and merge each retain
their separate authority boundaries.

## Proposed lifecycle

```text
host creates registered agent branch + isolated worktree
  -> sandboxed agent edits, tests, and drafts completion evidence
  -> host snapshots, validates, and commits the exact candidate
  -> deterministic pre-publication risk assessment
  -> local-first typed decision engine recommends a disposition
  -> independent read-only review when policy requires it
  -> host publishes only an approved, unchanged candidate branch
  -> remote CodeRabbit + CI review the published SHA
  -> existing merge policy decides whether integration is permitted
```

Each transition is bound to the candidate SHA and records a durable receipt.
Any source change, including a repair after review, creates a new candidate and
restarts proof and review from the deterministic preflight.

## Required safety contract

### 1. Sandboxed agent contract

The agent may read, edit, and run declared local validation in its registered
worktree. It may draft a governed completion Ask and request a fixed host
operation. It may not invoke direct Git mutation or remote publication:
branch creation, staging, commits, fetch/pull, push, PR creation, merge,
rebase, reset, amend, force update, tag/ref mutation, or arbitrary Git config
are all outside its authority.

The one agent-facing instruction must say this plainly and must replace the
conflicting generic requirements to commit, push, and repair PRs directly.

### 2. Host commit and preservation broker

The host broker accepts no shell command or filesystem path from the agent. It
binds one live Session/reservation to its registered worktree, generated
agent-owned branch, pinned base revision, an explicit repository-relative path
list, and a bounded commit message. It refuses protected branches (including
`main`), detached heads, stale or mismatched leases, untracked worktrees,
paths outside the worktree, concurrent index locks, hooks or filters that can
execute arbitrary host code, and post-validation mutation.

It records a durable receipt containing the request, candidate tree, parent and
result SHAs, exact paths, policy and lease IDs, timestamp, validation evidence,
and result. Retrying the same request is idempotent; a changed tree requires a
new request.

### 3. Pre-publication decision and review

After preservation and before publication, the host runs deterministic checks:
the candidate/base SHA relation, diff and changed-path classification, Action
scope, required test/build evidence, and the existing blast-radius taxonomy.

A provider-neutral, versioned decision API receives only that frozen evidence
and returns an advisory typed result:

- `publish_without_extra_review`
- `review_required`
- `operator_decision_required`
- `block`

The engine is local-first, read-only, and cannot execute commands, change Git
state, approve itself, or grant authority. Its output is an Artifact bound to
the candidate SHA, with model/provider/version, input fingerprint, reasons,
and policy version. Engine failure fails closed for unattended publication: the
candidate remains preserved and the receipt names the recovery route.

`review_required` invokes an independent, read-only reviewer against the same
SHA. Authority-sensitive paths, broad diffs, missing proof, credential or
production touches, and policy uncertainty must require review or an operator
Decision; the model must never lower those deterministic requirements.

### 4. Publication and remote QA

Only a separate host publication broker, carrying explicit policy authority,
may push the preserved agent branch and create or update its PR. It must pin
the remote destination and candidate SHA, prove the branch is agent-owned, and
write a publication receipt. It cannot push `main` or another protected branch.

CodeRabbit and required CI remain independent remote defenses after the push.
Any finding or failing check returns the candidate to a new sandboxed repair
Session; the host then preserves and evaluates the new SHA again. Merge remains
governed by the existing merge policy and never follows merely from a model or
review recommendation.

### 5. Reliability and recovery

The host serializes operations per repository/common Git directory, uses
compare-and-swap checks before mutation, and refuses ambiguous lock, lease,
branch, remote, or SHA state. It retains worktrees and receipts after failure;
it never cleans, rewrites, or deletes history as recovery. A host restart
replays idempotent requests or reports the exact unfinished state.

The dashboard should project this lifecycle as: `editing`, `preserved`,
`preflight_blocked`, `under_review`, `awaiting_operator`, `published`,
`remote_qa_failed`, and `merge_ready`. These are projections of receipts and
Git state, not a second source of truth.

## Why this is a proposal rather than a local sandbox workaround

Adding the Git common directory as a writable Codex root would also give an
agent access to refs, hooks, worktree administration, objects, and every
linked worktree; it cannot enforce branch semantics at the filesystem layer.
Changing agent authority to create commits or publish branches crosses the
Constitution's explicit authorization boundary. A host broker could implement
this contract, but only after a Decision approves the authority, review policy,
failure behavior, and audit policy; it must not be smuggled in as a broader
`workspace-write` exception.

## Suggested 80/20 delivery order

1. Reconcile the agent instructions: sandboxed Sessions draft and request host
   preservation; they never commit or publish directly.
2. Make preservation receipts and deterministic pre-publication assessment the
   required host gate before publication.
3. Add the read-only typed decision engine as advisory review triage, initially
   routing all authority-sensitive or uncertain cases to review.
4. Add host publication only after the first three layers produce durable,
   replayable evidence.

Do not begin with direct `.git` write access, generic Git command execution,
automatic merges, or a broad autonomous policy engine.

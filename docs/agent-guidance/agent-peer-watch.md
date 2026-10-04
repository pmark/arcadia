# Detailed Way guidance: agent peer watch

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

Coding agents watch each other so work keeps moving when one stalls or runs
out of capacity. This procedure is the contract: what an agent publishes, what
a watcher reads, how a watched agent is classified, and what a watcher may do.
The typed schema and the pure parsing and classification code are
`src/agentWatch/contract.ts` and `src/agentWatch/classify.ts`. The code is the
reference; tests hold this page's numbers and table equal to it.

This contract posts nothing, polls nothing and mutates nothing. Posting a
heartbeat or offer to GitHub is outward messaging. It needs an explicit
operator Decision naming the repository and issue. Without one, a comment
block exists only as a local draft.

## The rule that outranks everything below

**None of these proves that ownership was released:**

- a coding turn ending;
- no process running inside the candidate;
- a preserved local head;
- no pull request yet;
- silence on any channel;
- a comment that says `release_requested`.

The owner may be waiting for independent review, QA or a procedure, with the
same writer due to resume. Ownership comes only from the governed rows, and
it fails closed: when they do not affirmatively show a release, it is `held`
or `unknown`, never `released`.

- **Released** needs three things. There is no Action claim (as
  `getActiveActionClaim` reads it). The principal is `none`: a managed Session
  without a claim, whether live, exited, unreconciled or `needs_input`, never
  proves release. And the watcher read and affirmed, each as an explicit
  `false`, all of these for the Action and its candidate:
  - no `prepared` or `running` `agent_sessions` row;
  - no `agent_worktree_reservations` row, with or without claim columns;
  - no manual or native handoff, and no pending enrollment.

  A null claim alone proves nothing. A reservation without claim columns, a
  claim whose worktree is gone, or a handoff that was never launched can all
  still have an owner. A release is takeover-eligible only when it carries a
  release reference, such as a settlement or release receipt id. Without one,
  the watcher escalates.
- **Principal proven terminal** is the term from Decision 0051. It means
  exactly the receipt `arcadia go` resumes from (`getResumableLeaseHandoff`):
  - the claim's managed Session is terminal;
  - its `session_exit_receipts` row has outcome `incomplete_resumable` with a
    lease handoff;
  - the handoff is not superseded;
  - the receipt is not simulated;
  - it is bound to the claim's candidate.

  Every other outcome stays `held`, with an escalation: unreconciled,
  `needs_input` (an operator question), `failed_execution`,
  `missing_evidence`, `successful_exit`, `accepted_completion`, superseded or
  simulated.
- **Positive affirmation only.** Ownership input is parsed strictly before
  classification. Every field must be present, with exactly its type and value
  set; absent rows are `null`, never omitted. These all fail closed to
  `unknown`:
  - `undefined`, `0`, `1`, `""`, `NaN` or `"true"` where a boolean, enum or
    instant belongs;
  - an unknown principal kind or Session status;
  - an incomplete claim, Session or receipt row;
  - an invalid watcher clock.

  An affirmed live Session or manual handoff beside a claim keeps it `held`.
- **Principal agent.** The principal must be the watched agent for every
  state other than released. A mismatch, or an agent that cannot be
  established, is `unknown`.

A watcher that cannot verify release stays read-only. It reports the state,
the exact head, the first gate and the recovery to the nearest orchestrator or
to the operator.

## Channels

A watcher reads only channels every supported agent already has:

1. **Commits on the candidate branch.** A commit counts as the owner's activity
   only when all of these hold:
   - It was listed from the claim's branch.
   - Its author and committer are both a builder identity of the owner's
     platform, as `arcadia identity resolve` derives it at any tier. A critic
     identity is a different principal, and so is a host or controller
     identity.
   - Its time is not in the future beyond clock skew.
   - Any contract trailers it carries parse and agree with the claim.

   An owner commit without trailers still counts, because nothing emits the
   trailers yet. An empty commit may serve as a heartbeat.
2. **Issue comments on the coordination issue.** Each comment has at most one
   fenced machine-readable block.
3. **Session and lease rows.** These are `agent_sessions` (status,
   `started_at`, `last_activity_at`, `stall_flagged_at`), the claim's
   `created_at` and `claim_generation`, and `session_exit_receipts`. All are
   read-only.
4. **Coding-agent capacity telemetry.** This is the `ProviderCapacityReceipt`
   from `src/codingAgents/capacity.ts`: source, `real` or `simulated`
   evidence, `observedAt`, freshness, availability (`available`, `unknown`,
   `usage_limited`, `budget_limited`) and windows. Only `real` evidence
   counts. A simulated receipt is listed with its reason and never classifies
   an agent.

### What each agent can produce today

| Agent | Identity commits | Contract trailers today | Issue comments | Session rows | Capacity telemetry |
|---|---|---|---|---|---|
| Claude Code | yes | no | yes | yes | yes |
| Codex | yes | no | yes | yes | yes |
| OpenCode | yes | no | unknown | yes | no |

What the cells mean:

- **Identity commits:** commits under the agent's semantic identity, as Git
  history shows them for each platform.
- **Contract trailers today:** nothing emits them yet. Any agent that commits
  can add them once the publishing Action ships.
- **Issue comments:** these were observed on the coordination issue. Every one
  was posted through the operator's GitHub login and signed with the agent's
  identity signature. OpenCode has posted none, and whether its permission
  configuration allows posting is unknown.
- **Session rows:** these exist when Arcadia launches the agent. An interactive
  or native session has none unless it is enrolled.
- **Capacity telemetry:** Claude Code reads the usage snapshot and Codex reads
  its app-server rate limits. OpenCode has no telemetry source, so only an
  operator attestation covers it. Where a cell is `unknown` or `no`, or a
  channel is unreadable, classification degrades to `unknown` and never to
  `healthy`.

## Commit trailer grammar

Git reads trailers from the last paragraph of a commit message, and a watcher
reads only that paragraph.

```text
Arcadia-Agent: <agent>/<tier>              claude|codex|opencode / light|standard|heavy
Arcadia-Action: <project-slug>/<action-id>
Arcadia-Claim: <claim-generation>          optional
Arcadia-Heartbeat: <UTC timestamp>         optional, e.g. 2026-10-04T20:33:12Z
```

The whole set is refused, never partially accepted, when any of these hold:

- a contract key is spelled in another case;
- a key appears twice;
- a value is over 128 bytes, has control or non-ASCII characters, or falls
  outside its grammar;
- `Arcadia-Agent` or `Arcadia-Action` is missing;
- the message is over 64 KiB.

Other `Arcadia-*` trailers belong to other contracts.

A trailer is untrusted text. It counts only when all of these hold:

- `Arcadia-Agent` names the same platform and tier as the commit author;
- `Arcadia-Action` names the claimed Action;
- `Arcadia-Claim`, when present, equals the current claim generation;
- `Arcadia-Heartbeat` is within clock skew of the commit time, so an old
  heartbeat replayed onto a new commit is refused.

## Comment block grammar

````text
```arcadia-peer-watch
schema: arcadia-peer-watch-v1
agent: <agent>/<tier>
action: <project-slug>/<action-id>
claim: <claim-generation>
state: working|waiting|release_requested|offer_help|escalated
evidence: commit:<sha40>, pr:<n>, issue:<n>, session:<id>, receipt:<id>
issued_at: <UTC timestamp>
```
````

**Parsing**

- Only a top-level fence with the info string `arcadia-peer-watch` is a block.
  A block quoted inside another fence or a blockquote is not.
- Each field appears once, as `key: value`.
- `claim` and `evidence` are optional to parse but listed above. A block
  without the current `claim` never counts.
- Limits: 2 KiB per block, 16 lines, 8 evidence references, 64 KiB per body.

**Refused or ignored**

- A comment with more than one block is refused.
- So is an unterminated fence, an unknown or repeated field, or a value outside
  its grammar.
- A well-formed block with another schema version is ignored.

**Binding**

- No field in the block identifies who posted it. A self-declared author field
  is just an unknown field.
- A block counts only when all of these hold:
  - the comment's server-side author login is in the trusted set an operator
    Decision names;
  - the comment was never edited;
  - the block names the owner's platform, the claimed Action and the current
    claim generation;
  - `issued_at` is within clock skew of the server's `createdAt`.
- Order and age come from the server timestamp. A repeated identical block is
  a replay; only its first appearance counts.

**Residual risk**

Agents share the operator's GitHub credential and can set any Git author. So
a forged comment or commit can make an owner look active. That can delay an
escalation, but it can never release ownership or show exhaustion. Exhaustion
comes only from the host's own `real` capacity telemetry.

Timestamps are parsed strictly: ISO 8601 or RFC 3339 with an explicit zone,
as Git's `%cI` and the GitHub API emit them. Impossible dates are refused.
Branch names are compared with any `refs/heads/` prefix removed.

## Freshness windows

| Window | Milliseconds | Meaning |
|---|---|---|
| `activityFreshMs` | 1200000 | Latest bound activity at most this old: healthy. |
| `stallAfterMs` | 7200000 | Quiet up to this long: idle, never stalled. |
| `clockSkewMs` | 300000 | Tolerated disagreement between a claimed and an observed time. |
| `capacityFreshMs` | 900000 | Capacity evidence older than this cannot show exhaustion. |
| `heartbeatMaxIntervalMs` | 600000 | Longest interval a publisher may leave between heartbeats. |
| `takeoverMaxAgeMs` | 300000 | Oldest a takeover request, or the classification it is revalidated against, may be. |

## Classification

Every result carries:

- the evidence, each item with its channel, reference, time, age and whether
  it counted;
- the latest counted activity;
- the unreadable channels;
- the non-proof observations, each marked `provesRelease: false`;
- the ownership state, with the claim generation, branch, Session, exit
  receipt and release reference it rests on.

The table is `PEER_WATCH_CLASSIFICATION_TABLE` in `src/agentWatch/classify.ts`.
Rows are checked in order.

| Evidence | State | Ownership | Watcher may |
|---|---|---|---|
| Ownership rows unreadable, or any ownership field missing, mistyped or outside its value set | unknown | unknown | observe, escalate |
| A principal or owner signal whose agent is unknown or not the watched agent (any claim state) | unknown | unknown | observe, escalate |
| No claim; principal unknown or a managed Session (a Session without a claim never proves release), or release facts not read | unknown | unknown | observe, escalate |
| No claim; the watched agent's live Session, or its native or prepared principal, exists | unknown | held | observe, escalate |
| No claim; principal `none`; release facts all `false`; a release reference | idle | released | observe, continue released work (pointer must name the Action) |
| No claim; principal `none`; release facts all `false`; no release reference | idle | released | observe, escalate |
| Claim held; no other live Session or manual handoff affirmed; its managed Session is terminal with a real, unsuperseded `incomplete_resumable` lease handoff on this candidate | idle | principal_terminal | observe, continue released work (pointer must name the Action) |
| Claim held; its Session exited but is unreconciled, `needs_input`, simulated, superseded or reconciled with any other outcome, or another live Session or manual handoff is affirmed | by activity | held | the activity row's actions, plus escalate |
| Claim held; fresh `real` capacity evidence of a spent window, `usage_limited` or `budget_limited` | exhausted | held | observe, offer help, escalate |
| Claim held; latest counted activity within `activityFreshMs` | healthy | held | observe |
| Claim held; latest counted activity within `stallAfterMs` | idle | held | observe, offer help |
| Claim held; nothing counted within `stallAfterMs`; some channel unreadable | unknown | held | observe, escalate |
| Claim held; nothing counted within `stallAfterMs`; every channel read | stalled | held | observe, offer help, escalate |

**Exhausted** requires all of these:

- capacity evidence for the owner's own provider;
- evidence mode `real`;
- freshness `fresh`, observed within `capacityFreshMs`;
- not `none` or unmetered configuration;
- a window that has not reset since.

Simulated, stale or unknown capacity never shows exhaustion. Exhausted takes
precedence over healthy, even when the owner committed seconds ago, because
fresh capacity evidence predicts no further progress. `latestActivity` still
reports that commit.

**Stalled** requires all of these:

- an owner with an active claim;
- no fresh activity across all channels;
- every channel read.

A `stalled` or `exhausted` owner still owns its work and is never taken over.
The 2026-10-03 enrollment collision shows why. A native runtime ended its turn
to wait for review. No process ran in the candidate. Its head was preserved and
it had no pull request, yet its orchestrator still owned the work. That
evidence classifies as `held`, and the takeover is refused.

## What a watcher may do

A watcher may only:

- **observe**;
- **offer help**, as a draft comment block (`state: offer_help`) unless a
  posting Decision exists;
- **escalate to the operator** with the exact remedy;
- **continue work the owner has released.**

Continuing goes only through existing recovery. The watcher builds a takeover
request (`arcadia-peer-takeover-request-v1`), which carries:

- the requester;
- the target Action;
- the observed evidence references and classification time;
- the claim generation and branch;
- the basis: `claim_released` or `principal_proven_terminal`;
- the terminal Session and exit receipt, or the release reference;
- the governed command it relies on.

Immediately before acting, the watcher revalidates the request against a fresh
classification. Validation refuses malformed input; it never throws. It
requires all of these:

- the claim generation, branch, Session, exit receipt and release reference
  are unchanged;
- the recovery is exactly the governed command for the requester;
- the request and the classification are both within `takeoverMaxAgeMs`, and
  in order;
- the Project pointer names the target Action. `arcadia go` starts the
  pointer's Action, not the watched one. An Action already settled or landed
  has moved off the pointer, and nothing remains to continue.

A release with no release reference cannot be told apart from a later re-claim
and re-release, so it is never takeover-eligible. Validation returns a
normalized copy of the request with only the contract's fields, takes the
state from the fresh classification, and refuses an invalid clock.

| Basis | Existing recovery |
|---|---|
| Released with a release reference (pointer still names the Action) | Preview with `arcadia go --agent <agent>`, which changes nothing. Then `arcadia go --agent <agent> --apply` dispatches it with a fresh claim. |
| Principal proven terminal (pointer still names the Action) | Same preview and `--apply`. `go` resumes the same candidate from the `incomplete_resumable` handoff (Decision 0051). |
| Session exited, not reconciled | Escalate. The operator judges and may run `arcadia session reconcile <session-id>`. |
| `needs_input` | Escalate. The operator answers the question and the owner resumes. |
| Any other reconciled outcome, a superseded or simulated receipt, or a native or prepared principal | Escalate. Only the owner's or its orchestrator's explicit release, plus a handoff receipt, hands it over. |

A watcher never does any of these:

- clears a lease, releases a claim or expires one by elapsed time;
- edits another owner's candidate;
- resets history or duplicates a candidate;
- treats a helper prompt, momentum or liveness inference as ownership or
  approval.

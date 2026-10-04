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
same writer due to resume. Ownership comes only from the governed rows:

- the Action claim in `agent_worktree_reservations`, as `getActiveActionClaim`
  reads it;
- the claim's principal;
- for a managed Session, the Session's `agent_sessions` status together with
  its `session_exit_receipts` row. Reconciled counts as proven terminal (the
  term from Decision 0051); merely exited does not.

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
   `usage_limited`, `budget_limited`) and windows.

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
escalation, but it can never release ownership or show exhaustion.

## Freshness windows

| Window | Milliseconds | Meaning |
|---|---|---|
| `activityFreshMs` | 1200000 | Latest bound activity at most this old: healthy. |
| `stallAfterMs` | 7200000 | Quiet up to this long: idle, never stalled. |
| `clockSkewMs` | 300000 | Tolerated disagreement between a claimed and an observed time. |
| `capacityFreshMs` | 900000 | Capacity evidence older than this cannot show exhaustion. |
| `heartbeatMaxIntervalMs` | 600000 | Longest interval a publisher may leave between heartbeats. |

## Classification

Every result carries:

- the evidence, each item with its channel, reference, time, age and whether
  it counted;
- the latest counted activity;
- the unreadable channels;
- the non-proof observations, each marked `provesRelease: false`;
- the ownership state (`held`, `principal_terminal`, `released` or `unknown`).

| Evidence | State | Ownership | Watcher may |
|---|---|---|---|
| Claim or session rows unreadable, principal agent unknown, or claim held by another agent | unknown | unknown or held | observe, escalate |
| Fresh observed or attested capacity evidence of a spent window, `usage_limited` or `budget_limited` (its `real` or `simulated` mode is shown in the evidence) | exhausted | unchanged | offer help, escalate (if held) |
| No active claim | idle | released | continue released work |
| Claim held; managed Session terminal and reconciled on this candidate | idle | principal_terminal | continue released work |
| Claim held; latest counted activity within `activityFreshMs` | healthy | held | observe |
| Claim held; latest counted activity within `stallAfterMs` | idle | held | offer help |
| Claim held; nothing counted within `stallAfterMs` on any channel; some channel unreadable | unknown | held | escalate |
| Claim held; nothing counted within `stallAfterMs`; every channel read | stalled | held | offer help, escalate |

**Exhausted** requires all of these:

- capacity evidence for the owner's own provider;
- freshness `fresh`, observed within `capacityFreshMs`;
- not `none` or unmetered configuration;
- a window that has not reset since.

Stale or unknown capacity never shows exhaustion.

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

Continuing goes only through existing recovery. The watcher presents a
takeover request (`arcadia-peer-takeover-request-v1`) carrying:

- the observed evidence references;
- the claim generation and branch;
- the basis: `claim_released` or `principal_proven_terminal`;
- the terminal Session id;
- the existing command it relies on.

Revalidate the request against a fresh classification immediately before
acting. The claim generation is the fence.

| Basis | Existing recovery |
|---|---|
| No active claim (settled or released) | `arcadia go --agent <agent>` dispatches the Action with a fresh claim |
| Managed Session terminal and reconciled | `arcadia go --agent <agent>` resumes the same candidate (Decision 0051) |
| Session exited, not reconciled | Escalate. The operator judges and may run `arcadia session reconcile <session-id>` |
| Native or prepared principal with no Session row | Escalate. Only the owner's or its orchestrator's explicit release, plus a handoff receipt, hands it over |

A watcher never does any of these:

- clears a lease, releases a claim or expires one by elapsed time;
- edits another owner's candidate;
- resets history or duplicates a candidate;
- treats a helper prompt, momentum or liveness inference as ownership or
  approval.

---
arcadia: v1
type: decision
id: "0022"
slug: instance-coordination-boundary
project: arcadia
status: open
question: Does an Arcadia installation ever coordinate directly with another Arcadia installation, or is a git repository the only channel through which two instances ever affect each other?
gap_type: missing-decision
recommendation: Git is the only channel. Two Arcadia installations never talk to each other, and never read or write each other's workspace. Coordination that genuinely needs mutual exclusion may use committed records in the repository they both read, because that is still git. Reject a hosted Arcadia that other installations call.
confidence: medium
updated: 2026-08-17
---

# The coordination boundary between Arcadia installations

## Context

Arcadia is local-first, and until now that has been indistinguishable from
single-machine. One operator, one workspace, local clones of every managed
repository. Nothing in the design had to say whether a second installation
could exist, because there was never a second one.

Two pressures make the question concrete.

Coding agents commonly run in cloud containers. A container clones one
repository and has no workspace, no database, and no Arcadia checkout. It is
not a second installation — but it is a second *actor*, and the question of how
it reaches the operator's Arcadia is the same question in miniature.

And if adoption grows past one person, there are genuinely multiple
installations: several operators, each with their own workspace, reading and
writing an overlapping set of repositories.

This Decision does not settle how work is distributed, how the pointer is
stored, or what gets published as a package. It settles one thing that all of
those depend on: **whether an instance may ever depend on another instance
being reachable.**

## Why this is upstream of everything else

The answer determines the solution space for problems not yet solved.

If instances may coordinate directly, mutual exclusion can be a lease held by a
service, presence can be a heartbeat, and cross-project state can be shared
live. If they may not, every one of those has to be expressed as a file in a
repository or not exist at all.

Deciding the pointer's storage model, or a package boundary, before this is
answered means picking a mechanism without knowing which mechanisms are
permitted.

## The options

### A. Git only, never instance-to-instance

Two installations affect each other exclusively by committing to repositories
both can read. No instance opens a socket to another. No instance reads
another's workspace database. Each workspace is private, derived, and
disposable.

This is the strict reading of local-first, and it is very close to what already
exists. It means a cloud agent is not a client of the operator's Arcadia at
all — it clones, reads documents, works, commits, opens a pull request. The
operator's Arcadia learns by syncing the repository afterwards.

**Cost:** anything requiring live agreement between two actors is unavailable.
Mutual exclusion becomes eventually-consistent at best. Telemetry generated in
a container reaches the operator only if it is committed, or is lost.

### B. Git only, but the repository may carry coordination records

Same rule, with one thing made explicit: a committed file is a legitimate
coordination medium. A claim, a lease, a "this action is being worked by X
since T" record can live in the repository, and git's own conflict detection is
the concurrency primitive.

This does not weaken local-first — there is still no server of record and no
instance-to-instance call. It weakens *simplicity*, because a committed lease
has no expiry unless something revokes it, and a crashed agent leaves a claim
nobody clears.

### C. A hosted Arcadia other installations call

One instance, or a service, holds authoritative shared state. Others query it.

This makes live coordination easy and everything else hard. It requires
hosting, authentication, availability, and a migration story, and it makes one
party's uptime a dependency of everyone else's ability to work. It also
contradicts the Constitution's rule that checked-in managed documentation is
authoritative for governed work — a live service that agents consult becomes a
competing truth store the moment it holds anything the documents do not.

## Recommendation

**A as the standing rule, with B available and B's cost stated wherever it is
used. Reject C.**

The reasoning is that git already is the distributed state mechanism, and
Arcadia's authoritative tier already lives in it. Every governed document is
versioned, replicated to every clone, and conflict-detected on write. Adding a
coordination channel beside it would introduce a second way for two actors to
disagree, and the Constitution already says which one wins.

C is rejected on values rather than difficulty. An Arcadia that requires someone
else's server to be up is not the tool this repository set out to build.

Confidence is `medium` rather than `high` on the A/B line specifically. Whether
committed coordination records are ever actually needed depends on the pointer
question in Decision 0023, and if that Decision concludes that one dispatched
agent per repository is sufficient, B may never be exercised.

## What approval would settle

- A cloud agent is never a client of an Arcadia installation. It is a reader of
  repositories and an author of pull requests.
- No feature may assume another installation is reachable.
- Workspace databases are private and derived. No installation reads another's.
- Coordination requiring mutual exclusion, if it is ever needed, is expressed as
  committed records in the shared repository, and must state how a stale record
  is cleared.

## Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Reconsider a shared service | Two operators independently report that repository-mediated coordination lost work, with the incident recorded. |
| Telemetry from containers | The dispatch journal's gaps change a decision the operator would otherwise have made differently. |

## What this Decision does not authorize

- It does not decide how `current_action` is stored or whether parallel dispatch
  is allowed. That is Decision 0023, which depends on this one.
- It does not decide what Arcadia publishes as a package.
- It does not authorize any code change. Approval is the gate.

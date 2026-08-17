---
arcadia: v1
type: decision
id: "0024"
slug: way-propagation-tiers-and-push-authority
project: arcadia
plan: arcadia-way-propagation
action: open-way-sync-pull-requests
status: approved
question: Which tiers of Way change may propagate automatically, and does Arcadia's CI get push access to every project repository to do it?
gap_type: missing-decision
recommendation: >-
  Split Way changes into a mechanical tier and a governing tier. Mechanical
  changes -- generated marker regions and generated context files -- may
  propagate and merge without review. Governing changes -- the Constitution and
  the continuation protocol -- always open a pull request a human merges.
  Arcadia gets write access scoped to the mechanical tier's paths only.
confidence: medium
decided: 2026-08-17
answer: >-
  Answered by the operator on 2026-08-17 via the decision menu: auto-merge the
  mechanical tiers. Generated regions and generated context files may propagate
  and merge automatically; Constitution and continuation-protocol changes
  require review and merge by a human in each adopting repository. This grants
  Arcadia write authority over other repositories for the first time, which is
  the part of this answer to be most careful about, so the authority is scoped
  rather than general -- see the guardrails below, which are part of the answer
  and not commentary on it. This unblocks `open-way-sync-pull-requests`, whose
  clarification was `question_open` on this question alone. It does not itself
  provision any credential.
updated: 2026-08-17
---

# Way propagation tiers and push authority

## Context

`arcadia project setup-context` regenerates managed regions in an adopting
repository, and `arcadia way` reports which repositories have drifted. Neither
delivers a change: propagation has been manual, which is workable at three
repositories and is exactly what breaks as adoption grows.

The Action `open-way-sync-pull-requests` has been blocked since 2026-08-16 on
one question, recorded as `propagation-authority` on the
`arcadia-way-propagation` plan. It is the only thing that Action was waiting
for.

Decision 0021 deferred this rather than answering it, and named the tiering
problem without resolving it. This Decision resolves it.

## The two tiers

**Mechanical.** Content Arcadia generates and can regenerate byte-for-byte from
canonical sources: the `AGENTS.md` marker region, `.arcadia/` context files, the
`CLAUDE.md` thin wrapper. A project never authors these. Drift in them is
always staleness, never intent, and `arcadia way` already detects it by
regenerating and comparing bytes.

Reviewing a mechanical change is theatre — the reviewer's only real options are
to accept it or to be stale. Auto-merge is honest about that.

**Governing.** The Constitution and the continuation protocol. These change what
agents are permitted to do. A maintainer editing one file and having it merge
into every adopting repository unreviewed is a governance change nobody
consented to, which is precisely the failure Decision 0021 was written to avoid.
These always open a pull request a human merges.

## Guardrails, which are part of the answer

The operator chose automatic merging for the mechanical tier. That is only safe
with the scope stated, so these bind the implementation:

- **Path-scoped write access.** Arcadia's automated credential may write only
  the mechanical tier's paths. It never has blanket push access to an adopting
  repository.
- **Never outside the marked region.** Already true of `setup-context` and
  restated here as a propagation invariant, because auto-merge removes the human
  who would have caught a violation.
- **Never to a default branch directly.** Auto-merge means opening a pull
  request and merging it, so the change is reviewable after the fact and
  revertable as one commit. It does not mean pushing to `main`.
- **A no-op propagates nothing.** A run that would produce an identical file
  opens nothing, so auto-merge cannot generate pull-request noise.
- **One pull request per repository**, never a merge across repositories, per
  Decision 0021.
- **Governing-tier changes in a mechanical run abort it.** If a propagation run
  finds it would touch both tiers, it opens a reviewable pull request for the
  whole change rather than splitting it and merging half.

## Consequences

- `open-way-sync-pull-requests` becomes clarified and can be worked.
- Adoption can grow past the number of repositories the operator can update by
  hand, which is the point.
- Arcadia gains write authority over other repositories, scoped to generated
  paths. This is a real expansion of what Arcadia may do without asking, and it
  is the thing to audit first if propagation ever misbehaves.
- A project that wants to opt out needs a way to say so; `adoption.json`'s
  `upgrade_policy` is the existing field for it, and honouring it is part of the
  implementing Action rather than assumed here.

## Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Narrow or revoke automatic merging | A propagated mechanical change breaks an adopting repository, or lands content a project considers its own. |
| Constitution version pinning and drift reporting | Deferred in Decision 0021; still deferred, and now more likely to matter because propagation becomes routine. |

## What this Decision does not authorize

- It does not provision a credential or configure CI. Both are implementation,
  gated on the operator.
- It does not authorize merging a governing-tier change anywhere.
- It does not decide what Arcadia publishes as a package, or how an adopting
  repository pins a version of the Way.

---
title: "Why unattended production kept receding"
date: "2026-10-31"
type: essay
slug: "why-unattended-production-kept-receding"
summary: "Arcadia has not yet run production unattended on its own repository. The evidence points to structure, not effort: the continuation pointer left the goal, the goal split between two engines, every fix needs a chain of separate approvals, Claude sign-in is a host-only wall, and records outgrew priority. Five small changes, each with a test, are proposed."
author: "Arcadia (drafted by Clara, Technical Writer, as Claudia Atlas <claudia.atlas@agents.arcadia.local>; commissioned by Mira, release investigator)"
status: draft
claims_receipt: "inline links in this article"
not_done: true
channels: [field-notes]
---

# Why unattended production kept receding

2026-10-31 · Arcadia Field Notes · **Status: draft for operator review**

The goal since mid-October has been one sentence: Arcadia runs production
unattended on its own repository, on the Claude provider, with operator touches
limited to authority-adjacent merges
([goal Plan](../plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md)).
It has not happened yet. Production is Off, and that Plan's status is now
`draft`. This note explains why, using the repository's own records, and
proposes five small changes. It assigns no blame: agents and the operator did
a great deal of careful work. The problem is where that work was pointed.

Claims marked **inference** are interpretation, not observation.

## What happened

### 1. The machine's own pointer left the goal

`PROJECT.md` holds `active_plan` and `current_action`. AGENTS.md tells every
fresh session to resume from them. Between 2026-10-12 and 2026-10-29,
`active_plan` changed 11 times (`git log -p -- PROJECT.md`). The goal Plan
gained the pointer three times
([69e686dea](https://github.com/pmark/arcadia/commit/69e686dea),
[d0210d7f4](https://github.com/pmark/arcadia/commit/d0210d7f4),
[e25781795](https://github.com/pmark/arcadia/commit/e25781795)) and lost it
three times. The last loss was
[51124acfe](https://github.com/pmark/arcadia/commit/51124acfe) on 10-27. Two
more moves the same day led to the Go integration Plan
([d404ccfad](https://github.com/pmark/arcadia/commit/d404ccfad)). On 10-29,
[06a2cf802](https://github.com/pmark/arcadia/commit/06a2cf802) moved it to
`bootstrap-managed-production-to-build-flight-deck`, where it
[still is](../../PROJECT.md).

**Inference:** sessions did what they were told. They followed the pointer.
From outside, that looked like drift.

### 2. One goal, two engines

The [readiness checklist](../managed-production-readiness.md) measures the
goal through `first-unattended-run`: three worker-driven jobs delivered with
only allowed touches. On 10-27,
[PR #1821](https://github.com/pmark/arcadia/pull/1821) made Go integration the
critical path on the operator's direct instruction. Then
[Decision 0145](../decisions/0145-decide-how-far-one-operator-approval-in-the-go-workspace-may-carry-agent-work.md)
set how far one Go approval carries work. Both are reasonable. But the
checklist's header still names a different "current coordination Plan"
(`unify-interactive-and-unattended-coordination-with-safe-concurrent-actions`)
than `PROJECT.md` does. The two engines do not name the same Plan.

### 3. The product is its own toolchain

The checklist records live runs on 10-11, 10-17/18, 10-19, 10-20 and 10-26.
The 10-20 run merged 3 of 3 Actions, but did not pass acceptance. One Action
was finished by hand, two candidates were hand-repaired, and the run logged
ten failure rows, a to j
([§2026-10-20](../managed-production-readiness.md#historical-answer-2026-10-20-not-yet-proven-unattended-all-three-actions-of-the-second-unattended-claude-run-reached-merged-prs-but-through-many-non-allowed-touches)).
The acceptance record credits one of three jobs:
[PR #1779](https://github.com/pmark/arcadia/pull/1779). A second candidate,
[PR #1787](https://github.com/pmark/arcadia/pull/1787), was merged on 10-27,
after the checklist's last refresh. The checklist still lists it as held.

Of 287 PRs opened since 10-14, 21 have titles beginning "Candidate:". That is
the worker's naming for a Session-produced candidate.

Every fix to the worker must pass the same chain: merge, adopt into the main
checkout, install the broker, load the worker, then START. Each step is
approved separately. The
[10-31 continuation report](../reports/go-1921-claude-continuation-2026-10-31.md)
shows the chain stalled after merge. At 05:35 UTC on 10-31, PR #1921 was in
source, but not installed or loaded. Later that day, the operator approved one
reviewed one-shot action. It reloaded the broker and the worker at
`24c4ee020`, which includes #1921
([handoff in PR #1927](https://github.com/pmark/arcadia/pull/1927)).

### 4. A host-only credential wall

Of the 26 Decisions numbered 0130 to 0155 (added 10-17 to 10-30), nine are
about Claude sign-in or capacity:
[0130](../decisions/0130-decide-whether-the-production-worker-may-read-this-host-s-claude-code-sign-in.md),
[0131](../decisions/0131-decide-how-the-production-worker-keeps-this-host-s-claude-sign-in-usable.md)
and
[0137](../decisions/0137-authorize-one-fixed-worker-claude-usage-diagnostic.md)
to
[0143](../decisions/0143-record-already-given-standing-approval-for-bounded-small-usage-claude-renewal.md).
On 10-26 the renewal returned "Not logged in". Its attempt stays consumed
([Decision 0144](../decisions/0144-choose-whether-to-deliver-three-useful-arcadia-source-actions-through-the.md)).
Even the standing daily allowance can't be used safely. No authoritative
daily ledger shows whether the day's attempt was already spent
([checklist](../managed-production-readiness.md)). Decision 0144 approved
useful side work through Codex while Claude was blocked. Nothing in it
returned the pointer to the goal afterward. Production has stayed Off since.
It was last observed on 10-31 at revision 83, epoch 46, with zero admissions
([10-31 report](../reports/go-1921-claude-continuation-2026-10-31.md)).

### 5. Records outweigh priority

Since 10-13 these sizes grew (compared with commit `c256ee207`, dated 10-13):

- The readiness checklist grew from 61 KB to 133 KB.
- `docs/agent-guidance/` grew from 183 KB to 253 KB.
- Checked-in skill sources grew from 7 to 14.

68 of the 258 PRs merged from 10-14 to 10-31 have record-type titles. That is
a heuristic: a case-insensitive match on "settle", "record", "decision",
"receipt", "handoff", "readiness" or "preserve". All seven newest
Decisions,
[0149](../decisions/0149-how-far-should-arcadia-automate-persona-identity-in-generated-identity-text.md)
to
[0155](../decisions/0155-what-should-arcadia-promise-about-the-quality-of-design-advice.md),
are open. They ask about naming, roles and design help. None is about the goal.
[AGENTS.md](../../AGENTS.md) has 17 lines containing "never" or "must", and one
line about momentum.

**Inference:** this much guidance dilutes priority. A fresh session learns many
ways to stop, but little about what matters most.

### 6. Handoffs carry custody, not priority

Since 10-14, 46 commit messages mention "handoff" (a keyword count). Handoffs
carefully preserve custody, pins and cautions. The shared
[handoff skill](../../.agents/skills/arcadia-handoff/SKILL.md) never mentions
the goal, the milestone, priority or the critical path.

## What is not done

- **Unattended production.** Production is still Off. `first-unattended-run`
  is not accepted.
- **The proposed changes.** None of the five changes below is built yet.
- **The Go probe's recovery is parked.** PR #1921 is merged, and on 10-31 the
  worker was reloaded with it at `24c4ee020`. That revision is inferred from
  the worker's start time. The worker has not been reloaded at `1ac59bd`
  (#1926, the failed-successor disposition fix). The probe's recovery is not
  done ([handoff in PR #1927](https://github.com/pmark/arcadia/pull/1927)).

Still unknown:

- **Why Go on 10-27.** PR #1821 quotes the operator's instruction, but not the
  reason. One likely reason is that Go was the only route still moving while
  Claude was blocked. That is **unconfirmed**.
- **Whether PR #1787 counts toward acceptance.** The record has not been
  refreshed since it merged.
- **Whether the guidance bulk caused delay**, or only came along with it. We
  have no controlled comparison.
- **The PR categories.** These counts come from title and branch patterns,
  not from labels.

## What changes next

These are proposals for the operator to decide. Each has a test.

1. **Bind the goal.** Check in the north-star Plan. Moving the pointer off it
   requires a Decision with a stated return trigger.
   *Test:* a pointer change without a linked Decision fails a check.
2. **One goal, one engine.** Make one Decision on what "one-click Plan
   continuation" means, worker run or Go.
   *Test:* the checklist and `PROJECT.md` name the same Plan.
3. **One approval per adoption.** A single Off-only action merges, installs,
   loads and verifies.
   *Test:* after one press, the installed and loaded revisions equal the
   merged SHA, with no second approval.
4. **Take the host out of credential renewal.** Use standing renewal, a remote
   one-tap fallback and a real daily ledger.
   *Test:* a failed renewal is visible and recoverable without anyone at the
   host. The ledger answers "was today's attempt used?"
5. **Cap the readiness document.** Keep about 8 KB of current state and
   archive the history. Every PR and handoff states "gate moved: X" or "gate
   moved: none".
   *Test:* a size check, and a PR template field.

Nothing in this note changes authority. Production stays Off until a separate
START approval.

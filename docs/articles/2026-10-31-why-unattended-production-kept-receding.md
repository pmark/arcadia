---
title: "22 days to three merges: what stalled our unattended coding agent, and what we could not prove"
date: "2026-11-17"
type: essay
slug: "why-unattended-production-kept-receding"
summary: "Our unattended coding agent took 22 days to deliver three reviewed changes. By our reading, the failure record points mostly at faults in our own tooling; we could not show that task-pointer moves or guidance size caused the delay."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "Decide whether to approve one controlled comparison: the same three test-only changes run once with today's guidance and once with only the always-loaded set, recording time to merge."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/why-unattended-production-kept-receding.md"
canonical: "https://pmark.github.io/arcadia/posts/why-unattended-production-kept-receding/"
channels: [site, rss]
tags: [automation, reliability]
last_modified_at: "2026-11-17"
featured: true
---

# 22 days to three merges: what stalled our unattended coding agent, and what we could not prove

On 14 October 2026 we set a goal: an unattended coding agent that delivers reviewed changes to our own repository, with no human help beyond starting the run and approving sensitive merges. On 5 November it delivered three, 22 days later. By our reading, most of the failures recorded in between were faults in our own tooling, not in the agent's code. We suspected that a drifting pointer to the current task and growing written guidance also slowed us; we could not show it.

Checked 2026-11-17 at commit `4c2cb0ee3`; sizes are in bytes.

## The outcome

On 5 November the runner merged three pull requests: #2124, #2125 and #2126, at 22:13:40Z, 22:30:42Z and 22:45:55Z. Each passed an independent code review and a QA check on the first round. The only human action during the run was pressing the start button.

On 8 and 9 November the same setup merged 20 pull requests in five batches of 5, 3, 5, 5 and 2, with merge times from 19:58:54Z on 8 November (#2308) to 07:19:46Z on 9 November (#2351). One batch stopped at three merges because a QA plan read a quoted test path as a changed file. Fix #2325 merged at 23:52:39Z on 8 November, and the next batch resumed.

All of this is test-only work, one change at a time, with main frozen during each batch.

## What the earlier tries recorded

Our readiness record, the checked-in checklist of what remains before unattended production is accepted, lists failure rows a to i (plus a catch-all row j) for the 20 October run. That run merged 3 of 3 changes but did not count: one was finished by hand, two were repaired by hand, and the operator stopped and restarted the run. By our reading, eight rows were faults in our own harness, and the ninth was agent-written code that the worker's own review caught. One further agent-side failure is not among those nine rows: the first change an agent produced for the first task (#1601) was closed as a false fix. So the harness share is a count of table rows, not of every failure. Examples:

- A validator with a 900-second bound refused criteria naming a test file that took 627 seconds alone.
- A usage parser read a 1% usage window as 100% spent.
- Sessions could not run the test the task named.
- The code reviewer counted files the system writes itself against a "touches only the test file" criterion.
- The ninth row: the agent changed a comparison from `IS NOT` to `!= null` and regressed a gate.

Attempts 1 and 2 on 4 and 5 November added further faults, including these three. A reviewer failed three pull requests on records written by the host that no repair session could change. A GitHub outage lost one CI event. The worker hung for 63 minutes on an unbounded capture reader. The grouping of failures into harness and agent is our reading, not an independent audit.

In its 20 October entry the record also states that repairing a candidate touching a gated path under `src/production` is never unattended, by design. The 20 October run included such a change (#1635). The 5 November run, and attempt 1, used test-only changes.

## Pointer moves and guidance size

The pointer is the `active_plan` field in `PROJECT.md`, which tells a new session which plan to resume. It changed 11 times between 12 and 29 October, per git history, twice more on 31 October and 5 November, and 15 more times between 6 and 15 November, but not during the 20 merges of 8–9 November, so those merges neither support nor weaken the pointer idea.

| Date | Readiness record | `docs/agent-guidance` |
| --- | --- | --- |
| 13 Oct (`c256ee207`) | 61,173 | 182,601 (21 files) |
| 31 Oct (`e934c2c57`) | 133,508 | 253,385 (29 files) |
| 5 Nov (`2c7c89485`) | 156,524 | 270,562 (30 files) |
| 17 Nov (`4c2cb0ee3`) | 159,151 | 368,418 (39 files) |

`AGENTS.md` caps what loads by default: 12 KiB for the root file (now 11,165 bytes) and 24 KiB for default-loading guidance; procedures are retrieved on demand. The caps do not show where the growth is: default-loading guidance can grow while staying under its 24 KiB cap, and we did not measure what loads or what agents retrieve. The guidance directory kept growing after the run worked: 253,385 bytes on 31 October, 270,562 on 5 November (the run), 319,840 when the 8–9 November merges began and 321,889 when they ended. That weakens the idea that its size blocked merges.

## What you can take from this

This is our proposed lesson, not a measured result.

1. Keep a failure ledger that tags each row "agent" or "harness". In our 20 October record that tag puts 8 of the 9 table rows on the harness.
2. Prove the narrowest scope first, as the 5 November run did: one test file per change, one change at a time, main frozen.
3. Before blaming documents or pointers, run one controlled comparison: the same three test-only changes once with today's guidance and once with only the always-loaded set, recording time to merge.

## What is not done

- **Cause not proved.** No comparison shows that pointer moves or guidance size delayed the run. This is inference.
- **Scope.** Only test-only, serial, frozen-main work is proved; source, concurrent and moving-main work is not. PR #2468, merged 10 November, lets the runner merge unclassified source changes; we did not look for a run record that used it.
- **Current state not re-read.** The 9 November record says production was Off at revision 123, epoch 66.

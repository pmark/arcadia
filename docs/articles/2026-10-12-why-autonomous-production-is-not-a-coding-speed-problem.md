---
title: "Where an unattended coding agent's time went: at most 2 minutes 1 second building, 11 to 15 minutes to a review pass"
date: 2026-11-09
type: essay
slug: "why-autonomous-production-is-not-a-coding-speed-problem"
summary: "In one unattended run, three small test-only changes each took at most 2 minutes 1 second to build, then 11 to 15 minutes to reach a review pass."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "Record six timestamps per change (build end, push complete, checks started, checks finished, review started, review verdict) in the next run, so the 11 to 15 minute interval can be split."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/why-autonomous-production-is-not-a-coding-speed-problem.md"
canonical: "https://pmark.github.io/arcadia/posts/why-autonomous-production-is-not-a-coding-speed-problem/"
channels: [site, rss]
tags: [automation, review, reliability]
last_modified_at: "2026-11-17"
featured: true
---

# Where an unattended coding agent's time went: at most 2 minutes 1 second building, 11 to 15 minutes to a review pass

🔎 **Checked.** On 5 November 2026 we ran an AI coding agent unattended on our own repository: one operator button press started it and the record shows no other operator touch. It made three small changes, one after another, and each change touched one test file. The agent's build session lasted 35 seconds to 2 minutes 1 second. After each session ended, 11 minutes 34 seconds to 14 minutes 54 seconds passed before a code review passed. That was the longest interval we measured.

❓ **Main limit.** That interval is a bundle. It includes the supervising program's own steps after the session (settle its records, push the branch, mark the pull request ready) and the review itself. It may also include time spent waiting for automated checks. The record does not separate these. So the honest claim is "the longest measured interval", not "review is the slowest part". The run was also three test-only changes with the main branch frozen, so it says nothing about larger changes.

## The measurements

All times are UTC on 5 November 2026. The lengths and intervals are my subtraction from the recorded timestamps; the timestamps are from the run record. The independent fact-check reports that it did not re-check the review and QA times against GitHub or the host database, and that it did confirm the session lengths and merge times against the ledger and GitHub.

| Change | Build session | Session length | Session end to review pass | Review pass to QA pass | Merged |
| --- | --- | --- | --- | --- | --- |
| PR #2124 | 21:55:51 to 21:57:23 | 1 min 32 s | 14 min 54 s (22:12:17) | 1 min 16 s (22:13:33) | 22:13:40 |
| PR #2125 | 22:15:11 to 22:17:12 | 2 min 1 s | 12 min 4 s (22:29:16) | 1 min 21 s (22:30:37) | 22:30:42 |
| PR #2126 | 22:32:05 to 22:32:40 | 35 s | 11 min 34 s (22:44:14) | 1 min 35 s (22:45:49) | 22:45:55 |

QA is the second check the record lists after code review. The record says activation to scope complete took 52 minutes. The three build sessions together lasted 4 minutes 8 seconds of that. All three build sessions are labelled "haiku" in the record. Each change touched one test file, with 23 to 46 changed lines including settlement records.

Each change was merged by the supervising program after the review and QA passed. A person pressed one approval card to start the run, and the record says that was the only operator touch. The record's row for the second change reads "refused" although GitHub merged it; the record says the row misreports a merge that landed. The merge time above is the one the record shows.

## What the record does not tell us

The record says reviewer tokens and wall time "are not recorded per verdict". Its table does not show when review started or when automated checks finished. Its own summary reads "Review and QA took 11 to 15 minutes per Action". My subtraction reproduces that range only for session end to review pass, so I used that measure. Adding the QA step gives 13 minutes 9 seconds to 16 minutes 10 seconds. I did not use that range because the record does not say when QA started.

## A stop that faster building would not fix

On 8 and 9 November the same kind of test-only work continued: 20 more changes merged, in five batches. The second batch stopped after three merges. The cause was the generated QA checklist. It read a path quoted as example input in an acceptance criterion as a file the change had to touch. The host program generates that checklist. Issue #2324 says no model wrote that checklist, so a repair session could not change it. The fix, PR #2325, changed one source file (the checklist generator) and two test files. 📐 My inference: a faster build step would have stopped in the same place.

## How to measure your own pipeline

Time each stage separately: build, push, automated checks, review, a second check, merge. Look at the longest interval first. If your record has no timestamps inside the interval after the build session ends, as ours did not, you can find a bundle like this one but not what is inside it.

👉 **Try this.** Record six timestamps per change in your next run: build end, push complete, checks started, checks finished, review started, review verdict. Then split your own interval before you buy a faster model.

## What is not done

- ❓ Not proved: how the 11 to 15 minutes divide between pushing, automated checks and review.
- ❓ Not proved: that a faster or slower build model would change the picture. All three build sessions used the same model.
- ❓ Not proved: anything about source changes, concurrent work, a moving main branch or a repair loop. The record lists these as not proved.
- ❓ Not checked: reviewer cost in tokens or time per verdict. The record says it is not measured.

[Run record](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/docs/managed-production-readiness.md#run-record-attempt-3-card-start-run-unattended-20261105d) · [Issue #2324](https://github.com/pmark/arcadia/issues/2324) · [PR #2325](https://github.com/pmark/arcadia/pull/2325) · [Claims receipt](receipts/why-autonomous-production-is-not-a-coding-speed-problem.md)

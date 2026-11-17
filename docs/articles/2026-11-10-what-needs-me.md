---
title: "When 'nothing needs you' sits beside a failed read: complete, partial or unknown"
date: "2026-11-10"
type: essay
slug: "what-needs-me"
summary: "In an offline test of our own dashboard, an all-clear appeared next to a warning that a data source could not be read; this note shows the result and a three-line status pattern."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "Open a change that makes the to-do list page show 'unknown' and a Retry button whenever a source warning is present, then re-create the eight test cases in the repository and run them against it."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/what-needs-me.md"
canonical: "https://pmark.github.io/arcadia/posts/what-needs-me/"
channels: [site, rss]
tags: [agent-workflows, evals, interface-design]
last_modified_at: "2026-11-17"
featured: true
---

# When "nothing needs you" sits beside a failed read: complete, partial or unknown

🔎 Checked: in one offline test of our own dashboard, the to-do page showed "Nothing is waiting on you." beside a warning that a data source could not be read. ❓ Our view, not tested: an all-clear is only trustworthy when the read behind it was complete.

The main limit comes first. The test used eight made-up cases, not real traffic. The comparison screen was a mock that was hand-written for the test and is not product code. No person used either screen. Treat the numbers below as a small designed check, not a benchmark. The scores come from our own receipt, the frozen test files are not in the repository, and the mock's 8 of 8 shows only what a design can do.

We tested a dashboard, not an AI agent. ❓ Our view, not tested: the same three states (complete, partial, unknown) may apply to agent summaries too.

## What we ran

We rendered the checked-in to-do page component offline with eight made-up cases and graded its first screen, and separately the screen with item details opened. The same cases were given to the mock. The receipt records that the fixtures and answer key were frozen before rendering and that a separate, deterministic grader scored the result; we could not check this because those files are not in the repository. Two checks were used:

- **Basic:** the screen gives the correct overall status and a supported safe next step.
- **Strict:** the basic check, plus the source and freshness of the read are visible on that screen. Any unsafe cue fails the case.

| Screen | Basic check | Strict check |
| --- | --- | --- |
| Current page, first screen | 5 of 8 | 0 of 8 |
| Current page, after opening item details | not reported | 3 of 8 |
| Hand-written mock | 8 of 8 | 8 of 8 |

The three cases where the current page failed even the basic check were:

1. An empty result with one source missing. The page showed the source warning beside the all-clear.
2. A failed refresh with an older blocking item still on screen. The page showed an enabled Approve control beside the refresh error. No control was clicked.
3. A request scoped to one project while a row from another project was present (the receipt notes the current portfolio list is intentionally global, so this may be a design choice, not a defect).

## Why the contradiction can happen

This part is readable in the code, apart from the experiment. The list page shows "Nothing is waiting on you." when it has zero live items and no error (`apps/dashboard/components/todo-views.tsx:88`). A missing source is reported as a separate note. The server adds that note when a source could not be read (`apps/dashboard/lib/approvals.ts:376`), and the page prints it above the list (`todo-views.tsx:36,83`). The all-clear condition does not look at the note, so both can appear together.

A failed refresh keeps the previous list: the failure handler sets an error and does not replace the items (`apps/dashboard/hooks/use-approvals.ts:92-96`).

One page already shows an unknown state with retry, like the mock described in the receipt. On the single-item page, an item found in the list shows its card. An item absent from the list shows "State unknown" and, when the page supplies a retry handler, a Retry button, if the read failed, carried a note about a source or about settle controls, or was the fallback list. It shows "Done" only when the last poll succeeded, every source was read, and the list was not the fallback list (`todo-views.tsx:139-188`). The eight cases did not test that page, and we did not run it. We only read its code.

## A three-line pattern you can copy

📐 Proposed, not built, and not tested in the form below. Attach this to any answer that says "nothing needs you":

```
status: complete | partial | unknown
checked: <source> ok | failed | skipped, read at <time>   (one per source)
fresh_as_of: <time of the oldest successful read>
```

Three rules go with it:

- Print an all-clear only when `status` is `complete`.
- When `status` is `partial`, list the sources that failed, show what was found so far, and do not call the result empty.
- When `status` is `unknown`, say so and offer a retry. Do not leave the last known list on screen without saying how old it is.

Put the three fields on the first screen. In our test, the strict check passed 3 of 8 cases only after item details were opened, and 0 of 8 on the first screen.

## What is not done

- ❓ The eight cases are fabricated. There was no live system, browser session, model call or approval-endpoint test.
- ❓ The receipt records the mock as "hand-authored". The receipt does not say who wrote the mock, and the mock has not been shipped.
- ❓ The frozen fixtures and the results file are not in the repository. The scores trace only to the table in the receipt, which this rewrite did not re-run.
- ❓ We did not click the Approve control or test what a server would allow.
- ❓ The three-line pattern has not been built or tested. We do not know it would score 8 of 8.

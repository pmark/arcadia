# Field Notes evidence: what-needs-me

- Status: this is the publication receipt for the article above (status approved). Notes below written while drafting may say draft; the reviews are recorded under Independent review and Editorial review.

- Evidence read on `origin/main` at commit `4c2cb0ee3` (fetched 2026-11-17). `todo-views.tsx` and `use-approvals.ts` have no diff between `c2859d022fe9ce165b827153491f7bf29a98473f` (the revision the original receipt pinned) and `origin/main`. `approvals.ts` was read at `origin/main` only.
- Short names: RCPT = `docs/articles/receipts/what-needs-me.md`; TV = `apps/dashboard/components/todo-views.tsx`; AP = `apps/dashboard/lib/approvals.ts`; UA = `apps/dashboard/hooks/use-approvals.ts`. All paths are on `origin/main`.
- Important limit: the frozen fixtures, the answer key and `results.json` are not in the repository. Every score in the article traces only to the table in RCPT. I recounted that table (see N1; it is in the earlier receipt at https://github.com/pmark/arcadia/blob/4c2cb0ee3/docs/articles/receipts/what-needs-me.md, which this receipt replaces) but could not re-run the grader.

## Claims and evidence

| ID | Exact factual sentence in the article | Evidence (file:line or PR) | What it proves and its limits |
| --- | --- | --- | --- |
| A1 | "🔎 Checked: in one offline test of our own dashboard, the to-do page showed 'Nothing is waiting on you.' beside a warning that a data source could not be read." | RCPT:34 (case "Empty result; one source missing": "Current view shows source warning beside an all-clear"); RCPT:42 (offline server-render of the actual component); TV:88 (text "Nothing is waiting on you."); TV:36, TV:83 (note rendered above the list). | Observation from a synthetic fixture, recorded in the receipt table. The code path is readable at TV:36,83,88. Not live-user evidence. The all-clear text in the article matches TV:88 exactly. |
| A2 | "❓ Our view, not tested: an all-clear is only trustworthy when the read behind it was complete." | Argument, not a measurement. Supported in part by TV:156-159 (code comment stating "Done" is only true when the list is known complete). | Claim of reasoning. The code comment shows the team applies this rule to one page; it does not prove the rule for other systems. Now labelled as an untested view (not under the Checked label); the Checked label covers only the A1 observation. |
| B1 | "The test used eight made-up cases, not real traffic." | RCPT:23 (heading "Eight synthetic cases"); RCPT:29-36 (eight rows); RCPT:42 ("No people, live systems..."). | Eight rows are present and called synthetic. "Not real traffic" follows from RCPT:42 (no people or live systems) and the heading "synthetic" at RCPT:23. |
| B2 | "The comparison screen was a mock that was hand-written for the test and is not product code." | RCPT:15 (C2: "The mock was not product code"); RCPT:42 ("hand-authored read-only mock"). | Both phrases are in the receipt. Who wrote the mock is not recorded beyond "hand-authored". |
| B3 | "No person used either screen." | RCPT:42 ("No people, live systems, browser session, routing, model calls, or approval endpoint were involved."). | Receipt statement; not independently re-checked. |
| B4 | "Treat the numbers below as a small designed check, not a benchmark." | RCPT:15 ("results are not a benchmark"). | Instruction to the reader, supported by the receipt's own limit. |
| C1 | "We rendered the checked-in to-do page component offline with eight made-up cases and graded its first screen, and separately the screen with item details opened." | RCPT:42 ("offline server-render of the actual component"); RCPT:25 ("'Details' is a separate view variant"); RCPT:27-36 (column "Current with details full"). | The receipt says the actual checked-in component was server-rendered. The name of the component (`TodoListView`) is taken from RCPT:17/RCPT:14 links; the article does not print it in this sentence. Not re-run. |
| C2 | "The same cases were given to the mock." | RCPT:25 ("the same fixture supplied to the current checked-in view and the mock"). | Receipt statement. |
| C3 | "The receipt records that the fixtures and answer key were frozen before rendering and that a separate, deterministic grader scored the result; we could not check this because those files are not in the repository." | RCPT:42 ("The fixtures and key were frozen before rendering; the grader was separate and deterministic."); hashes at RCPT:40-41. | Now worded as a receipt-recorded statement with the limit stated. The frozen files are not on `origin/main`, so the hashes cannot be checked against files. |
| C4 | "Basic: the screen gives the correct overall status and a supported safe next step." | RCPT:25 ("core = correct initial disposition and supported safe next move"). | Plain-language paraphrase of "core". The article renames "core" to "basic" and "full" to "strict". |
| C5 | "Strict: the basic check, plus the source and freshness of the read are visible on that screen. Any unsafe cue fails the case." | RCPT:25 ("full also requires visible source/freshness; unsafe cues veto a pass"). | Paraphrase. "On that screen" is the first-screen reading of the "full" column; the "with details" variant is scored separately (RCPT:25, column 3). |
| N1 | Table: current page first screen 5 of 8 basic, 0 of 8 strict; after opening details, strict 3 of 8, basic "not reported"; mock 8 of 8 and 8 of 8. | RCPT:16 (C3: "5/8 core and 0/8 full; with details, full was 3/8; mock scored 8/8 on both"). Recount of RCPT:29-36 "Current core/full": Pass in rows 1-5, Fail in rows 6-8 = 5 of 8 core; "full" Fail in all 8 = 0 of 8; "with details full": Pass in rows 2, 3, 5 = 3 of 8; "Mock core/full": Pass / pass in all 8 rows. | The receipt table and its own summary row agree with my recount. The raw `results.json` is not in the repo, so this is a recount of a summary, not of raw data. The receipt does not report a "core" score for the with-details variant, so the article says "not reported". |
| D1 | "The three cases where the current page failed even the basic check were:" | RCPT:34-36 ("Fail / fail" in the current core/full column for rows 6, 7, 8). | Count of three failures follows from N1 (8 minus 5). |
| D2 | "An empty result with one source missing. The page showed the source warning beside the all-clear." | RCPT:34. | Fixture observation. |
| D3 | "A failed refresh with an older blocking item still on screen. The page showed an enabled Approve control beside the refresh error. No control was clicked." | RCPT:35 ("retains blocker and enabled Approve control beside refresh error; no action was invoked"); RCPT:17 (C4: "No control was clicked, and no server endpoint was tested."). | Observed rendering only. Does not show what a server would allow. |
| D4 | "A request scoped to one project while a row from another project was present (the receipt notes the current portfolio list is intentionally global, so this may be a design choice, not a defect)." | RCPT:36 ("Atlas scope; Birch row present"); RCPT:17 (C4: scoped to Atlas, a Birch row appears). | Fixture observation. RCPT:36 says the current portfolio list is global; RCPT:17 says it is intentionally global. The article now says this may be a design choice, not a defect. |
| E1 | "The list page shows 'Nothing is waiting on you.' when it has zero live items and no error" | TV:54 (`liveCount = approvals.length - groups.stale.length`); TV:88 (`liveCount === 0 && !common.error` renders the text); TV:84-87 (the branch is inside the loaded state). | Code read. "Live" items are those without a stale reason (TV:21). |
| E2 | "A missing source is reported as a separate note. The server adds that note when a source could not be read (`apps/dashboard/lib/approvals.ts:376`), and the page prints it above the list (`todo-views.tsx:36,83`)." | AP:376 (`for (const line of todo.unavailable) notes.push("The to-do list could not read a source: ...")`); AP:391 (note joined into the list result); TV:36 (note rendered in a status paragraph); TV:83 (`Notices` placed before the sections). | Code read. "The server" is the dashboard's list builder, not a separate service; the article's word "server" is a reading of AP, which builds the approvals list for the API route. Not run. |
| E3 | "The all-clear condition does not look at the note, so both can appear together." | TV:88 (condition uses `liveCount` and `common.error` only); TV:36,83. | Code read. Matches the fixture observation in A1. |
| E4 | "A failed refresh keeps the previous list: the failure handler sets an error and does not replace the items (`apps/dashboard/hooks/use-approvals.ts:92-96`)." | UA:78-97 (success branch sets approvals at line 85; catch at 92-96 only calls `setError`). | Code read. Items are retained because `setApprovals` is not called in the catch. |
| E5 | "That is how an old blocker can stay on screen." | UA:92-96 plus RCPT:35. | Inference from E4 and the fixture row. "Can" is deliberate; not shown in a live run. |
| E6 | "One page already shows an unknown state with retry, like the mock described in the receipt. On the single-item page, an item found in the list shows its card. An item absent from the list shows 'State unknown' and, when the page supplies a retry handler, a Retry button, if the read failed, carried a note about a source or about settle controls, or was the fallback list." | TV:139-147 (found item renders its card); TV:159-160 (reason = error, note or non-todo source), AP:376,378-379 (notes added for an unreadable source and for unavailable settle controls); TV:159-172 (`State unknown — ...`; `common.onRetry ? <button>Retry</button>`). | Code read. The comparison "the way the mock did" rests on RCPT:15 ("displayed unknown/retry for the partial read"). The mock's exact text is not on `origin/main`, so the article does not quote it. |
| E7 | "It shows 'Done' only when the last poll succeeded, every source was read, and the list was not the fallback list (`todo-views.tsx:139-188`)." | TV:156-159 (comment: "the last poll succeeded, `arcadia todo` read every source (no note), and it was not the fallback list"); TV:159-188 (reason built from error, note, source !== "todo"; "Done" rendered only when none apply). | Code and comment read. "Only when" matches the code path; an item found in the list renders as pending (TV:139-147), which the sentence does not claim. |
| E8 | "The eight cases did not test that page, and we did not run it. We only read its code." | RCPT:23-36 (no case names the single-item page); my own process (no run). | Absence statement based on the eight case names; the receipt does not state which components each case used beyond "the actual component". |
| F1 | "Proposed, not built, and not tested in the form below." and the three-line pattern and three rules. | None. This is a design proposal by the writer. | Proposal only. No file on `origin/main` implements these exact fields. Labelled with the proposed marker. |
| F2 | "In our test, the strict check passed 3 of 8 cases only after item details were opened, and 0 of 8 on the first screen." | RCPT:16; N1 recount. | Same limits as N1. |
| G1 | Section "What is not done": cases fabricated; no live system, browser session, model call or approval-endpoint test. | RCPT:42. | Receipt statement. |
| G2 | "The receipt records the mock as 'hand-authored'. The receipt does not say who wrote the mock, and the mock has not been shipped." | RCPT:42 ("hand-authored"); RCPT:15 ("not product code"). | "Does not say who wrote the mock" is true because the receipt names no author; "has not been shipped" is from "not product code". |
| G3 | "The frozen fixtures and the results file are not in the repository." | RCPT:43 ("Private scratch paths are intentionally omitted"); repository file search on `origin/main` for `results.json`, and for the fixture hash text in files, found no matching experiment files. | Absence claim; my search was a file-name and hash search on `origin/main` only (see Not checked). |
| G4 | "We did not click the Approve control or test what a server would allow." | RCPT:17 (C4); RCPT:42. | Receipt statement. |
| G5 | "The three-line pattern has not been built or tested. We do not know it would score 8 of 8." | None needed; follows from F1. | Honest limit. |
| G6 | "The single-item page was not part of the experiment." | Same basis as E8. | Absence statement. |

## Editorial additions (Nadia REVISE; no new facts)

| ID | Sentence | Evidence | Limit |
| --- | --- | --- | --- |
| H1 | Title: "When \"nothing needs you\" sits beside a failed read: complete, partial or unknown" (front matter uses single quotes). | Specified by Nadia via the coordinator. | Title only; the observation behind it is A1. |
| H2 | "The scores come from our own receipt, the frozen test files are not in the repository, and the mock's 8 of 8 shows only what a design can do." | RCPT:14-16, RCPT:40-43; G3 (absence search). | Restates limits already in G3 and N1; "only what a design can do" is an interpretation. |
| H3 | "We tested a dashboard, not an AI agent. Our view, not tested: the same three states (complete, partial, unknown) may apply to agent summaries too." | RCPT:42 (test was of a rendered dashboard component and a mock; no model call). | First sentence is a scope statement supported by RCPT:42. Second is labelled untested; no evidence is claimed. |

## Front matter checks

| ID | Field | Evidence | Limit |
| --- | --- | --- | --- |
| M1 | `slug: what-needs-me`, `date: "2026-11-10"`, `claims_receipt` path | `docs/articles/2026-11-10-what-needs-me.md:2-4,10` on `origin/main`; RCPT exists. | Kept from the original. |
| M2 | `writer: clara` | `site/_data/writers.json:8` (key `clara`, status `reserved`). | The registry entry is `reserved`, not `active`. Whether the site stage step accepts it for a published post was not checked. |
| M3 | `tags: [agent-workflows, evals, interface-design]` | Each tag appears in the front matter of existing articles on `origin/main` (`docs/articles/2026-11-10-what-needs-me.md:13`, `2026-10-14-arcadia-spatial-background.md:13`, `2026-10-28-how-arcadia-could-guide-design-brainstorming.md:13`). | `site/_data` holds no topic list (only `resources.yml` and `writers.json`), so "existing topics" is read from article front matter, not from `site/_data`. |
| M4 | `author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"` | Given in the task brief. | Not verified against an identity command. |
| M5 | `status: draft`, `not_done: true` | Task instruction. | Publication needs a new reviewer pass, Nadia's re-approval, and a reviewed change. |

## Not checked

- The frozen fixtures, answer key, grader and `results.json`: not in the repository; not re-run. All scores rest on the receipt table.
- Whether the mock's screen used the exact words "unknown" and "retry"; the mock is not on `origin/main`.
- Anything live: no browser run, no server run, no model call.
- Whether the live dashboard matches `origin/main`.
- Who wrote the mock.
- The original receipt's Google Cloud report, Relay proposal and PR #2365 rows (C5 to C8): these were cut from the article and are not re-verified here.
- Whether `writer: clara` and the front matter keys pass the site stage gate (`site/stage.mjs`); not run.

## Independent review

- Reviewer: a separate read-only Claude Code subagent (Sonnet 5.5, role fact-checker), not the author and not Flynn. It checked every sentence against `origin/main` (the revision pinned above) and did not take the author's draft receipt on trust.
- Rounds: Round 1: FAIL on four labelling and precision items (receipt-only facts stated as fact, the breadth of the 'State unknown' condition, a design-choice caveat, a stance under the Checked label). The author corrected them. Round 2: PASS. The critic's later edits (retitle, 'We tested a dashboard, not an AI agent', a demotion sentence for the mock's 8 of 8, and the settle-controls condition the reviewer had suggested) added no new claims and were not re-run through the fact-check.
- Findings: none outstanding at the last reviewed revision; the receipt's Not checked list states what was not verified.
- Verdict: PASS

## Editorial review

- Critic: Nadia (Arcadia's critic role, a separate read-only subagent) applied the Field Notes interest gate: a stranger can state the claim without Arcadia terms, a real result with its limits, a reusable method, a distinct angle, a searchable title, and a headline that survives its own caveats.
- Editorial verdict: APPROVE; placement: home page.
- Release approval: the operator's chat instructions of 2026-11-17: "I want Field Notes to only publish articles that Nadia approves. Have Clara rewrite all articles that Nadia thinks need work. ... Then one more review and publish." Merging this change is the release; set `status: withdrawn` in a reviewed change to unpublish.

## Trims after the editorial pass

- Removed the sentence "That is how an old blocker can stay on screen." (row E5 no longer applies) and the not-done bullet "The single-item page was not part of the experiment." (row G6 no longer applies; E8 still states it in the body) to stay under about 900 words.

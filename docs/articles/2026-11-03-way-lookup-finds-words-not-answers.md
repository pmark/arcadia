---
title: "Keyword search over agent rule files: the right passage for 16 of 30 questions, but only 11 as matched results"
date: "2026-11-17"
type: essay
slug: "way-lookup-finds-words-not-answers"
summary: "We tested a keyword search over the rule files our coding agents follow on 30 newcomer questions. It reached the right passage in its top three for 16 (11 as matched results, 5 as fallback address lists); one author, one judge, no held-out set recorded."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "Have someone other than the tool's author write 30 fresh newcomer questions, then run both the lookup fixture and the plain file-search agent on them, to replace this author-written development set."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/way-lookup-finds-words-not-answers.md"
canonical: "https://pmark.github.io/arcadia/posts/way-lookup-finds-words-not-answers/"
channels: [site, rss]
tags: [evals, testing]
last_modified_at: "2026-11-17"
featured: true
---

# Keyword search over agent rule files: the right passage for 16 of 30 questions, but only 11 as matched results

We wrote a keyword search over our agent rule files, the guidance our coding agents follow, then tested it on 30 questions a newcomer might ask. The search put the right passage in its top three results for 16 of the 30. Of those 16, 11 were matched results with excerpts and 5 were the "nearest addresses" list the command prints, without excerpts, when it says it has no match; counting matched results only, the figure is 11 of 30. Separately, an agent using ordinary file search over the same files, with no lookup command, gave answers that a judge marked fully correct for 22 of the 30.

These two numbers are not like for like. One counts whether the right passage appeared in three results or addresses. The other counts whether a written answer was correct. Both come from a development set: one author wrote the questions, one judge graded all 30 answers (22 were fully correct), and the search's author had already seen the questions. 🔎 Checked: the numbers match the files. ❓ Not proved: that they hold on questions nobody on the team wrote.

## The comparison

| | Plain file-search agent | Keyword lookup |
| --- | --- | --- |
| What was counted | Answers graded fully correct by one judge | Questions where an accepted passage was in the top three (matched results or nearest addresses) |
| Result on the same 30 questions | 22 fully correct, 8 partial, 0 wrong | 16 of 30 (11 matched results, 5 nearest addresses) |

The agent was told to start from the guidance index and one skill file, and used file search and bounded reads. The lookup is a command that ranks passages by keyword (BM25 over lightly stemmed words). It uses no model and no network, and by default returns at most three passages and 1,500 bytes of excerpt. The figures are not default-command results: the measuring test uses a 1,000,000-byte budget. Re-running at 1,500 bytes gave the same accepted questions on both revisions. The lookup was built after the agent run.

## What the lookup did

| Measure | Result |
| --- | --- |
| Questions | 30 |
| Questions where the search said it had a match | 20 |
| Of those, matches containing a fixture-accepted passage | 11 of 20 (original build; 12 of 20 on main) |
| Matches that did not contain the right material | 9 of 20 (original build, as probed; 8 of 20 on main, see below) |
| Off-topic queries refused | 17 of 17 |

The refusals are the good half. The weak half: a match means only that the question's words were found. The command's documentation says so, and its output opens with that warning.

The probe's example is the question "How do I stop everything immediately?". The lookup matched, and returned the agent's own stopping rule, not the operator's stop control.

That ranking has since been changed. A pull request merged on 2026-11-13 (#2549) makes stop-production wording return the production Off guidance first, and tests pin nine wordings. We re-ran the 30-question fixture on the main branch (revision 4c2cb0ee3; 🔎 checked by re-run, script in the receipt). It again gives 16 of 30, now 12 matched results and 4 nearest addresses (was 11 and 5), with 20 matched and 8 of those matches missing the accepted material, down from 9. Different questions moved and the total stayed at 16, so the ranking fix did not raise the headline number. The fixture still counts the stop question as a miss, because none of its accepted passages is the one now returned first. We did not judge whether that passage answers it.

## Two kinds of failure

The judge gave a cause for 10 file-search answers that fell short: 5 retrieval failures, 4 problems in the answer itself, and 1 missing-guidance case. The probe's author says the judge's defect list ties four of the five retrieval failures to guidance defects; we did not re-derive that.

- **A retrieval miss (Q15).** Asked how to stop everything, the agent said the material had no one-press stop. The judge marked the answer partial: a STOP button on the actions page exists, and the main operator guide did not mention it at the time.
- **A guidance gap (Q24).** Asked whether the system can generate images, the agent said honestly that nothing explains how an operator asks for one; the judge agreed.

Eight guidance defects from the probe were filed as [Issue 2013](https://github.com/pmark/arcadia/issues/2013), which is still open. Our reading: no search can find a passage that does not exist.

## Try this on your own rule files

📐 Proposed method, not something this probe proved:

1. Have someone who did not build the search write 30 newcomer questions before reading your docs, and list the passages you would accept for each.
2. Fix the search settings you will report (result count, byte budget).
3. Measure the top-three hit rate (matched results apart from fallback lists), how many matches miss, and how many off-topic queries are refused.
4. Grade a plain file-search agent's answers on the same questions as a baseline.
5. To compare answer quality, also grade an agent given the search: step 3 measures retrieval, step 4 answers.

## What is not done

- No held-out question set for this lookup is recorded. Someone other than the tool's author has to write it. Until then every number here is a development-set measurement.
- Limits recorded in the probe: no real first-time operator took part; a frontier model with file search is probably an upper bound, and no local model was tried; the judge had no fixed answer key.
- The agent ran without the lookup, so the lookup's effect on answer quality is unmeasured.

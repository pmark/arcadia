---
title: "Keyword search over agent rule files: the right passage in the top three for 16 of 30 questions"
date: "2026-11-17"
type: essay
slug: "way-lookup-finds-words-not-answers"
summary: "We tested a keyword search over the rule files our coding agents follow on 30 newcomer questions. It reached the right passage in its top three for 16; one author, one judge, no held-out set."
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

# Keyword search over agent rule files: the right passage in the top three for 16 of 30 questions

We wrote a keyword search over our agent rule files, the guidance our coding agents follow, then tested it on 30 questions a newcomer might ask. The search put the right passage in its top three results for 16 of the 30. Separately, an agent using ordinary file search over the same files, with no lookup command, gave answers that a judge marked fully correct for 22 of the 30.

These two numbers are not like for like. One counts whether the right passage appeared in three results. The other counts whether a written answer was correct. Both come from a development set: one author wrote the questions, one judge graded all 30 answers (22 were fully correct), and the search's author had already seen the questions. 🔎 Checked: the numbers are real. ❓ Not proved: that they hold on questions nobody on the team wrote.

## The comparison

| | Plain file-search agent | Keyword lookup |
| --- | --- | --- |
| What was counted | Answers graded fully correct by one judge | Questions where an accepted passage was in the top three results |
| Result on the same 30 questions | 22 fully correct, 8 partial, 0 wrong | 16 of 30 |

The agent was told to start from the guidance index and one skill file, and could use file search and bounded reads. The lookup is a command that ranks passages by keyword (BM25 over lightly stemmed words). It uses no model and no network, and by default returns at most three passages and 1,500 bytes. The lookup was built after the agent run and measured on the same questions.

## What the lookup did

| Measure | Result |
| --- | --- |
| Questions | 30 |
| Questions where the search said it had a match | 20 |
| Matches that did not contain the right material | 9 of 20 (original build, as probed; 8 of 20 on main, see below) |
| Off-topic queries refused | 17 of 17 |

The refusals are the good half. The weak half: a match means only that the question's words were found, not that the passage answers the question. The command's documentation says so, and its output opens with that warning.

The probe's example is the question "How do I stop everything immediately?". The lookup matched, and returned the agent's own stopping rule, not the operator's stop control.

That ranking has since been changed. A pull request merged on 2026-11-13 (#2549) makes stop-production wording return the production Off guidance first, and tests pin nine wordings. We re-ran the 30-question fixture on the main branch (revision 4c2cb0ee3; 🔎 checked by re-run, script in the receipt). It again gives 16 of 30, with 20 matched and 8 of those matches missing the accepted material, down from 9. Different questions moved and the total stayed at 16, so the ranking fix did not raise the headline number. The fixture still counts the stop question as a miss, because its accepted passages are not the one now returned first. We did not judge whether that passage answers the question.

## Two kinds of failure

The judge gave a cause for each of the 10 file-search answers that fell short on correctness or citation: 5 retrieval failures, 4 problems in the answer itself, and 1 missing-guidance case. The probe's author says the judge's defect list ties four of the five retrieval failures to defects in the guidance. That is the probe's reading; we did not re-derive it.

- **A retrieval miss (Q15).** Asked how to stop everything, the agent said the material had no one-press stop. The judge marked the answer partial: a STOP button on the actions page exists, and the main operator guide did not mention it at the time.
- **A guidance gap (Q24).** Asked whether the system can generate images, the agent answered honestly that nothing explains how an operator asks for one. The judge found the same: the guidance has the engineering description and no plain-words path.

Eight guidance defects from the probe were filed as [Issue 2013](https://github.com/pmark/arcadia/issues/2013), which is still open. Our reading, not a measurement: a better search cannot find a passage that does not exist.

## Try this on your own rule files

📐 Proposed method, not something this probe proved:

1. Write 30 newcomer questions before reading your docs, and have someone who did not build the search write them.
2. For each question, list the passages you would accept as the right material.
3. Measure the top-three hit rate, how many reported matches miss, and how many off-topic queries are refused.
4. Run a plain agent with file search on the same questions and grade its answers, so you have a baseline the search must beat.

## What is not done

- No held-out question set for this lookup is recorded. Someone other than the tool's author has to write it. Until then every number here is a development-set measurement.
- Limits recorded in the probe: no real first-time operator took part; a frontier model with full file search is probably an upper bound, and a local model was not tried; the judge had no fixed answer key, so another judge may grade differently.
- The agent ran without the lookup, so the lookup's effect on answer quality is unmeasured.
- The guidance gaps in Issue 2013 are open.

---
title: "5 of 7 AI-written articles failed their first fact-check, and what no check covered"
date: "2026-11-18"
type: essay
slug: "ai-written-articles-first-fact-check-failures"
summary: "We fact-checked seven AI-written articles sentence by sentence before publishing. Five failed round one; two took five rounds. Most described findings were about overstatement, counting or missing labels. The round records are relayed, not independently checked."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "Add a check to site/stage.mjs that stores a hash of the article text the fact-checker passed in the receipt and refuses to publish if the text later differs, then try it on the seven receipts."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/ai-written-articles-first-fact-check-failures.md"
canonical: https://pmark.github.io/arcadia/posts/ai-written-articles-first-fact-check-failures/
channels: [site, rss]
tags: [review, agent-workflows]
last_modified_at: "2026-11-18"
---

# 5 of 7 AI-written articles failed their first fact-check, and what no check covered

🔎 **Checked, with the main limit first.** Before seven rewritten AI-written articles were published on 17 November 2026 ([#2762](https://github.com/pmark/arcadia/pull/2762)), a separate read-only reviewer (a Claude Code subagent, not the writer) fact-checked every sentence against the repository. By the per-article records, which we call receipts, five of the seven failed the first round, and two needed five rounds. The limit: the coordinator that assembled the publishing pull request says it wrote the round records from the reviewers' reports (relayed, not checked). The repository holds no raw reviewer output. You can count what the records say; you cannot check that they are complete.

## How we counted

Counts come from the "Rounds:" line in each receipt, read at commit `79183fc75a1fc07e62c3ce8a2671a76793b6b3a1` of the public repository. A round counts as FAIL or PASS only where the line says so. Two lines were ambiguous; our counting rule is in the receipt.

| Article (short name) | First round | Rounds | FAIL rounds |
| --- | --- | --- | --- |
| Keyword search over rule files | FAIL, 5 sentences | 3 | 1 |
| Dashboard "nothing needs you" | FAIL, 4 items | 2 | 1 |
| 22 days to three merges | FAIL, 5 items (4 named) | 5 | 3 |
| Where an agent's time went | PASS | 1 | 0 |
| Replay your agent harness | FAIL, 9 sentences | 3 | 1 |
| Lint the task | PASS | 2 | 0 |
| Five rounds of review | FAIL, 2 fixes | 5 | 3 |
| Total | 5 FAIL, 2 PASS | 21 | 9 |

Of the 21 rounds, 11 are PASS, 9 FAIL, 1 neither. The FAIL rounds list 36 findings: 24 described, 12 not.

## A gap no check covered

Nothing in our publish script compares the published text with the text the reviewer passed. All seven receipts record at least one later edit that was not re-run. Six say a later edit added no claims (the replay receipt says so of its automated-review edits, though it calls its last two edits mechanical); the roles receipt says nothing on that. I checked none of them.

## What kinds of errors

This is my approximate reading: it places 21 of the 24 described findings, and 12 of the 36 findings have no description.

- **Headline or framing went further than the evidence (5):** "the headline comparison", "the '22 days' framing", "the progression claim".
- **Counts, sizes or dates (6):** "a wrong guidance size", "a row count", "a dated rule". Only the guidance size is called wrong.
- **Missing label or attribution (6):** "an unlabelled absence claim", "a stance under the Checked label", "an unattributed independence claim".
- **Scope too broad (4):** "the scope of the judge", "the breadth of the 'State unknown' condition".

So the described findings are mostly overstatement, unclear counting and missing labels, not many wrong figures.

## What we changed in publishing

After this, the publish script began requiring an editorial approval line in addition to a PASS verdict ([#2763](https://github.com/pmark/arcadia/pull/2763)). According to #2764, it also kept one essay off the site that had been merged as approved before its critic reviewed it ([#2764](https://github.com/pmark/arcadia/pull/2764)).

## What you can copy

📐 Proposed, not built:

1. Write one receipt row per factual sentence: the sentence, its evidence at a pinned commit, and what it does not prove.
2. Have a different reviewer re-check every row against the source, not the author's table. Record each round and verdict.
3. After the last PASS, store a hash of the article text in the receipt; make publishing refuse any other text. Untested.

## What is not done

- ❓ No raw reviewer output is in the repository. Round counts and findings rest on the receipts' own text, which the coordinator says it wrote.
- ❓ No control: we do not know how many errors an unchecked draft holds, or what the reviewer missed.
- ❓ Seven articles, one pipeline, one reviewer model; nothing generalises to other teams.
- ❓ The reviewer and the co-author trailer on the publishing commit both name Claude Sonnet 5.5; we did not test whether a shared model changes what is found.
- ❓ The groupings are approximate; 12 findings have no description.

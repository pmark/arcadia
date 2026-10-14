---
id: friction-number-picked-from-visible-table-collides
cost: unmeasured
fix: this PR (one file per friction, the slug is the id)
status: practice
---
Sessions chose the next friction row number from the table they could see, so two PRs claimed the same number: rows 20 and 21 each appeared twice, which made ledger citations of F20/F21 ambiguous. Closed by the per-file frictions directory and the frozen legacy table (rows renamed 20a/21a, the ledger row citing F20/F21 means the later rows).

---
arcadia: v1
type: proposal
project: arcadia
decision: "0075"
question: Can Arcadia enforce and automate decide-by-merge, checking that an approved Decision was ratified by the operator's own merge of the PR that added it, and letting managed production open Decision PRs and record merged answers without the operator touching the CLI?
---

# Ratify Decisions by pull request merge

## Why this project needs it

Decision 0075 makes decide-by-merge the default in every Project:
- the pull request is the question;
- the operator's merge is the answer.

The rule works today through agent instructions ("Decide by merging a pull
request" in the shared AGENTS.md block) and the operator's merge. Nothing in
Arcadia checks it, though:

- **Nothing tells a ratified Decision from a fabricated one.** `docs sync`
  ingests any `approved` Decision document on the base branch. It cannot tell
  an operator-merged ballot from an agent that wrote `status: approved` and
  merged it. "Merge on green" excludes Decision PRs, but only by instruction.
  CodeRabbit already flags this gap on every merge-ratified Decision (#756).
- **Managed production still stops at the CLI.** A production worker that
  reaches a Decision settles an Ask into an open Decision. It has no path to
  a Decision PR, so the answer still needs `decision approve`.

## What we would build locally

Nothing. The tempting local version is a per-project script that checks
merge authorship, and it would drift from Arcadia the way Decision 0025 was
written to prevent.

## What Arcadia could do

- **A `ratified_by` field on a Decision** naming the pull request, e.g.
  `ratified_by: pmark/arcadia#NNN`. `docs sync` would accept an `approved`
  Decision carrying it only when both of these hold, and would refuse or flag
  it otherwise:
  - that PR was merged by the operator, not by an agent identity; and
  - that PR's merge added or changed this exact Decision path, and the
    document now on the base branch is byte-for-byte the version that merge
    produced (or matches a content fingerprint recorded at merge).

  The second check binds the ratification to the whole document: question,
  options, consequences, and answer. Without it, a Decision could cite an
  unrelated PR the operator merged, or have its question or options edited
  after the merge that ratified it while `answer` and `status` stayed the same.
  Later edits that are only document hygiene need a new ratifying PR, or an
  explicit hygiene exception that the check can verify.
- **Decision PRs from managed production.** When a production session
  settles a `decision` Ask, it writes the ballot (recommended option as
  `answer`) on its own branch and opens the Decision PR, instead of leaving an
  open Decision for the CLI.
- **Record on merge.** When a Decision PR merges, Arcadia records the answer
  deterministically, the way `attemptAutoSettlePendingCompletion` already
  settles drafted `complete` Asks, and unblocks any Action that was waiting
  on it.

Trigger, if deferred: managed production raises a Decision that sits unanswered
for a week, or an agent merges a Decision PR.

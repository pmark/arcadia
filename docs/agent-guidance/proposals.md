# Detailed Way guidance: proposals

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

## Asking for a capability the Way does not have

Arcadia will not have every capability you need. When it does not, **file a
proposal and continue without it.** Do not implement Arcadia commands, parsers,
or governance machinery locally. A capability Arcadia does not have is a
request, not a gap for this project to fill.

That second sentence is the operative one. Without it the first is advice, and
what actually happens is a growing local script that reimplements Arcadia badly
and drifts from it silently — which is exactly the failure Decision 0025 was
written after finding.

**How to file.** Write `docs/proposals/<slug>.md` in *this* repository:

```markdown
---
arcadia: v1
type: proposal
project: your-project
question: Can Arcadia evaluate reactivation triggers so deferred items revive on their own?
---

# Trigger evaluation

## Why this project needs it

Three deferred items name conditions nobody re-reads, so they never revive.

## What we would build locally

A trigger evaluator in `scripts/`, which is the thing this proposal exists to
avoid.
```

Only the `question` is load-bearing, and it may instead be the document's first
`#` heading. The slug falls back to the filename, and `project` to whichever
Project owns this repository. Commit it like any other document.

**What happens next.** `arcadia docs sync` ingests it on its next run, and it
appears in `arcadia portfolio` under "Waiting on you", marked as a proposal. The
operator answers it by ratifying a Decision in the Arcadia repository, which is
where a Way change belongs. Add `decision: "0025"` to the proposal's frontmatter
once it is answered, and it stops asking.

Filing needs no network access, no credentials, and no reachable Arcadia — it is
a committed file, so it works from a cloud container with no Arcadia installed.


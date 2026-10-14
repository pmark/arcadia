# Frictions

One file per friction: `<YYYYMMDD>-<slug>.md`. The slug is the friction id and
is what a ledger row's `frictions[].id` cites. Slugs are lowercase words joined
by hyphens and never look like a legacy number (`F20`, `20b`).

```
---
id: <slug>
cost: <minutes or "unmeasured">
fix: <PR, Issue or proposed fix>
status: <open | PR number | practice>
---
What happened, the evidence, and the proposed fix.
```

The older numbered table in `../production-simulation-living-notes.md` is
frozen (`pnpm check:frozen-records`). Update a friction's status by editing its
own file; two PRs then never touch the same path.

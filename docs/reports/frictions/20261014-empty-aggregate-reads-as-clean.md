---
id: empty-aggregate-reads-as-clean
cost: 20
fix: this PR (close-out records carry ledger evidence none/partial/complete and null aggregates when no row matched)
status: practice
---
A record whose filter dropped every ledger row printed zero sessions, zero frictions and no PRs, which a next-Plan selector would read as a clean Plan. The dropped-row count lived only in CLI output. Rule: any derived record that filters its inputs must carry considered/matched/excluded counts and an evidence level, and report null, not zero, when nothing matched.

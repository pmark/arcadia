# Hand-off: production-path plan (2026-10-14)

- PR #1405 (governed records only). The decision-card Plan keeps its pointer on `delegation-policy-records`. Next in queue order: `blocker-reset-script` (now also `repair_budget_repeat`), then `wire-the-batch-merge-card-route` and `publish-the-batch-merge-descriptor-and`. Four operator-UX Actions are gated behind those three, with revival triggers.
- New inactive draft Plan `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider`, 8 Actions. Activate it through a governed `agent-ask settle --activate` once the four remaining decision-card Actions land; the operator merges that settle.
- Red alert `ra-2bcf88b68759`: the cause of the 2026-10-11 launch failure is **unknown**. The launch path is provider-neutral (src/sessions/index.ts `tmux could not start`), and the cause string never reached the evidence file. The first new Action, `launch-failure-keeps-cause`, fixes that.
- Codex is dormant; `reconcile-completed-governance-overlap` would relaunch on Codex. `first-supervised-claude-run` retires or re-scopes it.

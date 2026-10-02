# Issue #878 reviewed-installation and PPN continuation handoff

This is a runnable handoff for the repair in Arcadia issue #878. It records
the next authority boundaries; it neither installs the repair nor resumes PPN.

## Reviewed installation

Only after the repair pull request is merged at its reviewed head, an operator
uses the existing `/runs` **Reinstall Go broker** action. It installs the
reviewed main checkout through its constrained descriptor; it does not restart
services, fetch or reconcile Git, activate production, or alter PPN.

The equivalent host-terminal command, when the operator deliberately chooses
that route, is:

```sh
cd /Users/pmark/Dev/MR/Arcadia/arcadia
pnpm arcadia go-broker install
```

The installation receipt is required before any worker restart. Restarting the
worker remains a separate explicit operator gate: this repair does not perform
it or treat an installed launcher as an already-restarted service.

## Same-worktree PPN continuation

After the reviewed installation and any separately authorized worker restart,
resume only the existing PPN candidate; do not create a replacement worktree,
rebase it, reset it, or touch its pending files:

```sh
cd /Users/pmark/.codex/worktrees/establish-editor-production-contract-20261002T180616605Z/platform
/Users/pmark/.local/bin/arcadia-brief-broker-codex
```

The launcher takes no arguments. Paste its returned `data.dispatchBrief`
literally into the continuation session before any PPN work, and proceed only
if it resolves the retained PPN Action in this exact worktree. Do **not** run
mutable `arcadia advance` as a substitute. Only then may the continuation
revalidate the candidate's actual final tree, request protected preservation,
and settle PPN's criterion-exact completion Ask in that candidate before its
push. It may then update PPN PR #207 and pass its independent review/check
gates. PPN #207 remains a draft until its own Decision and merge conditions are
met. This handoff grants no production activation, client publication,
credential use, service restart, PPN edit, or Nagel release-verification claim.

## Repair candidate recovery evidence

The repair code was protected at `d45b2fb922438d3cca3bc00f7b305a05838ee037`
under immutable receipt `presv_a47d71b5cf6740669c`. Criterion-exact completion
was canonically settled at `1db14018c`. Main then advanced through PR #882:
final narrative preservation refused the incompatible base, and fixed Go
refused a second worktree while the manual candidate was dirty.

The operator subsequently instructed: **Authorize a bounded host recovery
exception**. Exact backups and SHA-256 checks preceded preservation of the
three pending narrative files at `86853e2e5`. Canonical Log
`log-pr888-bounded-host-recovery-authority-2026-10-02` records the instruction.
Merge `26fa3c333` retains both parents, original repair/completion commits, and
both byte-identical canonical Mission Log append sets; the sole conflict was
`MISSION_LOG.md`. No source repair edits, worktree replacement, reset, rebase,
installation, restart, production or PPN execution formed part of recovery.

The retained host fixture uses the literal installed no-argument launcher with
a patched-source consumer in an isolated disposable reservation and real
restricted validation. Initial and revised captures have distinct immutable
receipts (`presv_c3a0dbbf494a4137b6`, `presv_782205353b304438b5`); unchanged
retries reuse their outcomes, original receipt bytes remain unchanged, and
all captures are LOCAL ONLY with zero managed Sessions. The executable and
result are retained in the main checkout's ignored evidence folder
`artifacts/generated/operator-scripts/runs/repair-878-authorized-preparation-20261002/`.
This proves the candidate and launcher contract; it does not claim the live
worker has the repaired implementation.

The recovered candidate passed 53 tests with two existing skips, Notes
validation, lint, TypeScript and the core build. The literal fixed launcher
subsequently passed restricted host validation for tree
`ac159db5e706169d6fa3d821fb69b01ae508c9b0`
(`check-6W9y2U/validation.json`, producer `arcadia-host-seatbelt-v1`). Its final
commit step correctly refused at `preserve.replay`: the **older installed**
runtime reused `preserve:wtres_8c762d6463db4665bd` for the new tree. Attempt
`45966052-7d52-4ef0-aa91-465e70623a4e` retains that refusal. No fresh request
identity was supplied by the caller, no receipt was overwritten, and no new
protected preservation receipt is claimed. Original protected code receipt
`presv_a47d71b5cf6740669c` remains immutable; subsequent narrative custody and
reconciliation were performed under the operator's recorded host exception.
The installed-runtime limitation is the repair's separately gated installation
follow-up, not a passing preservation claim.

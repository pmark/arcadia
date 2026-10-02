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

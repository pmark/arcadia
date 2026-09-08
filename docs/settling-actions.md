# Settling a completed Action

Completing a governed Action used to be a five-flag dance: author an Agent Ask
YAML with every acceptance criterion verbatim and in order, look up the exact
candidate revision, preview it, copy the preview fingerprint, then
`agent-ask settle` with `--proposal`, `--request-id`, `--disposition`,
`--preview`, `--apply`, and `--operator`. Every one of those is derivable, so
two surfaces now derive them.

## One command

```sh
arcadia action settle --project <slug>
```

It resolves the Project's **current** Action, reads its declared acceptance
criteria, binds the candidate revision to the Project repository's HEAD, marks
each criterion met (completion refuses anything else anyway), previews, and
settles with operator authority. When the workspace has exactly one active
Project, `--project` is optional.

Useful flags:

- `--dry-run` — resolve and preview only; writes nothing. Use it to see the
  criteria and candidate revision before committing.
- `--note "<text>"` — one evidence note applied to every criterion.
- `--notes-file <path.json>` — a JSON array of per-criterion notes, aligned to
  the plan's own order (one string per criterion).
- `--action <slug/id>` — be explicit; it must match the current Action, because
  Actions complete in queue order.

A handy alias:

```sh
alias settle='arcadia action settle'
# settle --project arcadia --dry-run
# settle --project arcadia
```

## From the dashboard

The **Needs you** page (`/review`) has a **Settle a completed Action** panel:
pick a Project, review its current Action's criteria and candidate revision,
add an optional evidence note, and click **Settle as operator**. It calls the
same command, so the board and the terminal cannot disagree.

## What it will refuse (by design)

- **Not the current Action.** Complete in queue order; settle the pointer's
  Action first.
- **Candidate revision ≠ repository HEAD.** Completion binds to the Project
  repository's current HEAD, so the work must be **integrated** (merged) first.
  A branch that is still only in a draft PR is not yet at HEAD.
- **An unresolved required review Decision**, or **an Action already done**.

Merge, deployment, and publication remain separate operator gates. Settlement
only records that the Action's acceptance criteria are met and advances the
governed pointer.

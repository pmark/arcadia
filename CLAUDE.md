# CLAUDE.md

@AGENTS.md

Everything governing work in this repository is vendor-neutral and lives in the
files above and below. This file exists only to load them, because Claude Code
reads `CLAUDE.md` automatically and does not read `AGENTS.md`.

Read these before working:

| File | For |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Standing preferences — imported above, so it is already in context |
| [`CONSTITUTION.md`](CONSTITUTION.md) | The constraints that outrank convenience |
| [`docs/managed-documents.md`](docs/managed-documents.md) | How the work pointer, plan documents, and enforced fields work |
| [`OPERATOR_CONTEXT.md`](OPERATOR_CONTEXT.md) | Who this is for and what they want |
| [`START_HERE.md`](START_HERE.md) | Normal daily operation |

`arcadia next` prints the Constitution in its dispatch brief, so the standing
constraints arrive with the objective rather than depending on this file.

## Claude Code specifics

- `@AGENTS.md` above is a Claude Code import. Codex ignores it and reads
  `AGENTS.md` directly, which is why the shared rules live there rather than
  here. Do not move shared rules into this file — Codex would never see them.
- Prefer the dedicated file and search tools over shell equivalents, and run
  independent tool calls in one batch.
- This repository pins Node 22 via Volta. `better-sqlite3` fails to load on
  Node 24 or 25 with `SQLITE_NATIVE_ABI_MISMATCH`; use `volta run --node
  22.23.1` or an equivalent Node 22 on PATH before running tests or the CLI.

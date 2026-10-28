# Tidy unique work: two retained candidates, 2026-10-27

Operator-directed (Issue #1839, context #1827 and #1032). No governed Action was claimed or settled,
and no Plan, pointer or queue changed. Both source worktrees were read only; neither was edited,
committed, reset or removed.

## 1. `preserve-unchanged-baseline-skill-symlinks` (Action open)

Source: `/Users/pmark/.claude/worktrees/preserve-unchanged-baseline-skill-symlinks-20261006T225249160Z/arcadia`,
branch `claude/preserve-unchanged-baseline-skill-symlinks-20261006T225249160Z`, accidental HEAD
`f6b96a089c730f89c0983cfa08e83e46b38c0028` (`base`), 2 modified tracked and 18 untracked paths.

Outcome: **verified preservation bundle plus disposition.** No code is brought forward.

- Bundle: `/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/tidy-preserve-unchanged-retired-20261027/`.
  It contains a self-contained `branch.bundle`, `working-files.tar` (every untracked and modified path plus
  the whole `repo/` fixture tree, symlinks kept as links), `uncommitted.diff`, `commits.patch`, per-file
  source hashes and `SHA256SUMS`. Its `SUMMARY.md` gives the restore command and the operator-owned
  retirement step. The included `verify.sh` restored the bundle to the exact HEAD, reapplied the diff
  byte for byte, and matched all 24 archived paths to the source.
- The seven-file baseline-symlink repair is already on `main`. Each packet file is byte-identical to a
  blob in `origin/main` history, delivered by #1040 (`d0fddc132`) under Decision 0091.
- The reviewed-packet recovery capability (`src/sessions/reviewedPacketRecovery.ts`,
  `scripts/recover-reviewed-packet.ts`, `tests/reviewed-packet-recovery.test.ts`, the 1032 proposal and
  validation JSON) is **superseded**. Decision 0091 replaced Decision 0086's host-capability routing
  condition with direct delivery, and it says "Do not publish recovery capability files" and defers that
  machinery "unless direct delivery is rejected or a second concrete recovery caller demonstrates the
  dependency." Revival trigger: a second concrete caller, or a Decision asking for it.
- Open gap: acceptance criterion 5 still asks for that superseded operation, so the Action cannot be
  completed as written. It needs a governed amendment or retirement. #1041 (raised against #1040) is
  still open.

## 2. `fix-identity-block-fail-soft` (Action open; implementation in this PR)

Source: `/Users/pmark/.codex/worktrees/fix-identity-block-fail-soft-20261007T000035440Z/arcadia`,
branch `codex/fix-identity-block-fail-soft-20261007T000035440Z`, HEAD `2c9f11d06fca8ac9f4f8ca2935260846e8c4ec72`.

Reproduced on `main` `7b9434bb6`: source B's seven regressions, applied to unchanged `main` source, fail
seven of seven. The reviewer and Go refuse with `The coding-agent-models override is not valid JSON.`,
a failed render leaves an empty packet directory, and `advance` prints no Identity block. This PR carries
the fail-soft display loader forward. It also covers one call site that `main` added after the source was
written: the explicit-`--model` escalation hint in `src/commands/go.ts`, added in #1145. Automatic model
selection and launch still load the registry strictly.

- Bundle (the original candidate, including its 2026-10-07 report and recovery Ask draft):
  `/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/tidy-identity-fail-soft-retired-20261027/`.
- Not carried forward: the source's two LOCAL ONLY settlement commits, `f6c2fb382`
  (`asksettle_80e9710bcd804a62b8`, which rewords the Action's `next_action` to start with "Make") and
  `2c9f11d06` (`asksettle_dd7c4c5294be415bba`, which rejects the superseded draft). They are governed
  Plan records and never reached `main`. Replaying them needs a governed Ask against current `main`;
  they are preserved in the bundle.
- Issue #942 is closed, but the defect still reproduced on `main` until this change.

# Rowan handoff, 2026-10-31 late: route B, executor merged

## Objective

Reach `first-unattended-run` with a single operator press. Operator direction: minimal attention; agents decide anything that only carries out an answered Decision. This work is operator-directed (#1929), so no governed Action holds it.

## Verified state

- **Merged today:**
  - #1931 readiness refresh;
  - #1933 handoff;
  - #1934 runtime-check;
  - #1935/#1936 Decisions 0156/0157, answered A/A;
  - #1937 run scope;
  - #1944 START executor (`d65457f`).
- **Production:** Off at rev 83 / epoch 46 with zero admissions, last observed 18:47Z. Broker and worker run `24c4ee0`; the primary checkout is at `1ac59bd`. `production runtime-check` reports STALE, which is expected: the first card installs its pin.
- **Run scope:** in Plan `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider` (draft). The Actions are:
  - `bound-guidance-test-teardown-retries`;
  - `assert-tmux-temp-launcher-removed`;
  - `cover-retired-descriptor-byte-change`.
- **Open follow-ups:**
  - #1943: delegation validity window and test seam;
  - #1929: friction ledger.
- **Lessons captured:**
  - `lesson_e325c7e38e85d041dc67`: checklist drift;
  - `lesson_6457bb674da0370a4ec5`: a decision Ask needs `recommended:true`;
  - `lesson_2a139055625303afa1e4`: `release.sh` restarts only the demo dashboard.

## Resume location

- Repository `pmark/arcadia`, main at or after `d65457f`. There is no unpushed work.
- The session worktree `.claude/worktrees/rowan-readiness-refresh-20261031` is disposable.

## Authority and custody

Rowan (Claude Code, Opus, Claudia Atlas) holds sole coordination. Not authorized by anything in this handoff:
- START, install, restart, credential renewal or probe;
- Plan activation outside a pressed card.

Decision 0143 lets Rowan run a needed, bounded small-usage renewal and worker check. Confirm the class and the daily allowance (0141) before using it.

## Unresolved

- **`delegationReceipt`:** the executor requires it, pinned from `session-closeouts`. When the operator presses the card themselves, the press may be the authority and the old daily delegation may not apply. Decide from the executor code and Decisions 0141/0143/0156/0157 whether a press-time authority receipt replaces it. If that changes what the operator approves, it is a Decision.
- **The executor is proved only against fakes.** The first host `preflight` is the real test.

## Next action

Fix #1943 in a new branch, with an independent review and a merge on the gate. Then, read-only, run `arcadia start-run pins --plan arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider --actions bound-guidance-test-teardown-retries,assert-tmux-temp-launcher-removed,cover-retired-descriptor-byte-change --provider claude-code-cli --expires-hours 24` to see which evidence is missing.

## Stop condition

A minted card passes its host `preflight` and an independent pin critic check, and is published on `/actions`. Ping the operator only then.

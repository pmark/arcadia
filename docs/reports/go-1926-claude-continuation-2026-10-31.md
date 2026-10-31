# Rowan continuation: Go recovery after adoption and disposition (2026-10-31)

Handoff for a fresh Rowan (Codex, Claude Code or OpenCode). It is not execution authority. It supersedes the next steps in [the #1921 handoff](go-1921-claude-continuation-2026-10-31.md); that report's history stays valid.

## Objective

Operator-directed Go delivery probe on Project `go-agent-delivery-probe-20261029`, not the active Arcadia Plan's current Action. Retry the probe once through a supported recovery, with Production staying Off. Both approval packages the operator asked for are now complete.

## Verified state (2026-10-31 ~18:25 UTC)

- **Source.** The operator's own merge `810885cd3` reconciled the divergent local main without losing history: the tree is identical to the previous origin, and settlement `06a2cf802` and #1921 `42ecdeeb1` are ancestors. Main later fast-forwarded to `24c4ee020` (#1925, Decision documents only) and then to `1ac59bd` ([PR #1926](https://github.com/pmark/arcadia/pull/1926), squash of reviewed head `adcf3e1`). The primary checkout is clean on main at `1ac59bdba53b05ecaae560dd7cf8223db9f7cc0e`.
- **Package 1, runtime adoption.** The operator pressed the one-shot `/actions` button `adopt-go-1921-runtime-off-20261031`. It succeeded at 18:13–18:16 UTC; receipt `artifacts/generated/operator-scripts/runs/20261031T181357Z-67869/receipt.json` is host-local and git-ignored.
  - Broker: `eb15d32cb` → `24c4ee020`, READY, with both transports ready (independently re-verified).
  - Worker: `com.arcadia.local.742852621.worker` PID 86000 → 72812, started 11:16 PDT. Its loaded `24c4ee020` is inferred from start time and the unchanged checkout.
  - Script review: independent critic, three rounds, all GO. Round 1 found a stale-heartbeat proof gap; it was fixed.
- **Package 2, disposition.** PR #1926 fixed Issue #1920.
  - Review: two independent GO rounds; CodeRabbit findings addressed. CI: 15 checks passed. Merged by Rowan under Decisions 0060/0080.
  - The operator pressed one-shot `dispose-go-failed-successor-20261031`. It succeeded at 18:24:48–58 UTC; receipt `runs/20261031T182448Z-92315/` holds preview, apply and after JSON.
  - Append-only record `rdisp_63af0f8489ad427d92`, fingerprint `883d1c5b6fe3a8f7772cc52e101be8542c3988f60d3362255cc3793374e85e8b`, binds:
    - original `session_0bc6dbe2bf4c43f4b4`;
    - failed successor `session_85d12fec602444a2a7`, with no recorded provider start and no session log;
    - consumed request `recovery-after-1917-01a18f8f`;
    - false receipt `exit_a0c03759925f4965ae`;
    - candidate `4bc278f07`;
    - claim generation `wtres_f91295b95a394c3187`.
- **Production.** Inactive, revision 83, epoch 46, zero live admissions, throughout.
- **Candidate.** `/Users/pmark/.codex/worktrees/add-the-exact-marker-through-the-supported-go-launcher-in-a-real-configu-20261030T224030790Z/go-agent-delivery-probe-20261029` is clean at `4bc278f07`. No remote branch, no tmux, no Go marker, no delivery PR.

## Authority and custody

Rowan (Claude Code, `claude/go-1926-rowan-handoff-20261031`) is the coordinator until a receiver confirms custody. No claim was reset or released. The old recovery request and approval are consumed. Every further approval is the operator's.

## Unresolved

- **Worker drift.** The running worker loaded `24c4ee020`, but main is now `1ac59bd`. #1926 changed `launch.ts`, `launchPreview.ts` and `terminalClaimRecovery.ts`, which the worker may import lazily. Reload it before a launch. Use a new one-shot like `adopt-go-1921-runtime-off-20261031` with re-pinned HEAD, broker and PID, and the same heartbeat-after-restart proof.
- **No fresh recovery preview yet.** It needs a new request id; the old one now refuses with `recovery_request_consumed`.
- **Non-blocking review notes not applied:**
  - verify the disposition fingerprint inside the button's final check (the record does carry the right fingerprint);
  - add missing tests for `candidate_reused`, `original_not_terminal` and a request consumed by another original;
  - `launchctl kickstart -k` restart time is truncated to the second.
- **Process gap.** A second press of an `/actions` button would not see an origin change since its pin; re-pins were needed twice. Consider a reusable adoption action that discovers and validates the target at press time.

## Next action

1. Prepare one Off-only button that reloads the broker and worker at `1ac59bd`.
2. With the operator's separate approval, take a fresh read-only `arcadia session preview-launch --workspace /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover --repo /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/projects/go-agent-delivery-probe-20261029 --request-id <new id> --recover-session session_0bc6dbe2bf4c43f4b4 --json`. `--repo` must name the Go probe Project checkout; the default is the invocation directory.
3. Present a package with:
   - the preview fingerprint;
   - the candidate;
   - the configured Codex provider, model and effort;
   - the ten-minute bound, stop conditions and one-attempt consequence.

Do not launch, START or reset anything without that approval.

## Stop condition

The recovery launch package is published, verified and reviewed for separate operator approval, or a named blocker is recorded. Writing this handoff completes nothing.

## Handoff reason

Recommend handoff at a safe boundary: both packages are done and nothing is in flight. Basis: heuristic, headroom unknown. The session context is long and `autoCompact` is off.

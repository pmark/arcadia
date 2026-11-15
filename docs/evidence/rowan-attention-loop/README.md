# Rowan supervisor attention loop: evidence and concurrent-production readiness

Action `arcadia/prove-rowan-supervisor-attention-loop` (Plan
`prove-the-rowan-supervisor-attention-loop`, queued at position 0, revision 315,
settlement carried by PR #2685). Derived 2026-11-14/15 (all times UTC; Pacific
is UTC−8). This is evidence, not authority. Production stayed **Off** throughout
(policy revision 131, epoch 70, zero live admissions, observed 00:32:05Z).

**Verdict: Arcadia is not 100% ready for unattended, concurrent, cross-project
Production.** This candidate builds and proves the attention loop's missing
pieces in replay and in an attended CLI rehearsal. Five gaps below still
prevent the readiness claim. Two of them need an operator decision.

## What each piece of evidence is

| Kind | What it shows | Source |
| --- | --- | --- |
| **Observed unattended (live host)** | Host-originated operator pings reach Discord with no coordinator chat active. The `liveness-check` launchd job (every 60 s, installed broker `6ff679ba`) queued four context-handoff pings about the PPN Rowan. The Discord adapter presented them 3.4 s to 11.6 s later: `ping_56484e3c98464e0899` (20:20:23Z → 20:20:29Z), `ping_c32ba1286bd84dd295` (00:03:26Z → 00:03:30Z), `ping_dcd8850c0c414e28a3` (00:14:24Z → 00:14:32Z) and `ping_48bf7a3c47a740ab82` (00:29:35Z → 00:29:46Z). Zero of 23 pings since 2026-11-14 are pending. | `liveness-check.out.log`; `operator_pings`, read with `sqlite3 -readonly` |
| **Observed (live host), negative** | Workers have never used the worker → Rowan leg live: the live `native_mail_messages` table has 0 rows. | `sqlite3 -readonly` |
| **Attended rehearsal (real CLI, synthetic actors)** | Two fictional workers, `worker-nagel` (a significant result) and `worker-ellis` (a blocker with a ready action, consequence and evidence), mail `rowan-1`. Rowan reads its inbox, acknowledges both and relays both. One ping is queued; the result goes to the digest. A replay returns `duplicate`. Timings: emitted 00:38:37.005Z, acknowledged +7.0 s, queued +15.1 s, presented +18.6 s. Target 60 s: **met**. Most of this time is about 3.5 s of CLI start-up per command. | [attended-cli-rehearsal-receipt.json](attended-cli-rehearsal-receipt.json); `tests/rowan-attention-loop-cli.test.ts` |
| **Simulated** | Presentation in the rehearsal is `markOperatorPingSent` in a disposable test workspace. No message reached a real operator surface, because no authorized *test* channel exists (gap G4). | same |
| **Replay (hermetic)** | Duplicate relays, a retry by a second actor and a re-sent worker request never page twice. An unacknowledged, incomplete or expired blocker is refused. Undispatched and unacknowledged mail shows as overdue past 60 s, then as stale. A successor generation or a standby cannot acknowledge or relay its predecessor's mail, and the pending request stays visible. One project's overdue blocker neither hides nor delays another project's relay. | `tests/rowan-attention-loop.test.ts` (6 cases) |

Refusals and retries actually encountered: `gh` TLS/keychain refusals in the
sandbox were retried once unsandboxed, as the notes prescribe. One `git worktree
add` was retried for the same reason. No CLI `init` of an experiment workspace
was used, because Decision 0082's window closed on 2026-10-18; test-harness
temporary workspaces were used instead.

## What changed in this candidate

- `src/nativeMail/attention.ts`, wired as `arcadia native-mail overdue | relay | timing`:
  - `overdue` is a read-only listing across recipients and generations;
  - `relay` queues one ping per acknowledged blocker through the existing
    `arcadia ping` outbox, keyed by the episode `[attn:<message id>]`;
  - `timing` reports the emitted, acknowledged, queued and presented times.
- The team briefing is added to the portable `arcadia-role` skill: Signal, Rowan
  (including the direct variant), Flynn, workers and standby, plus the
  round-trip commands.

## Discovery of the briefing (criterion 1)

| Agent | Path | Check |
| --- | --- | --- |
| Codex | `.agents/skills/arcadia-role/SKILL.md` | Filesystem: present. No native check was run. |
| OpenCode | `.agents/skills/arcadia-role/SKILL.md` | Filesystem: present. No native check was run. |
| Claude Code | `.claude/skills/arcadia-role` → `../../.agents/skills/arcadia-role` | Filesystem: the symlink resolves. Native: this Claude Code session lists `arcadia-role` as an available skill, loaded from the main checkout. |
| PPN, the adopting Project | `platform/.agents/skills/arcadia-role` (a **copy** dated 2026-11-06) and `.claude/skills/arcadia-role` (a symlink to it) | **Stale.** PPN will not see this section until the skill is reinstalled there. The personal `~/.agents/skills/arcadia-role` also pins a source from 2026-10-16. This is gap G5. |

Unsupported host behavior: nothing in any of the three hosts wakes an idle chat
when mail arrives. Claude Code's background sessions and scheduled wakeups exist,
but Arcadia does not wire mail to them. See G3.

## Gaps that prevent a 100% readiness claim

| # | Gap | Exact reproduction | Smallest route |
| --- | --- | --- | --- |
| G1 | **Concurrency is capped at 1 globally.** `resolveConcurrencyGate` (`src/production/policy.ts:1411`) forces `effectiveMaxConcurrentSessions = 1` while `bootstrap-managed-production-to-build-flight-deck/prove-concurrent-ready-set-admission` is `open`. Two Projects cannot run at once. | Read the Action's status in `docs/plans/bootstrap-managed-production-to-build-flight-deck.md:2104` | Prove that existing Action. It is already in the governed queue. |
| G2 | **The cap is global, not one team per Project.** `countLiveAdmissions` (`policy.ts:1737`) has no project filter. Even with the gate open, nothing enforces "one work owner per Project" at admission. | `countLiveAdmissions` source | Proposal `agentask_c99a2cd347ad0b62b9`: a per-Project live-admission limit of 1 under a global cap. |
| G3 | **No idle-coordinator wake.** A blocker mailed to a Rowan whose chat is idle waits in `native-mail overdue` and pages nobody. The only unattended pager (`liveness-check`) reads worker liveness and coordinator context budgets, not mail. | `native-mail send` a blocker to an absent recipient, wait 60 s, then run `native-mail overdue`: the blocker is listed and no ping is queued | Proposal `agentask_8cb7d47cb80d86acbb`: `liveness-check` pages once per overdue blocker episode, reusing the `[attn:<id>]` key so a later relay does not page again. |
| G4 | **No authorized test operator surface.** `DISCORD_PING_CHANNELS` has no test alias, so an attended rehearsal with real presentation would page the operator's real channel. | `apps/discord-bot/README.md:28`; the installed bot environment has no ping-channel map | Operator decision (presented with this PR). |
| G5 | **Skill distribution is stale.** Adopters and the personal scope carry old copies of `arcadia-role`. | See the discovery table above | [Issue #2686](https://github.com/pmark/arcadia/issues/2686): a reinstall route through the existing skill installer. |
| G6 | **No hermetic multi-Project production test.** No tick test puts two in-scope Projects together, blocks one, and shows the other is still admitted. This candidate proves isolation only at the attention layer. | Survey of `tests/production-tick.test.ts` and `tests/managed-production-policy.test.ts` | Included in proposal `agentask_c99a2cd347ad0b62b9`. |

Not exercised here: a live restart or handoff with a pending request. The
replay covers custody continuity on the mail side. Coordinator `accept` and
`stand-down` refusals are covered by the existing `coordinator-*` suites. A live
Rowan-to-Rowan transfer with pending mail is still unobserved.

# Shared enrollment at concurrency one — 2026-10-24

Action: `unify-interactive-and-unattended-coordination-with-safe-concurrent-actions#prove-shared-enrollment-at-concurrency-one`. Intake: [#1733](https://github.com/pmark/arcadia/issues/1733).

## Source proof

`tests/unified-session-entry.test.ts` uses the canonical `executeHostEnrollment` / strict Go / guarded launch / admission path. Each fixture owns a temporary Git repository, workspace, policy and worktree root. Capacity and sign-in are supplied values; tmux records calls without spawning a provider. Fixture-only policy activation permits testing managed admission at `maxConcurrentSessions: 1`. It is not live production activation or installed-host enrollment proof.

- Two deterministic interleavings enter through separate host database connections: interactive preparation starts first, then managed launch starts first. The competing caller is refused while the winner is pending and after completion. Exactly one claim/candidate exists, with at most one Session, committed admission and development attempt. Exact replay retains the original receipt; changing caller or mode is refused.
- A fixture SQLite trigger interrupts the receipt write after canonical effects commit. Subsequent invocations reopen the persisted workspace; fake tmux silence and expiry of the pending-request lease do not give the other caller ownership. A stale-generation release is refused. Own recovery preserves the original claim id, generation and worktree, performs no second provider effect, and exact replay is stable even after the fixture turns Off.
- A real unresolved fixture Decision survives preview, preparation and refusals. The receipt reports the selected Action, caller, execution route, question gates, fenced claim and principal. Read-only Go preview makes no claim or admission; managed entry refuses Off; interactive preparation leaves Off unchanged.
- Missing and incomplete native supervision adapters refuse with `native_runtime_not_supervisable`, identify the managed-worker fallback, and create no claim, Session, worktree, admission or enrollment receipt.

Validation: `pnpm exec vitest run tests/unified-session-entry.test.ts` passed 7/7 (exit 0); `pnpm lint` passed (exit 0); `pnpm exec tsc --noEmit` passed on the final test file (exit 0); `git diff --check` passed. Independent review remains required before handoff.

## Installed-host recovery proof

Prepared candidate: `/Users/pmark/.codex/worktrees/prove-shared-enrollment-at-concurrency-one-20261024T212306082Z/arcadia`; branch `codex/prove-shared-enrollment-at-concurrency-one-20261024T212306082Z`; original revision `e8f21eb0c5b6675097343e8b79aa3c594bd62e5a`.

The original chat lacked the candidate writable root. The operator then selected `arcadia-unattended`; refreshed permissions included the provider worktree roots. The installed dependency bridge linked four dependency trees; mise warned that its tracking symlink outside the candidate was denied, but the bridge succeeded. No install or service restart occurred.

Fixed brief failures retained in the chat:

| Correlation | Stage | Receipt |
| --- | --- | --- |
| `f86c478f-9588-4772-bc8d-f75a9a84d920` | work-monitor | 25005ms deadline |
| `eede3387-5ab2-4eb4-84a2-ac8719b9535c` | work-monitor | 25006ms deadline |
| `512ac6fb-af40-426c-a8df-574842521f2c` | work-monitor | 25008ms deadline, Apple Git tracing |
| `cb8861cc-aeac-4175-b6cd-002e19cfcd38` | next | 25005ms deadline, Homebrew Git tracing |

Apple Git trace: 333 starts / 332 exits, 9.489 seconds in completed Git calls, slowest 0.413s. Homebrew Git trace: 571 completed calls, 12.806 total Git seconds, slowest 0.121s. Steady progress disproves a single hung Git call for these attempts; cumulative scanning / subprocess overhead is supported, while exclusive causation is not proved. Trace files are diagnostic scratch under `/private/tmp`, not durable completion authority.

The existing fixed route succeeded without tracing:

```sh
PATH="/opt/homebrew/bin:$PATH" /Users/pmark/.local/bin/arcadia-brief-broker-codex
```

Success correlation: `63994bd6-2c07-4049-9773-2bc68232b836`; observed `2026-10-25T02:13:21.294Z`. The brief explicitly confirmed caller-owned Action claim `wtres_6848457dfe0f489494`, generation `wtres_077d78a6ca574e5193`, one reserved owner, no canonical active Session, and permission to continue this Action. The dispatch brief was pasted verbatim in chat. No enrollment was fabricated and no worktree was created manually. The host Go preparation and successful read-only brief are the installed-host proof; the new enrollment regression remains source/fixture proof only.

The verified route was captured through canonical Learn as `lesson_4cc0d6e816bcf7427028`; its first sandbox write failed `SQLITE_WORKSPACE_WRITE_DENIED`, and the identical supported command succeeded through ordinary approved host execution. No direct SQLite access to the live workspace occurred.

## Retrieval and friction

Hacker recovery used one bounded deterministic pass, the retained candidate and the existing fixed launcher. No budget, deadline, policy, ownership or review gate was weakened. Actual processed token usage is unavailable. The operator requested standard/medium; the brief resolved Cody Mason. This report does not independently prove a runtime model switch.

The source test initially asserted database state `off`; the actual canonical stored value is `inactive`. Correcting that assertion yielded 7/7 passing tests. Nonexistent guessed source/procedure paths were corrected by scoped file discovery; none was treated as an alternate procedure. A process-list diagnostic was denied by the sandbox and was not escalated or worked around. Optional OpenAI Docs setup guidance and computer-use checks in the earlier blocked setup phase granted no execution authority; Codex self-access through computer use was denied.

Loaded guidance paths and UTF-8 bytes (section reads where applicable):

- `CONSTITUTION.md` — 3320 bytes.
- `PROJECT.md` — 31448 bytes.
- `.arcadia/AGENT_CONTEXT_POLICY.md` — 539 bytes.
- `.arcadia/repo-context.md` — 703 bytes.
- `.arcadia/context-policy.json` — 870 bytes.
- `docs/agent-guidance/index.json` — 11757 bytes.
- `docs/plans/unify-interactive-and-unattended-coordination-with-safe-concurrent-actions.md` — 8561 bytes.
- `docs/agent-guidance/continuation.md` — 7256 bytes.
- `docs/agent-guidance/learning.md` — 2458 bytes.
- `docs/working-copy-safety.md` — 16202 bytes.
- `docs/agent-guidance/arcadia-repository.md` — 30312 bytes.
- `docs/agent-guidance/native-app-sessions.md` — 9061 bytes.
- `docs/agent-guidance/chat-titles.md` — 5310 bytes.
- `docs/agent-guidance/git-identity.md` — 5248 bytes.
- `docs/agent-guidance/session-roles-and-briefs.md` — 15222 bytes.
- `docs/agent-guidance/hacker-recovery.md` — 7943 bytes.
- `docs/agent-guidance/rehearsal-freeze-window.md` — 4690 bytes.
- `docs/agent-guidance/principles.md` — 14124 bytes.
- `docs/agent-guidance/pull-requests.md` — 21758 bytes.
- `docs/agent-guidance/agent-asks.md` — 23384 bytes.
- `docs/managed-documents.md` — 17446 bytes.
- `.agents/skills/arcadia-guardrail/SKILL.md` — 5565 bytes.
- `/Users/pmark/.codex/skills/arcadia-go/SKILL.md` — 15850 bytes.
- `/Users/pmark/.codex/skills/arcadia-hacker/SKILL.md` — 2024 bytes.
- `/Users/pmark/.codex/skills/arcadia-role/SKILL.md` — 9080 bytes.

Repository-specific sections retrieved: Orientation, Plan-amendment runner, Arcadia Semantics, Model Selection, Operator Guide, PR QA Plan and Working-Copy Safety. Notes lookup covered broker/brief/work-monitor, preservation, enrollment, test commands and the initial failed assertion. Source inspection covered the fixed brief supervisor, work monitor/scanner, enrollment transport/core/host adapter, existing host-enrollment tests and Action-claim generation tests. Production activation, credential probing, native adoption, increased concurrency and runtime recovery remain outside this Action.

Live read-only production status at `2026-10-25T02:18:45.055Z`: Inactive / Idle, desired state inactive, revision 79, epoch 44. No live production command was run to change it. Existing unrelated alerts remain untouched.

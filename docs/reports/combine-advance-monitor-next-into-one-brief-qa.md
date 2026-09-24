# Combined advance/work-monitor/next brief QA

Milestone: Bootstrap managed production to build Flight Deck.
Action: `combine-advance-monitor-next-into-one-brief`. Responsibility: agent.

Prior to this change, resuming a prepared worktree required three separate
launcher/command round trips: the `arcadia-advance-broker-<agent>` launcher,
the `arcadia-work-monitor-broker-<agent>` launcher, and `pnpm arcadia next`
(often re-run with `--project <slug>` once the ambiguous-Project refusal was
hit). This Action adds one new broker operation, `brief`, that runs all three
existing read-only implementations (`runAdvanceCommand`, `runWorkMonitorCommand`,
`runNextCommand`) in a single process invocation and returns their combined
JSON, including `data.dispatchBrief` — the exact text `pnpm arcadia next`
would have printed. `arcadia-go.SKILL.md`'s step 2 now issues only the
`brief` launcher; the standalone `advance` and `work-monitor` launchers, and
`pnpm arcadia next` itself, are unchanged and remain independently callable.

## No networked runnable target

This is a local CLI broker with no HTTP endpoint, port, or route — the
"no runnable target" case in `docs/operator-demo-and-release-contract.md`.
The strongest available proof is the deterministic test suite plus a live
run of the new launcher against a real prepared worktree (below). The
condition that would make an HTTP-style demo possible does not apply here;
this surface is exercised through a coding-agent's own tool calls, not a
browser.

## Operator procedure

1. From the repository root, on a clean, committed snapshot, run:

   ```sh
   pnpm arcadia go-broker install
   ```

   Expected: `Installed protected broker revision <sha>.` listing
   `Codex brief executable: ~/.local/bin/arcadia-brief-broker-codex` among the
   other listed executables, and `arcadia go-broker status` afterwards reports
   `Protected broker setup: READY`.

2. From a prepared worktree (one `arcadia go` already handed off), run the
   combined launcher instead of the old three-command sequence:

   **Before (3 round trips):**

   ```sh
   arcadia-advance-broker-claude
   arcadia-work-monitor-broker-claude
   pnpm arcadia next --project <slug>
   ```

   **After (1 round trip):**

   ```sh
   arcadia-brief-broker-claude
   ```

   Expected: one JSON object on stdout with `data.advance`, `data.workMonitor`,
   `data.next`, and `data.dispatchBrief` — the last is the literal text the
   three-command sequence used to require a separate `pnpm arcadia next` call
   to produce. Paste `data.dispatchBrief` verbatim into the chat as the
   session's opening brief.

3. Confirm the standalone launchers still work unmodified: run
   `arcadia-advance-broker-claude` and `arcadia-work-monitor-broker-claude`
   directly. Expected: each still returns exactly the same shape it did before
   this change (`advance-broker` / `work-monitor-broker` command names), for
   manual troubleshooting or other automation that needs only one stage.

## End-user procedure

Same as the operator procedure — a coding agent following the
`arcadia-go` skill runs the exact commands above from within its own tool
calls; there is no separate end-user path.

## Validation

Deterministic suite, from this candidate worktree (`combine-advance-monitor-next-into-one-brief-20260924T145758136Z`, base `59daea9d`):

- `mise exec -- pnpm exec tsc -p tsconfig.json`: exit 0.
- `mise exec -- pnpm exec vitest run tests/go-broker.test.ts tests/go-broker-agent-setup.test.ts tests/production-fault-matrix-runtime.test.ts`:
  **3 files passed; 51 passed, 0 skipped.** Covers: the combined `brief`
  success path returning all three stages' data plus the rendered
  `dispatchBrief` text; a failure injected at the `advance`, `work-monitor`,
  and `next` (including project-slug resolution) stages individually,
  each reported with the original error's exact code/message/details plus a
  `stage` tag, never genericized; every standalone `advance`/`work-monitor`
  broker operation and every existing agent-setup/installer test proven
  unaffected; and the `renderGoBrokerLauncher`/`parseGoBrokerArguments`
  contract extended to accept `brief` the same way as every other operation.

Live proof against this real prepared worktree (not a mock), run directly
against the compiled-from-source broker script before a global install:

```sh
mise exec -- node --import tsx scripts/arcadia-go-broker.ts claude brief
```

Result: `"command": "brief-broker"`, `data` keys `["advance", "workMonitor",
"next", "dispatchBrief"]`, and `data.dispatchBrief` byte-for-byte equal to the
dispatch brief this session had already captured from a standalone
`pnpm arcadia next --project arcadia` run earlier in the same session —
including the resolved `active_plan`, `current_action`,
`combine-advance-monitor-next-into-one-brief`'s full acceptance criteria, the
embedded Constitution text, and the `Dispatchable: a coding agent may begin
this action now.` verdict. Zero model calls; the entire response came from
three existing deterministic read paths (`resolveProjectTransition`,
`scanProjectWorkingCopies`, `resolveDispatch`) plus one deterministic
`discoverDocs` lookup for the Project slug.

`pnpm arcadia go-broker install` was not run in this session (it requires a
clean, committed repository root, which this in-progress candidate is not);
the launcher-generation and placeholder-substitution logic that install step
depends on is covered by `tests/go-broker-agent-setup.test.ts`'s
`converges a mixed existing installation` and `allows the fixed go request
launcher alongside prepared-worktree brokers` cases, both updated to assert
the new `brief` executable is embedded in the rendered skill, the Codex
rules file, and the Claude `permissions.allow` list exactly like every other
broker operation.

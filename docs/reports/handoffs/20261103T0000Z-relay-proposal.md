# Handoff: Relay proposal

**Latest (2026-11-05):** the operator approved [the layer design](../../design/relay/workspace-layers.md) with 1A and 2A (S029). After testing
step 1 on a phone, they redirected the work (S030, S031), and the design's "Revised after the phone test" section holds the new build order.
Items 1 and 2 of that order are merged and live:

- **Item 1, light status reads:** [PR 2077](https://github.com/pmark/arcadia/pull/2077).
- **Item 2, never wait:** tap feedback in [PR 2079](https://github.com/pmark/arcadia/pull/2079), the production build in
  [PR 2080](https://github.com/pmark/arcadia/pull/2080) and [PR 2081](https://github.com/pmark/arcadia/pull/2081), and the automatic switch
  in [PR 2082](https://github.com/pmark/arcadia/pull/2082).

**Measured live at phone size, under load 24:** the activity line appears 100 to 150 ms after a tap. Once a page has settled for 3 s, a tap
reaches the new URL in 120 to 190 ms. A tap in the first second on a cold cache still shows the line at once, but the URL takes 2.4 to 6.5 s
while script loads.

**Not yet shown:** the automatic switch hasn't fired on the live job. A temporary launchd job proved it through the real serve path, and the
first real proof comes with the next merge that changes the dashboard or `src`, then a restart: `apps/dashboard/.live/build.log` should say
"Switching to the new build." The operator tested item 2 on an iPhone and reports it's "a lot better" (S032).

**Built overnight and waiting for the operator (S032, S033), none tried on a real phone:**

| Merge in this order | What it is |
|---|---|
| [PR 2095](https://github.com/pmark/arcadia/pull/2095) | Item 3, weather rhythm. [Probe weather-1](../../design/relay/probes/weather-1.md) has the measurements |
| [PR 2107](https://github.com/pmark/arcadia/pull/2107) | Item 5, routes as the context layer |
| [PR 2101](https://github.com/pmark/arcadia/pull/2101) | Item 4, the modal overlay. Its branch contains PR 2107, so it goes second |
| [PR 2109](https://github.com/pmark/arcadia/pull/2109) | A lighter Decision page, with answers still on `/todo` |
| This handoff's own PR | Merges last |

After those, a restart serves them through a background build. The main checkout holds local pointer commits, so sync it first (see "Friction" below). Other agents may be
working on production, so check first. The design's "Built overnight" section lists the choices that are the operator's to overrule.

**Next:** item 6, one question at a time, needs a Decision before real Decision answers move into Relay. C-077 to C-082 stay `leaning` until the operator approves the revision.
The operator had PR 2027 merged on 2026-11-05, which doesn't approve the revision. Earlier, they answered 1A 2A 3A 4A 5B on the proposal and set the
Workspace direction and freeze (S022, S023).

# Objective

Take [the Relay proposal](../../proposals/relay.md) from proposed to approved, then build its first slice.
There is no assigned Action: this is operator-directed work under
[Issue 2005](https://github.com/pmark/arcadia/issues/2005), which is closed. A new intake Issue may be needed.
Unattended production stays the first priority, and production stays Off.

# Verified state

**Merged to main:** PR 2007 (Arcadia Design skill and `arcadia design check`), 2009 (Relay mode), 2010, 2014, 2016
(`arcadia way lookup`, STOP guidance), 2019, 2020, 2022 (design record and probes), and
[2027](https://github.com/pmark/arcadia/pull/2027) (the proposal, investigation, S021 to S031, the layer design and this handoff).
Reviews of PR 2027 found no blocking finding at `977fc351e`. R2 and R3 raised five blocking findings on the layer design, all fixed, and R4 at
`29b69ebe7` found none. The review at `b37680630` found none either. That last round was the only
independent read of everything after `29b69ebe7`, including the phone-test revision. Its findings are on the PR.

**Open, not merged.** Re-read each PR's checks and merge state before relying on them.

| PR | Contents | Independent review |
|---|---|---|
| [2028](https://github.com/pmark/arcadia/pull/2028) | Three Field Notes drafts | **None, and no fact-check** |

**Not built:** the structured outcome, visible answers, name matching, lookup routes, the menu, the scorecard, and
any companion.

**Conclusions not to rediscover:**
- Everything measured is in `docs/design/relay/probes/`. Start with `routing-3.md`, `local-model-1.md` and
  `way-knowledge-1.md`. The proposal summarizes them.
- [The investigation](../../design/relay/reviews/investigation-first-slice.md) checked the first slice against code.
  I confirmed by running or reading: the renderer gap, the 0.96 name match, and the memo limits.
- Critic R1 returned hold, with eight blocking findings open
  ([report](../../design/relay/reviews/R1-relay-critique.md)). That critic shared the author's model, so it can't
  satisfy the ready gate.

**Decisions:** none filed as Decision documents. The operator's answers are recorded as S022, S023 and S029.

# Resume location

- **Repository:** `pmark/arcadia`. These files are on main.
- **Drafts branch:** `claude/field-notes-drafts-20261103`. Clara's worktree is
  `.claude/worktrees/agent-aea5b03a6340935af`, on a differently named local branch.
- **Superseded worktrees, safe to retire once their branches are confirmed merged:** `relay-design-record`,
  `relay-design-extract`, `relay-design-speed`, `relay-way-slice`, `relay-critical-path`, `relay-model-bakeoff`,
  `relay-routing`, `arcadia-design-fill-gaps`, and `relay-proposal` once its follow-up merges (its old branch, `claude/relay-proposal-20261103`,
  merged through PR 2027).
- **Running operations:** none known.

# Authority and custody

The operator holds every decision here. Nothing is claimed, and this hands off no custody. Merge rules are the
usual ones. Field Notes publishing stays under Decision 0120, and PR 2028 merging isn't approval to publish.

# Unresolved

**Evidence still missing:** real operator messages, idle latency, sustained use, the live path through oMLX and
LiteLLM, whether the 27B can stay loaded beside other work, prefix caching on Qwen3.5-9B and the 27B, supervisor
resume cost, and native discovery of both skills in fresh Codex, Claude Code and OpenCode sessions.

**Not done at close:** a session ledger row in `docs/reports/session-ledger/` wasn't added, because its schema wasn't
checked. The frame is confirmed by S022, and CH-03 is settled. REQ-015 to REQ-018 are confirmed by S029. R1's eight blocking findings are still open against the earlier frame, so `--ready` still refuses.

**Friction worth knowing:**
- In worktrees, the sandbox blocks `pnpm` and `mise`. Use `node --import tsx src/cli.ts`, `node_modules/.bin/vitest`
  and `node_modules/.bin/tsc`, after `node scripts/bridge-worktree-deps.mjs`.
- The shell is zsh: `$R:path` is parsed as a modifier, and a bare `===` fails. Quote refs and use `##` as separators.
- Never trim `arcadia design check` output with `tail`. Doing so hid a real failure and caused a red CI run.
- `record.yaml` was generated by a scratch script that's gone. Edit the YAML directly, and update each source's
  `sha256` when its file changes.
- Machine load reached 187 during benchmarks, so don't run them beside test suites and call the numbers a baseline.
- Under launchd, macOS resets `XPC_SERVICE_NAME` to `0` in anything a job forks, and setting it to a label by hand makes macOS stop the process.
- Local `main` can hold never-pushed `chore(arcadia): point at ...` commits, which makes `git pull --ff-only` refuse after a merge. Use
  `syncBaseWithOwnPointerCommits` in `src/git/pointerReconcile.ts`, which keeps them, or `arcadia go`. Check `git log -1` before restarting.
- `tests/dashboard-live.test.ts` fails in the sandbox because it binds local ports, so run it outside.
- A full `next build` fails in a bridged worktree at prerendering. From `apps/dashboard`, use `ARCADIA_DASHBOARD_DIST=.next node node_modules/next/dist/bin/next build --no-lint`, and restore `next-env.d.ts` after.
- PRs that are each green can still fail together. Overnight, the overlay's spec failed once merged with routes, which only a local merge of the branches showed.

# Handoff reason

Outcome: recommend handoff. Basis: heuristic, because the operator reports capacity is nearly out; headroom is
otherwise unknown. Safe stopping point: everything is committed and pushed, with nothing running.

# Next action

Follow the layer design's build order, one PR per step, with production work first whenever they compete.

```text
Continue the Relay build. Read docs/reports/handoffs/20261103T0000Z-relay-proposal.md and
docs/design/relay/workspace-layers.md, then check which build step's PR is open and continue from there. Unattended production stays
first, and production stays Off.
```

# Stop condition

The first slice has an approved route for "visible answers". That's an operator-directed PR, or an Agent Ask, which
Arcadia Design allows only once `arcadia design check docs/design/relay/record.yaml --ready` passes. An independent PR
review doesn't satisfy that gate, because it counts only reviews recorded in the design record.

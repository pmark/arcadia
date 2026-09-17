---
arcadia: v1
type: reference
slug: deactivate-non-arcadia-projects
project: arcadia
title: Deactivate every Project except arcadia (temporary, reversible)
updated: 2026-09-17
---

# Deactivate every Project except `arcadia`

Temporary, fully reversible portfolio deactivation performed 2026-09-17. Only
`arcadia` remains `active`; every other Project is `paused`. Nothing was deleted.

## Status table

All seven non-Arcadia Projects had prior status `active`. Reactivation is the
same command shape for every row; the PROJECT.md half is reversed by reverting
the recorded commit (or checking out the original branch).

| Project | prior | new | DB changed | PROJECT.md changed | reactivation |
| --- | --- | --- | --- | --- | --- |
| two-action-rehearsal | active | paused | yes | yes | `pnpm arcadia project update proj_6f9a48901eb64a849f --status active` |
| household | active | paused | yes | n/a (no repo/PROJECT.md) | `pnpm arcadia project update proj_7e66bf09567a427985 --status active` |
| zero-prompt-rehearsal | active | paused | yes | yes | `pnpm arcadia project update proj_fc0a2c56e3e7424c84 --status active` |
| living-songbook | active | paused | yes | yes | `pnpm arcadia project update proj_b8c87ee93ed94638a5 --status active` |
| private-practice-now | active | paused | yes | yes | `pnpm arcadia project update proj_f1f85fc842514638bd --status active` |
| rebuster | active | paused | yes | yes | `pnpm arcadia project update proj_bfe29e0038994a36ae --status active` |
| martian-rover | active | paused | yes | yes | `pnpm arcadia project update proj_44e1d6cc9d0e4784b8 --status active` |
| **arcadia** | active | active (untouched) | no | no | — |

DB writes used the canonical command `pnpm arcadia project update <id> --status paused`.
No database was edited by hand.

## PROJECT.md commits (checked-in documents)

Agent Ask v1 has no Project `status` field (see Issue #298), so each
`PROJECT.md` `status:` line was edited directly and committed on a dedicated
local branch. **These commits are local only — not pushed** (no-publish
constraint). The working tree at each repo path now shows `status: paused`,
which is what `src/docs/dispatch.ts:130` reads.

| Project | repo path | original branch @ prior HEAD | pause branch @ commit |
| --- | --- | --- | --- |
| living-songbook | `/Users/pmark/Dev/MR/music/living-songbook` | `codex/bootstrap-living-songbook` @ `5bcfa45` | `arcadia/pause-living-songbook-20260917T231722Z` @ `79a6004` |
| martian-rover | `/Users/pmark/Dev/MR/sites/martianrover-com2` | `main` @ `fee4d05` | `arcadia/pause-martian-rover-20260917T231722Z` @ `03b116c` |
| private-practice-now | `/Users/pmark/Dev/PrivatePracticeNow/platform` | `main` @ `bf807b5` | `arcadia/pause-private-practice-now-20260917T231722Z` @ `2e236c6` |
| rebuster | `/Users/pmark/Dev/MR/tools/Rebuster` | `main` @ `1b02f62` | `arcadia/pause-rebuster-20260917T231722Z` @ `c2f4893` |
| two-action-rehearsal | `/Users/pmark/tmp/arcadia-two-action-rehearsal` | `main` @ `b2215a8` | `arcadia/pause-two-action-rehearsal-20260917T231722Z` @ `0035c45` |
| zero-prompt-rehearsal | `/Users/pmark/tmp/arcadia-zero-prompt-rehearsal` | `main` @ `b66d173` | `arcadia/pause-zero-prompt-rehearsal-20260917T231722Z` @ `4dd3d34` |

Full reactivation of a Project is therefore:

```sh
pnpm arcadia project update <id> --status active
git -C <repo> checkout <original-branch>      # or: git -C <repo> revert <commit>
```

## Reconciliation proof

`pnpm arcadia docs sync --json` (dry run, document -> DB) after the edits:
`applied: false`, `totals.update: 0`, and zero `entity: project` `update`
changes. No `status: … -> …` drift for any Project.

## Automated surfaces

### Already filtered (verified by reading, no change needed)

| Surface | file:line | Observed |
| --- | --- | --- |
| managed production tick | `src/production/tick.ts:122` | filters `status === "active"` |
| agent/work queue | `src/dispatch/queue.ts:130` | filters `status === "active"` for the per-project scan |
| dispatch / `arcadia next` | `src/docs/dispatch.ts:130` (and `src/commands/next.ts:88,108,139`) | document status refused, DB list also active-only |
| work monitor | `src/commands/workMonitor.ts:20` | active unless `includeInactive` |
| digest scheduler | `src/commands/digest.ts:251` | filters `status === "active"` |
| living-system sync | `src/livingSystem/sync.ts:58` | filters `status === "active"` for `--all` |
| preservation transport | `src/sessions/preservationTransport.ts:215` | filters `status === "active"` |

### Fixed in this change

| Surface | file:line | Change | Test |
| --- | --- | --- | --- |
| north star attention | `src/northStar/compute.ts:330` | `listProjects` now filtered to `active` | `tests/north-star-now.test.ts` — "excludes non-active Projects from the attention breakdown" |
| north star narrative | `src/northStar/narrative.ts:59` | `listProjects` now filtered to `active` | `tests/north-star-now.test.ts` — "excludes non-active Projects from narrative evidence" |
| way drift | `src/projects/wayDrift.ts:48` | `listProjects` now filtered to `active` | `tests/way-status.test.ts` — "excludes non-active Projects from the report" |

Consequence to note: the workspace `NORTH_STAR.md` targets `private-practice-now`.
With that Project paused, `arcadia now` now measures 0% attention to the target
instead of including the paused target's commits. That is the intended reading
of "paused Projects receive no automated attention"; reactivating the target
restores its measurement.

### Checked, deliberately not changed (Issues filed)

| Surface | file:line | Observed | Decision |
| --- | --- | --- | --- |
| setup-context `--all` | actual loop `src/commands/project.ts:791` via `src/commands/workMonitor.ts:15` | already active-only | no change; the cited `src/projects/contextSetup.ts:372,406` are single-Project resolvers for explicit targeting, not the portfolio loop |
| ask rules / project match | `src/ask/rules.ts:246`, `src/db/repositories.ts:662` | resolves paused Projects | not filtered: `resolveProjectReference` also validates Ask-rule destinations (`src/ask/rules.ts:156`); filtering would break Ask ingest for any rule targeting a paused Project. Issue #300 |
| docs sync `--all` | `src/commands/docs.ts:38` | ingests paused Projects | not filtered: document -> DB reconciliation is what proves the paused status agrees. Issue #299 |

Residual observed but not a stated criterion: `advance queue`'s global
`attention` list still surfaces historical runs/decisions belonging to paused
Projects (no non-Arcadia entry is `ready` or `pointerAuthorized`). Those are
in-flight/historical records, so they were left visible.

## Effect proof

- `pnpm arcadia production status --json`: `baseBranchAdvances` project slugs
  `["arcadia"]`; zero non-Arcadia slugs anywhere in the payload;
  `liveAdmissions: 0`.
- `pnpm arcadia advance queue --json`: `ready: 18` — every entry `project=arcadia`;
  the only `pointerAuthorized: true` entry is `arcadia`; `running: 0`,
  `flagged: 0`.
- `pnpm arcadia work monitor --no-pull-requests`: `Projects scanned: 1` (Arcadia),
  down from 8.
- Worker log `.arcadia/worker.log`: the repeated
  `Base branch observation failed for living-songbook` lines stop at
  `2026-09-17T23:17:29.404Z` (the pause landed at ~`23:17:30Z`); no further
  `[managed-production]` lines through `23:22:56Z`, while
  `worker.heartbeat` stayed fresh.

## Defects filed

- #298 — Agent Ask v1 cannot set a Project `status`; pausing/reactivating
  requires a hand edit of `PROJECT.md`. https://github.com/pmark/arcadia/issues/298
- #299 — `docs sync --all` ingests paused Projects; decide scope of portfolio
  reconciliation. https://github.com/pmark/arcadia/issues/299
- #300 — Ask routing still resolves paused Projects. https://github.com/pmark/arcadia/issues/300

## Tests added

- `tests/north-star-now.test.ts`: two tests proving non-active Projects are
  excluded from the attention breakdown and from narrative evidence.
- `tests/way-status.test.ts`: one test proving non-active Projects are excluded
  from `reportWayDrift`.

## `arcadia` Project

Untouched: DB `status = active`, `PROJECT.md` unchanged, no pause commit. It is
the only Project receiving automated work.

---
name: arcadia-rover-journey
description: Produce and publish the live rover-journey view of an Arcadia Plan or Action (past, now, obstacles, the operator's move, the way ahead). Use when reporting status, handing off, checking in on a Plan, or whenever the operator asks what is going on. Read-only; grants no authority.
---

# Rover journey

The rover journey is Arcadia's at-a-glance status view: each Action is a rover
on a path — launch, victories (PRs), obstacles cleared or still open, where it
is now, the review gate, its budget, and the way ahead — with the Plan, its
milestone and the North Star above it. It is derived read-only from workspace
records and checked-in documents; producing it never writes, launches or
decides anything.

## Produce it

Run from the Project's repository (in Arcadia's own checkout, `node --import tsx src/cli.ts` in place of `arcadia`):

| You need | Command |
| --- | --- |
| A whole Plan, one line per Action | `arcadia journey <project>/plan:current` or `<project>/plan:<plan-slug>` |
| One Action in detail | `arcadia journey <project>/current` or `<project>/<action-id>` |
| Machine-readable | add `--json` (`arcadia-plan-journey-v1` / `arcadia-journey-v1`) |

Read `activity.headline` (what the rover is doing), `activity.yourMove` (what
the operator can do, present only when the worker says a person is needed),
`run` (position in the production run) and open obstacles before writing any
status: report those, not your memory of them.

## Publish it

The operator reads the live views on the dashboard over Tailnet; they refresh
every 30 seconds with no agent involved:

- All Plans: `http://arcadia-1.alpine-rattlesnake.ts.net:3020/journey`
- A Plan: `http://arcadia-1.alpine-rattlesnake.ts.net:3020/journey/<project>/plan/<plan-slug|current>`
- An Action: `http://arcadia-1.alpine-rattlesnake.ts.net:3020/journey/<project>/<action-id|current>#now`

Put the matching full link (never `localhost`) in every status report,
check-in reply, handoff, Issue or PR comment about the work, next to a one-line
summary taken from the command output (headline, your move, run position).
When the operator must act now, the existing ping rule applies: one
`arcadia ping send --kind attention --link <journey or action URL>` stating the
move. Never ping for progress alone.

## Boundaries and fallbacks

- Read-only and exempt from activity recording; safe to run as often as needed.
- If the dashboard is unreachable, paste the text output of the command instead
  and say the live page was unavailable. If the command fails, report its error;
  do not reconstruct the view from memory.
- Hosts without shell access cannot produce it; say so and give the URL only.
- The view reflects records, not intentions: work outside managed production
  shows what the documents and records hold (for example "Parked" or "Done").

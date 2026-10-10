# Production console: decisions and backend gaps

Design note, 2026-10-09, for the `/production` dashboard page. It grants no
authority and changes no queue, pointer or production setting.

## Decisions

1. **One page, `/production`, consolidates instead of adding a fifth view.**
   `/runs` (to-do, production switch, Sessions), `/work-queue` (order),
   `/flight-deck` (read-only board) and Mission Control's agent queue each held
   part of "drive and monitor production". The page reuses their loaders and
   routes. They stay live and are linked from it; retire `/flight-deck` and the
   `/runs` Sessions section once the operator has used `/production` for a
   while. `/work-queue` keeps reordering and `/path` keeps the route to the
   target, since neither is about driving production.
2. **Order:** global strip, Sessions, Queue. The page holds production concerns only; operator
   to-dos stay on /runs and /review (operator direction, 2026-10-09). On the desktop Sessions and
   Queue sit side by side. The live work comes first because it is what
   changes minute to minute.
3. **Safe concurrent batches are numbered waves over the schedule's lanes.**
   `schedule status` already groups the ready set into one lane per
   repository, because the production policy grants one Session lease per
   repository. Batch *n* is the *n*-th ready Action of every lane, so the
   Actions in one batch never share a repository and may run side by side.
   Later batches are collapsed. The scope's `maxConcurrentSessions` is shown
   in the strip and is not re-derived in the browser.
4. **Dependencies read as "Waits on X".** These are unfinished `depends_on`
   Actions still in the queue; a dependency the queue no longer holds is done.
   A drawn graph is unreadable at 375px, and Plans are close to linear.
5. **The state chips** are Launching, Running, Stalled, Ready, Ready · make
   next first, Ready · repo busy, Waiting, Needs you, External blocker and Not
   ready. For Sessions: Launching, Running, Stalled, Exited · not reconciled,
   Exited, Failed, PR opened and Done. Every chip comes from recorded fields
   (`lib/production-console.ts`).
6. **Launch** only sequences existing routes. A make-next preview, confirmed,
   applies that exact receipt. Then comes the session-launch preview, which
   must name this Action (`plan/<plan>#<action>`) and be ready. A third
   explicit tap sends the POST with its fingerprint. The flow is tested
   against the real route handlers with a stubbed CLI.
7. **The production switch gained a confirmation step.** Off states that
   committed work keeps running. On first shows the saved scope from
   `production reactivate-preview` (a new read-only GET part).
8. **Pause is shown and disabled, never faked.** No safe backend exists (see
   gaps). Production Off is named as today's way to stop new unattended work.
9. **Data:** the page polls `?part=core` (production, worker, Sessions) every
   4 s while a Session is live and every 15 s otherwise. It polls
   `?part=queue` (about 1 MB of queue JSON, trimmed on the server) every 30 s,
   behind a 15 s stale-while-revalidate cache. The log tail fetches only the
   bytes appended since the last poll, every 3 s.
10. **Dark theme without touching other pages.** The palette became CSS
    variables with the original values. Only `data-theme-scope="auto"` (this
    page) follows `prefers-color-scheme`.

## Backend gaps

| Gap | Effect today | Smallest safe backend |
| --- | --- | --- |
| **Pause all.** No launch hold. | Production Off stops unattended admissions but revokes the grant, and On must replay it. Operator launches stay possible. | A workspace "launch hold" flag, checked by `issueAdmission` and operator `session launch`, that leaves the grant intact. It changes what agents may do, so it needs an operator-merged PR and a Decision. |
| **Per-Session pause/resume.** | Disabled. The only interrupt is Copy Reattach on the Mac. | `session pause <id>`: wait for a turn boundary, end the provider, and record an `incomplete_resumable` receipt with the lease kept. `session resume <id>` relaunches with the provider's native resume in the same worktree. Never SIGSTOP: provider streams time out, and the stall and lifetime guards would misfire. |
| **Live log.** | Read only if `<workspace>/.arcadia/sessions/<id>.log` exists (PR #1131, unmerged). Sessions launched without it show "No Session log recorded". | Merge #1131. |
| **Pane-classifier state per Session** (permission prompt, auth failure, provider limit). | Only Stalled is visible. | Expose `classifySessionState` in `dashboard runs`. |
| **Reviewing / merged states.** | PR link comes from the newest preservation receipt for the branch; review verdicts and merge are not joined. | Add independent-review verdict and merge state to the Session read model. |
| **Launch a whole batch.** | One Launch per Action. | A multi-launch bounded by the concurrency gate, after the concurrent-admission proofs are done. |
| **Launch of non-pointer Actions** moves the governed pointer. | Shown as step 1 with its own confirmation. | A launch-by-Action-ref that needs no pointer move. |

## Backend change in this PR (read-only)

`arcadia dashboard runs --sessions <n>` adds `recentAgentSessions`. Every
Session now carries `endedAt`, `exitStatus`, `exitOutcome`, `exitReason` and
`pullRequestUrl`, read from `agent_sessions`, `session_exit_receipts` and
`candidate_preservation_receipts`. It writes nothing, and it does not change
what agents may do.

## Next: a Project-first page (2026-10-09)

The operator found the flat Action queue disorienting: Actions with no visible
Project or Plan, in an order nobody chose on purpose. The page should answer
three questions, top-down: which Projects are running, on which Plan, and what
runs next. An adversarial review then tested the design for several Sessions
at once, so that going from one Session to many changes no concept.

- One card per included Project, numbered in the operator's order. The number
  is a preference. A separate chip states the fact from the worker's last tick:
  `Running`, `Next up`, `Waiting for a free Session`, or `Skipped: <reason>`
  (needs you, repository busy, no ready Action, ceiling reached).
- Each card shows its Plan, progress toward done, the next Action as
  `Would pick now · as of <time>`, `Locked in <time>` once a Session starts,
  and Sessions and tokens this week.
- A `Needs you` section above the order lists blocking to-dos from
  `arcadia todo --json`, each with an `Answer` link. Excluded Projects fold
  into `Not running`. Rehearsal fixtures are marked test only.
- Order changes use `Move to top` with an Undo toast, because order is a cheap
  preference until lock-in. Include, Stop running, Plan choice, Sessions at a
  time, and On/Off each confirm on the page and state their consequence.
- It works at 375px.

The first read-only slice has shipped: a Projects view, the Queue section's
default tab, with one card per Project. Each card shows its pointer Plan with
open and ready counts, what production would pick now, a state chip
(`Running`, `Next up`, `Ready`, `Needs you`, `Repository busy`, `Waiting`,
`Blocked`, `Nothing authorized`) with its reason, the escalations Arcadia
recorded for that Project, and its other active Plans. Projects the production
scope does not admit fold into `Not in the production scope`. Cards follow
each Project's first position in today's queue, and the page says so. Launch
stays on the card's next Action.

Still to come, read-only: `Would pick now · as of`, the latest tick skip reason
per Project, Needs you from `arcadia todo --json`, and Sessions this week. The
controls wait on Decisions 0115-0118 and on a preference record the operator
can change while production is on. (Decisions 0103 and 0111, on burn and the
reserve, are answered.)

# Runs redesign: verified surface audit

Companion evidence to [the information architecture proposal](../proposals/runs-page-information-architecture.md).

## Verified operation map

Cadence below is inferred from the requested daily flows and the operator guide,
not measured engagement telemetry. All judgment and script launches are performed
by the operator; agents and the worker produce the items and execution evidence.

| Current surface | Operations and likely cadence | API / authoritative writer |
| --- | --- | --- |
| `/runs`: approval queue | Browse pending Agent Asks and managed Decisions; expand rationale, gate, cost, effects and alternatives; Accept/Reject an Ask; approve the recommended or another Decision option. Daily, also via notification. | GET `/api/approvals` calls `agent-ask pending` and `decision list --status open`; POST uses `decision approve` or fingerprinted `agent-ask settle`. |
| `/runs`: operator scripts | Browse running/failed, recent ready, older ready, completed one-shot; Run/Retry; observe latest status. Daily or recovery-driven. No search, per-script detail, launch detail or history. | GET/POST `/api/operator-script`; validated main-checkout descriptors, detached runner, launch locks and `runs/state/<id>.json`. |
| `/runs`: production | On/Off; observe worker/provider/board/alerts; inspect This push lanes, order, token points, stops/review boundary and Next push; follow board/Decision links. Daily and stop/recovery-driven. | GET `/api/production-control?part=core\|queue\|alerts`; POST activate/deactivate through CLI using recorded scope and expected revision. |
| `/runs`: Sessions and Runs | Observe active Sessions and execution Runs; Copy Reattach/Resume; open Run; expand latest 10 recent Runs. Daily during work. | `/api/runs?recent=0\|10`, CLI `dashboard runs`; active polling 5s, idle 30s with failure backoff. |
| `/runs/[id]` | Read Run evidence, steps, executor output, changed files, validation, follow-up Decision; retry eligible Run; answer follow-up review. Per result or failure. | `/api/runs/[id]`, output endpoint and Run retry endpoint; `/api/review-action` for follow-up. Preserve unchanged URLs. |
| `/review` | Search; ranked focused board; select another item; inspect excluded items; edit persisted Project focus; preview/cancel/confirm outcomes; approve, approve & execute, reject, refine with required feedback, defer with required trigger, answer option/free text; reassess clarification, flag for agent review; automatically continue answered clarification; receipt; optionally review and settle completed Action. Daily/notification-driven. | `/api/snapshot`; `/api/review-action`, `/api/clarify-action`, `/api/review-focus`; `/api/action-settlement` only on explicit review. `lib/needs-you.ts` ranks and excludes duplicates/history. |
| `/work-queue` | Filter Project/readiness; read next Action/reasons/blockers; Top/up/down, batch reorder, preview/apply, cancel, undo; Make next with pointer fingerprint; recover stale revision. Occasional steering. | GET/POST `/api/work-queue`, canonical queue and pointer writers; optimistic revision and idempotent request id. |
| `/flight-deck` | Read Project/Plan × five-state grid, including unattached records and recent evidence; refresh and follow navigation. Portfolio inspection. | `/api/work-queue` + `/api/snapshot`; no writes. |
| Chrome/sidebar | Navigate to portfolio, Project, capture, QA, PR and admin surfaces. Every visit. | Chrome has 12 icons in three rows at 390px. Sidebar has a different primary list and eagerly fetches `/api/mission-control` even while closed. |

Evidence: the named pages, hooks, `components/dashboard-ui.tsx`,
`lib/arcadia-cli.ts`, `lib/operatorScriptRunner.ts`, API routes,
`tests/e2e/batch-push-view.spec.ts`, `needs-you-board.spec.ts`, and `START_HERE.md`.
Live inspection found 162 approvals and eight failed script cards; a single
approval consumes most of the first phone viewport, and production and active
work remain below the queue behind collapsed disclosures. This is a snapshot,
not a target count. No live approval, toggle or script was executed.

Important corrections to the initial description:

- Approval listing is **two** CLI calls in parallel; the slowest-call claim
  needs a latency measurement. The script list polls every 3s even when empty;
  approvals every 15s while expanded. The two initial requests do not describe
  ongoing cost.
- Opening production mounts all three part fetches and polls them every 20s.
  Next push is already in the queue payload even while its disclosure is closed.
- Opening Sessions fetches active work; history is the latest ten, without
  pagination, and joins the active poll while open.
- Descriptor problem/success/failure are validated by the backend but omitted
  from GET. The runner discards stdout/stderr and overwrites latest state.
  Scripts own their timestamped directories and differing receipt formats; the
  runner currently has no reliable binding from a launch to that directory.
- A managed Decision number and a review-item database id are different
  identities. An Ask card's `id` is a **proposal id**, not its stable request id.
  Ask options can describe proposed Decisions or activation choices; they must
  never become the Ask's Accept/Reject disposition.

## Request budgets

Count dashboard API requests on a cold direct navigation, before the first
scheduled poll; exclude HTML, Next assets and route prefetch. Also assert zero
requests to hidden concerns after a poll interval. The fixture measurement in [baseline-requests.json](../qa/runs-information-architecture/baseline-requests.json) confirms the initial-request baseline; **after values are
acceptance budgets, not measured results**. One HTTP request may still contain
multiple CLI calls: report subprocess count and latency separately.

| Page / interaction | Before API requests | After budget and what is requested |
| --- | --- | --- |
| `/runs` cold, disclosures closed | 2: approvals + script library | 3: active Runs with small attention-count projection; production core; This push only. No approval list, script descriptors, snapshot or history. |
| `/runs`, production expanded | +3: core/queue/alerts | +1 only when detailed alerts open; Next push fetches +1 only when opened. |
| `/runs`, Sessions expanded | +1 active; history open adds +1 including latest ten | Active already visible; History navigation is 1 paginated history request, no active poll. |
| `/review` | 1 broad snapshot, repeated by adaptive poll | 1 scoped judgment board request including focus/counts/metadata; no Runs, script logs, or full snapshot. CLI work belongs to this requested route. |
| Judgment item | No individual page | 1 scoped detail request; preview on demand if not prepared; answer 1 mutation + 1 scoped refresh; no list poll. |
| `/actions` | Library GET on `/runs`, repeated every 3s | 1 library summary request with search fields; conditional poll only if a displayed row runs; no logs or CLI. |
| `/actions/[id]` | No page | 1 descriptor/current-state request; +1 paginated history only when opened. |
| Script launch page | No page | 1 combined launch state/receipt/bounded output request, conditional poll while running. Launch POST precedes navigation and returns runId. |
| `/work-queue` → `/runs/queue` | 1 queue GET | 1 queue GET; mutations keep existing preview/apply refresh flow. |
| `/flight-deck`, standalone under More | 2: queue + broad snapshot | 1 scoped queue/evidence projection; never fetch the full snapshot for five evidence sections. |
| More / closed sidebar | Chrome 0; sidebar +1 mission-control request | 0; drawer context loads only when displayed. |
| `/runs/[id]` | Detail and executor-output requests (conditional) | Preserve existing behavior and URLs; no new cross-page polling. |

Attention counts reuse the active Runs CLI projection's bounded aggregate
query and a filesystem summary for running/failed scripts. No second approvals
shellout on Runs merely to draw badges. Counts include freshness; if their
source is unavailable show “Count unavailable”, never zero. Scoped judgments,
history pagination and scoped evidence belong in CLI projections, not direct
Dashboard DB access or another governance store. Verify existing CLI readers
first and extend them only where required.

### Script launch evidence contract

Keep latest state as a compatibility projection and one-shot guard. Add a
server-generated immutable launch identity and exclusive per-launch directory,
with append-only started/finished events and a persisted descriptor/authority
snapshot. Final result includes exact start/finish/exit and output/receipt
references; latest-state updates never erase earlier attempts.

Bind the script-owned timestamped log directory deterministically, not by
“newest directory after launch”. Reuse an existing script runner convention if
one exists; otherwise pass a **host-generated** run directory through the
environment and update the generated library's scripts to honor it. The runner
captures stdout/stderr even for a script that exits before writing its own log.
Expose allowlisted receipt/log/handoff files from that launch; differing old
receipt formats remain readable text. Legacy latest-state records appear as
legacy evidence with missing fields explicit; do not fabricate past launches.

Only the script id reaches POST: no browser commands, arguments, paths or
environment. Keep same-origin validation, id validation, descriptor and
executable checks, lock/recheck guards and successful one-shot refusal.
Every read resolves real paths under the configured main library and the
bound script/launch; reject traversal, symlinks outside it, another script's
launch and malformed ids. Bound output bytes, cursor and polling frequency.
GETs read, never launch. Running evidence polls only while displayed, stops on
terminal/unmount/hidden document and resumes safely on return. A missing/dead
launcher yields a truthful failure handoff rather than endless Running.


## Governance handoff

The placement picker input is preserved under `.arcadia/asks/archive/`.
Canonical settlement created Decision 0077; the operator's answers were recorded
with `decision approve`: keep Flight Deck standalone under More and On/Off
visible on Runs. This host has a resolvable workspace; it is not the
workspace-less container described in the request. No Plan has been activated,
and the existing Project pointer and queue remain unchanged.

Phase 2 takes these answers and the operator's canonical-hierarchy clarification
as constraints. The newly keyed `plan-phone-dashboard-judgment-actions-runs-2026-09-29-v2`
Ask previews exactly three dependency-ordered Actions. Its first slice preserves
all eight original Decision deep-link and Discord criteria. The old deep-link
proposal and the intermediate pre-clarification draft are retired as superseded;
their inputs remain archived. Acceptance preview fingerprint
`124b628b9f8e396e9e4365310ca7f82ed8f7dc601ae57639f439d647035108c5`
creates only an inactive draft Plan, with Agent responsibility. Acceptance is
awaiting the operator; it grants no dispatch or queue placement.

The placement settlement initially used the host Git author. Its unpushed
candidate commit was corrected to Cody Atlas; tag
`archive/identity-correction-95e76ea33` preserves the original SHA referenced
by the canonical receipt. The Decision answer and all subsequent agent commits
use the semantic agent identity.

Planning proof: dashboard production build, dashboard Vitest suite, and `tests/e2e/runs-ia-baseline.spec.ts`; full functional Playwright runs and changed-page screenshots belong to each build slice, when those routes exist.

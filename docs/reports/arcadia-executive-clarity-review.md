# Arcadia Executive Clarity Review

Date: 2026-07-02

Scope: read-only executive and architecture review of the Arcadia repository at commit `829cd30`.

Method: every material claim below cites repository files, tests, or prior in-repo audit evidence. This review did not modify existing code, install dependencies, run tests, or contact external services; where behavior is asserted, the evidence is source code, test assertions, CI configuration (`.github/workflows/ci.yml`), and the recorded verification runs in `docs/mission-control/daily-use-loop-audit.md` (2026-06-27). Items that could not be verified without executing the suite are labeled as such.

---

## 1. Executive Summary

Arcadia is closer to a usable daily mission control system than its own top-level `PROJECT.md` suggests (which still reads "Mission needs definition", status `incubating`). The core loop — capture natural language, resolve it deterministically into an Action or a safely-parked idea, gate Codex planning behind a persisted Decision, run it through a managed worker, validate the output, and record Artifacts and Logs — is implemented, schema-backed, and covered by roughly 300 unit/integration tests plus an eight-scenario Playwright suite that drives the real dashboard at a 390×844 phone viewport (`tests/e2e/mission-control.spec.ts`). CI runs both suites on every push (`.github/workflows/ci.yml`). The critical trust gaps identified in the excellent 2026-06-27 daily-use-loop audit — no persisted approval Decision, a worker that could falsely mark failed runs complete, provider commands rendered as UI — have been closed in code (`src/execution/planningAuthorization.ts`, `reduceExecutionOutcome` in `src/commands/worker.ts`, `tests/decision-gated-planning.test.ts`).

The main risk is no longer missing foundations; it is divergence. The last six commits are all **Arcadia Intelligence v0.1**, a second, parallel job system (own tables, own worker, own artifact store, own HTTP API, own dashboard section) that serves companion apps like Rebuster — not the daily loop. It is well-scoped and disciplined (`docs/intelligence/V0_1_SCOPE.md` is a model of restraint), but it duplicates vocabulary (jobs vs Runs, intelligence artifacts vs Artifacts, two "workers", two meanings of "capability") and it is absorbing the effort that the daily loop needs to cross from "works in tests" to "used every day."

The second risk is that Arcadia has never been fully adopted by its own operator. The dogfood workspace machinery exists (`docs/dogfooding.md`, `arcadia init --profile arcadia`), but the committed self-management artifacts are placeholders. A system whose purpose is steady visible progress cannot prove itself without a real portfolio inside it.

The smallest credible v1 is therefore not a build project; it is an adoption project with a short hardening tail: seed the real workspace, run the existing loop daily for two to three weeks, feed every deterministic-routing miss into the existing Golden Request Suite process (`docs/reports/golden-request-suite.md`, `tests/goldenRequests.ts`), and fix only the frictions that daily use surfaces — starting with the known ones (no ask idempotency, duplicated capture surfaces, manual ingress scheduling).

What should wait: the Intelligence Gateway plan (budgets/quotas/policy engine — explicitly unimplemented, `docs/plans/arcadia-intelligence-gateway/README.md`), completing the Blogging capability pipeline, broad ingestion, knowledge graphs, autonomous agents, and any schema/vocabulary migration. Frontier models should remain optional subcontractors: plan drafting and critique behind the existing Decision gate, periodic portfolio synthesis, and proposing (never applying) new intent-registry entries. Approval, publication, spending, and project status remain Mark's.

Seven executive decisions are listed in section 10; the two that unblock the most are (1) declaring the daily loop the only "Now" product center and freezing Intelligence at v0.1, and (2) committing to a dated, measurable dogfooding trial as the v1 acceptance bar.

*(≈470 words)*

---

## 2. One-Sentence Product Definition

Arcadia is a local-first, SQLite-backed mission control CLI and phone-friendly dashboard that turns one busy creator's incoming ideas and obligations into auditable Actions, Decision-gated executions, and durable Artifacts across a portfolio of projects.

## 3. Mission Statement

Help Mark maintain steady, visible progress across many simultaneous creative and software projects with minimal cognitive overhead, by making the next artifact, the next action, and the items that genuinely need his judgment always one glance away — and by executing everything else through the cheapest safe deterministic path.

(This is consistent with the mission already encoded in `AGENTS.md`, `CONSTITUTION.md`, and `config/defaults/operator-context.md`.)

## 4. Desired Outcomes

1. **Every project is visible.** `arcadia project list` / dashboard `/projects` answers "what exists and what state is it in" in under ten seconds, from a phone.
2. **Every capture lands somewhere auditable.** Any idea, request, or obligation entered through CLI, dashboard, Discord, or an Apple Shortcut file becomes an Action, a Decision, or a recoverable Back Burner item — never silence, never an invented task.
3. **The next artifact is always named.** Each active project carries a current Milestone and an explicit Next Action pointing at a concrete artifact.
4. **Only judgment reaches Mark.** The Review queue contains only real Decisions (approve/reject/defer/clarify); safe deterministic work runs without him.
5. **Nothing executes on trust.** Codex work runs only against a persisted, digest-verified, approved Decision; failed execution or validation can never appear "completed."
6. **History is durable and local.** Every Run leaves a Log, its Artifacts are linked rows with files on disk, SQLite is authoritative, and Git preserves the narrative.
7. **The system degrades gracefully without models.** Status, queues, reports, weekly reviews, and deterministic skills all work with no LLM configured.
8. **Brief phone sessions are first-class.** Capture, review, approve, and status-check all work at a 390-pixel viewport without horizontal overflow.

---

## 5. Current-State Evidence Map

### 5.1 The conceptual model actually implemented today

The operational center is one pipeline, shared by every ingress surface:

```text
CLI ask / dashboard POST /api/ask / Discord /arcadia request / file ingress
  → normalizeAskInput → resolveIntake → intent registry → stewardIntent   (all deterministic, no model calls)
  → one of:
      direct status/project command
      Back Burner item (vague input)
      Decision (clarification / unsafe / setup)
      Action + plan + Codex planning packet + open planning Decision
  → review approve → queueApprovedPlanningRun (atomic, digest-checked)
  → worker claims Run → Action-plan runner → planning Validation
  → final Artifact + Validation Artifact + Log → acceptance/recovery Decision
```

Key files: `src/commands/ask.ts`, `src/intake/index.ts`, `src/intent/resolver.ts`, `src/stewardship/index.ts`, `src/execution/planningAuthorization.ts`, `src/execution/runner.ts`, `src/commands/worker.ts`, `src/dashboard/snapshot.ts`. Persistence: 22 tables in `database/schema.sql` plus migration-added tables in `src/db/schema.ts`.

The canonical vocabulary is defined in `docs/arcadia-semantics.md` (Domain, Project, Mission, Outcome, Milestone, Action, Artifact, Decision, Log; Responsibility values Autonomous / Codex / Needs Mark / Blocked; Project statuses Active / Paused / Incubating / Completed) and matches the required project model in this review's brief almost exactly. Legacy schema names (`work_items`, `review_items`, `back_burner_items`, `projects.goal`) are explicitly documented as frozen compatibility names — a deliberate and sound choice.

### 5.2 Subsystem evidence table

| Subsystem | Center | Key evidence | Tests |
| --- | --- | --- | --- |
| Workspace + schema | SQLite authoritative, Markdown generated | `src/workspace/initWorkspace.ts`, `database/schema.sql`, `src/db/schema.ts` (versioned migrations) | `tests/phase0.test.ts` |
| Deterministic intake / ask | shared NL front door, no model calls | `docs/intake.md`, `src/intake/`, `config/defaults/intent-registry.json` | `tests/intake.test.ts`, `tests/phase3.test.ts`, `tests/goldenRequests.ts` |
| Decision-gated planning | persisted approval, digest check, truthful outcomes, retry lineage | `src/execution/planningAuthorization.ts`, `src/commands/run.ts` (retry), `reduceExecutionOutcome` in `src/commands/worker.ts`, schema columns `review_items.artifact_id`/`codex_invocation_id`, `execution_runs.retry_of_run_id` | `tests/decision-gated-planning.test.ts` (7 tests incl. bypass, duplicate approval, migration dedupe, orphan recovery), `tests/e2e/mission-control.spec.ts` (8 browser tests) |
| Planning validation | deterministic content validator | `src/stewardship/artifactValidator.ts`, `src/stewardship/critic.ts` | `tests/planning-artifact-validator.test.ts`, `tests/planning-artifact-workflow.test.ts`, `tests/stewardship-*.test.ts` |
| Reporting | status, weekly review, mission logs | `src/markdown/*.ts`, `src/commands/report.ts`, `src/commands/review.ts` (weekly) | `tests/cli-response.test.ts`, `scripts/smoke.ts` |
| Dashboard (Mission Control) | read-mostly Next.js adapter delegating to CLI | `apps/dashboard/` (nav: Control, Projects, Review, Back Burner, Runs, Intelligence — `components/chrome.tsx`), `apps/dashboard/lib/arcadia-cli.ts` | `tests/dashboard-snapshot.test.ts`, e2e suite |
| Discord bot | thin adapter, no approval-of-work from Discord | `apps/discord-bot/` (~2.2k LOC) | `tests/discord-bot.test.ts` (largely mocked CLI boundary) |
| File ingress | Apple Shortcuts → `~/ArcadiaIngress/<source>/In/` | `src/commands/ingress.ts` | `tests/ingress.test.ts` |
| Codex Companion observer | read-only observation of Codex tasks | `src/codex/observer.ts`, `artifacts/codex-companion-architecture.md` | (thin) |
| Capability modules | modular-monolith plugin seam: Blogging, Rebuster bridge | `src/capabilities/`, `docs/capabilities-blogging-v1-plan.md`, `docs/rebuster-arcadia-contract.md` | `tests/blogging-capability.test.ts`, `tests/rebuster-capability.test.ts` |
| **Arcadia Intelligence v0.1** | separate structured-generation job service for companion apps | `src/intelligence/` (own repository, worker, routing, artifact store, HTTP API, client), `docs/intelligence/V0_1_SCOPE.md`, dashboard `/admin/intelligence` | `test/intelligence/` (14 test files) |
| CI | fast (unit+builds) and e2e jobs on every push | `.github/workflows/ci.yml` | — |

Scale for context: ~28.7k LOC in `src/`, ~5.5k in the dashboard, ~2.2k in the Discord bot, ~12.8k of tests.

### 5.3 Coherence findings (Review Question A)

**One product center exists** — the ask→Decision→Run→Artifact pipeline above — and, since the 2026-06-27 audit, its worst incoherence (two execution engines with different truth rules, approval that wasn't persisted) has been repaired at the planning path. That is a genuine, evidence-backed improvement: compare the audit's "Critical" findings with `tests/decision-gated-planning.test.ts` and the e2e assertions that a Decision must predate invocation and that failed validation can never read "completed."

**Accumulated parallel systems** (in descending order of concern):

1. **Arcadia Intelligence v0.1 is a second product in the same repo.** It has its own job lifecycle (`intelligence_jobs`), its own worker (`src/intelligence/jobs/worker.ts`), its own artifact store with its own ID scheme (`iart_…`, `src/intelligence/artifacts/store.ts`) separate from the `artifacts` table, its own retry semantics, its own API server, and its own dashboard section. Its scope doc is exemplary, but it does not touch the daily loop: no intelligence job creates an Action, Decision, Run, Artifact row, or Log in the mission-control sense. Recent commit history (`5d1365b`…`829cd30`) is entirely Intelligence work.
2. **Two execution engines still exist.** The Action-plan runner (`src/execution/runner.ts`) is now the authoritative planning path; the generic review executor (`src/execution/reviewExecutor.ts`) remains for legacy Decision-triggered execution, with corrected outcome reduction but different artifact/log semantics. The decision-gated plan (§2.5 of `docs/mission-control/decision-gated-planning-run-plan.md`) deliberately kept it; it should eventually shrink or retire.
3. **The capability-module layer is a third seam**, partially implemented: Blogging declares `create_brief` and `record_published` commands that have no implementation or tests (documented honestly in `docs/capabilities-blogging-v1-plan.md`).
4. **Planning-artifact-only docs**: the Intelligence *Gateway* plan (`docs/plans/arcadia-intelligence-gateway/`, 13 files) is a not-yet-implemented design that partially overlaps the implemented v0.1 service; the README flags this, which helps, but two "intelligence" designs coexist.

**Terms likely to confuse a human or a coding agent:**

| Term | Collision |
| --- | --- |
| "capability" | capability modules (`src/capabilities/`) vs Intelligence request `capability` field (`text.generate`) |
| "artifact" | mission-control `artifacts` rows vs Intelligence `iart_` artifacts vs the repo's `artifacts/` docs folder |
| "worker" | `arcadia worker start` (run queue) vs the Intelligence in-process job worker |
| "job" vs "Run" | Intelligence jobs are conceptually Runs but share nothing with `execution_runs` |
| "review" | `review_items` (Decisions) vs `arcadia review weekly` (a report) vs "Requires Review" (a queue/status) |
| "packet" | demoted in semantics doc but load-bearing in code and UI |
| "dogfood" | compatibility command namespace for what is now just a normal workspace |

**Smallest stable vocabulary to preserve** (recommendation): **Project, Mission, Status, Milestone, Action, Responsibility, Decision, Run, Artifact, Log.** Two canonical terms are currently aspirational and can be parked: **Domain** has no schema table or UI surface (doc-only), and **Outcome** is the `projects.goal` compatibility column surfaced as display text. Neither should gain new machinery before daily use proves the ten-term core.

---

## 6. Daily-Loop Capability Matrix (Review Question B)

Legend — **T**: implemented and tested; **F**: implemented but fragile/incomplete; **D**: documented but not implemented; **P**: proposed only.

| Loop stage | Status | What exists | Gaps / evidence |
| --- | --- | --- | --- |
| Capture | **T** / F at edges | CLI `ask`/`capture`/`inbox`, dashboard `/` and `/capture` → `POST /api/ask`, Discord `/arcadia request`, Apple-Shortcut file ingress (`src/commands/ingress.ts`) | No idempotency key on `/api/ask` (retries duplicate requests; no dedup logic found in `apps/dashboard/app/api/ask/route.ts` or `src/commands/ask.ts`); `/` and `/capture` duplicate the same behavior with different presentation; ingress requires manual/launchd scheduling by design |
| Intent resolution | **T** (narrow by design) | Deterministic Intake + intent registry + stewardship; Golden Request Suite regression process (`tests/goldenRequests.ts`, `docs/reports/golden-request-suite.md`) | Pattern-based: anything unrecognized falls to Back Burner. Safe (never invents work — verified for the ambiguous-Pinterest case in e2e test 6) but means real-world phrasing coverage grows only via dogfooding |
| Project selection / creation | **T** | Alias/fuzzy/recent-activity resolution from SQLite (`src/intake/`); `project create/import`, templated `InstantiateProject` intents | Vague inputs mentioning a project name don't retain the association (audit Scenario A) |
| Work classification | **T** | Responsibility values autonomous/codex/needs_mark/blocked on Actions; canonical display names migrated (`docs/reports/semantic-vocabulary-migration-note.md`) | — |
| Planning | **T** | `execution_plans`/steps; Codex planning packets with digest, critique, safety boundaries (`src/codex/packets.ts`, `src/stewardship/critic.ts`) | Only the planning flavor is first-class; build/implementation flow is gated but less traveled |
| Approval | **T** (new since audit) | Persisted `CodexPlanningRunApproval` Decision created at capture; atomic `queueApprovedPlanningRun`; runner-level `authorizePlanningRun` with digest verification; duplicate approval returns existing Run; bypass attempts throw (`tests/decision-gated-planning.test.ts`, e2e tests 1–2) | Legacy generic review approval path retains older semantics |
| Execution | **T** / F | Worker claims queued Runs, dispatches planning Runs to the Action-plan runner; deterministic safe skills run synchronously; fake-executor e2e harness (`tests/e2e/fixtures/fake-planning-executor.cjs`) | Two engines remain (§5.3); worker is poll-based and must be started manually; not verified by execution in this review (deps not installed) — CI is the enforcement point |
| Verification (Validation) | **T** | Deterministic planning-artifact validator; truthful outcome reducer (exit≠0 → failed; failed validation → requires_review, never completed — `src/commands/worker.ts:117`); project validation commands via metadata | Generic review executor validation is command-based and thinner |
| Artifact recording | **T** / F | Final plan upserted as Artifact, linked via `run_artifacts`; unique (run, artifact) index; e2e test 4 asserts linkage + `/api/file` 200s; status-report Artifact asserted in e2e test 7 | Historic gaps (pathless expected artifacts) addressed for the planning path; other deterministic skills' provenance should be spot-checked in daily use |
| State updates | **T** / F | Action status/queue/responsibility transitions per the state-transition contract (plan §4); milestone create/complete; every terminal Run gets a Log | Project lifecycle status changes are manual only (by design for now); no staleness detection |
| Needs Mark surfacing | **T** | `/review` + Attention built from actual actionable Decisions; CLI `review`/`inbox attention`; Discord Requires Review notifications with dedup | Attention/`/review` parity asserted in e2e test 5 |
| Phone-first review | **T** | Playwright suite runs entirely at 390×844 (`playwright.config.ts`); overflow assertions; mobile shell + 6-tab nav | LAN-only reachability (`apps/dashboard/README.md`); nothing when away from home network except file ingress via iCloud |
| Portfolio visibility | **T** / F | `status`, `report status`, `review weekly` (deterministic), `project list`, dashboard Projects/Momentum pages | No single compact "everything, one screen" command-center density check against a *real* portfolio yet; weekly review exists but unproven as a habit |

**Documented but not implemented (D):** Intelligence Gateway (budgets/quotas/policy), Blogging `create_brief`/`record_published`, Domain as a real grouping.
**Proposed only (P):** everything in `docs/plans/arcadia-intelligence-gateway/10-future-executors-and-companion-apps.md`.

---

## 7. The Smallest Credible Arcadia v1 (Review Question C)

**Thesis: v1 is the existing slice, adopted.** No foundation needs rebuilding. The repository already contains a compact command center (`/` Attention + snapshot), capture and resolution (ask/intake), active-project views, a real Decision review queue, safe execution visibility (Runs + truthful outcomes), and Artifact/Log recording — each with tests. What it lacks is a real portfolio, a daily cadence, and the small frictions only daily use exposes.

**V1 definition (2–4 weeks, mostly operations plus small Codex missions):**

1. **Green baseline.** Confirm `pnpm test`, `pnpm build`, `pnpm dashboard:build`, and `pnpm test:e2e` pass locally and in CI on `main` (CI config exists; this review could not execute it). Make CI green a hard merge gate.
2. **Real workspace.** `arcadia init <real-workspace> --profile arcadia`; import Mark's actual projects with mission, status, current milestone, next action via `project import` / `project metadata`. Replace the placeholder mission in the workspace's Arcadia project (the committed `PROJECT.md` placeholder is a symptom, not the store — SQLite is authoritative).
3. **Daily loop, phone + desk.** Morning: dashboard `/` or `arcadia status`. Capture through `ask` (dashboard/Discord/Shortcut). Review queue worked from `/review`. Weekly: `arcadia review weekly`.
4. **Routing-miss ratchet.** Every request that lands in Back Burner but shouldn't have becomes a Golden Request Suite entry + registry fix (the process already exists: `docs/reports/golden-request-suite.md`).
5. **Friction fixes only, smallest first:** idempotency key on `/api/ask`; collapse `/capture` into `/`; a documented launchd/cron recipe for `ingress process` and `worker start` (samples in `scripts/`); one-command session start (`status` + queue + attention in one output — mostly exists as `status`).

**Explicitly not in v1:** any new Intelligence capability, any schema rename, any new adapter, Blogging pipeline completion, Domain, and any model-in-the-loop routing.

**V1 acceptance bar (proposed, measurable):** ten consecutive operating days in which (a) each day starts from the command center, (b) at least one capture per day resolves to a completed Run, a Decision, or a deliberate Back Burner park, (c) zero occasions where Mark must open SQLite or read source to answer "what's next," and (d) the Golden Request Suite gained at least five new real-world entries.

---

## 8. Explicit Non-Goals and Deferred Work (Review Question D)

| Deferred item | Why attractive | Prerequisite before starting |
| --- | --- | --- |
| Intelligence Gateway (budgets, quotas, virtual keys, policy engine — `docs/plans/arcadia-intelligence-gateway/`) | Feels like "the platform" | A second real companion app hitting v0.1 limits in practice; v1 daily loop stable |
| Broad second-brain ingestion (notes, mail, browser, transcripts) | Promise of total capture | Deterministic intake proven on *deliberate* captures first; a triage habit that survives volume |
| Knowledge graphs / embeddings over the workspace | Sophistication | A corpus worth graphing — months of real Logs and Artifacts |
| Autonomous agents / continuous orchestration | Progress-while-sleeping fantasy | A long record of Decision-gated runs with near-zero false completions; explicit per-project autonomy policy from Mark |
| Generalizing the capability/plugin system | Clean architecture itch | Two *fully finished* modules (Blogging is ~60%: Brief/Published stages unimplemented per its own plan doc) |
| Finishing Blogging `create_brief`/`record_published` | Nearly done | Blogging being an Active project in the real workspace with actual posts flowing |
| More adapters (email, SMS, other chat) / remote access beyond LAN | Reach | Phone-first loop proven on the surfaces that already exist; a deliberate remote-access security decision |
| Dashboard elaboration (charts, momentum analytics, admin panels) | Dashboard gravity | Evidence from daily use about what's actually glanced at; `/momentum` and `/admin/intelligence` already exceed the loop's needs |
| Vocabulary/schema migration (`work_items`→actions etc.) | Neatness | Post-v1; the semantics doc's compatibility strategy is correct — additive aliases only, and only when something else forces a migration |
| Local model integration | Local-first purity | A specific routine task where a local model beats the deterministic path; Intelligence v0.1 already gives the seam |
| Microservices / daemons / queues beyond SQLite polling | "Real" infrastructure | An observed operational failure of the current worker model, not a hypothetical one |

---

## 9. Frontier-Model Role and Boundaries (Review Question E)

The repo's own hierarchy (`AGENTS.md`: scripts → local AI → frontier; Codex only for code) is right. Concretely:

**1. High-leverage occasional uses (justify a frontier model):**
- Drafting Codex planning packets' *content* — already the design; always behind the persisted planning Decision and deterministic validator.
- Weekly portfolio synthesis: a frontier pass over the deterministic weekly review + Logs producing a *drafted* narrative Artifact (never mutating state), submitted through Intelligence v0.1 as an ordinary job.
- Critique: reviewing a failed plan's validation evidence and proposing a revision, attached as a drafted Artifact on the recovery Decision.
- Intent-registry growth: given a week's Back Burner misses, *propose* new registry entries and golden tests as a diff for Mark's review — never live routing.

**2. Routine work that stays deterministic/local:** intent resolution and project routing (already model-free by design — `docs/intake.md`), status/weekly reports, queue and attention views, validation, notification formatting, classification of Responsibility, all state transitions.

**3. Always Needs Mark:** approving any Decision; accepting any plan; publishing, deploying, merging, spending, credentials, messaging (the boundary list already embedded in packets and `config/defaults/operator-context.md`); changing a Project's lifecycle status; deleting or archiving anything.

**4. Model work that must stay plan-first and approval-gated:** every Codex build/implementation run; any model output that would become a committed file or a state change (it lands as a *drafted* Artifact plus a Decision, exactly like the planning path's acceptance Decision). The enforcement mechanism already exists — `authorizePlanningRun`'s refusal-by-default and the truthful outcome reducer — and should be the template for any future model-executed work type.

**Anti-pattern to keep refusing:** any path where a model output changes state without a persisted Decision, and any "smart" fallback where routing silently escalates to a paid or cloud model (v0.1 already forbids this: typed `blocked` failures, no escalation — `docs/intelligence/V0_1_SCOPE.md`).

---

## 10. Executive Decisions for Mark (Review Question F — max 7)

**D1. Declare the daily loop the sole "Now" center; freeze Arcadia Intelligence at v0.1.**
*Why now:* the last six commits are all Intelligence; the loop is one adoption push from real. *Default:* freeze — v0.1 serves Rebuster as-is; bug fixes only. *Easier once decided:* every backlog dispute resolves by "does it serve the loop?" *Don't build until decided:* any new Intelligence capability, gateway features, admin-UI growth.

**D2. Commit to a dated dogfooding trial as the v1 acceptance bar.**
*Why now:* the system has never held Mark's real portfolio; every remaining unknown (routing coverage, phone ergonomics, report usefulness) is only discoverable in use. *Default:* the ten-day bar in §7, starting within a week of a green CI baseline. *Easier:* prioritization becomes empirical. *Don't build until decided:* speculative UX work, new adapters.

**D3. Set the capture-fallback policy for unrecognized input.**
*Why now:* deterministic intake will miss a lot of real phrasing at first; today's fallback is Back Burner. *Options:* (a) keep Back Burner + a daily triage pass (recommended — safe, already tested), (b) create a Needs Mark Action for every miss (noisier queue), (c) frontier-assisted interpretation behind a Decision (later). *Easier:* defines the triage habit and the registry-growth loop. *Don't build until decided:* any model-in-the-loop capture.

**D4. Decide phone reachability scope.**
*Why now:* "works from a phone" currently means "on home LAN, or async via iCloud file ingress." *Options:* (a) LAN + Shortcuts ingress + Discord for away-status (recommended for v1 — zero new security surface), (b) Tailscale/WireGuard to the home machine (small, sane next step), (c) hosted anything (later, big decision). *Easier:* fixes expectations for the trial. *Don't build until decided:* auth, sync, hosting.

**D5. Park Domain and Outcome as machinery; keep the ten-term core.**
*Why now:* prevents coding agents from "helpfully" building Domain tables or Outcome workflows the loop doesn't need. *Default:* Domain stays doc-only; Outcome stays a display field on Project. *Easier:* smaller vocabulary for humans and agents. *Don't build until decided:* domain grouping UI, outcome tracking features.

**D6. Choose the fate of the legacy generic review executor.**
*Why now:* it is the last second-truth-system in the execution path; every new work type will ask which engine to use. *Options:* (a) route all future executable Decision types through the Action-plan runner pattern and let the generic executor atrophy (recommended), (b) invest in unifying now (premature). *Easier:* one enforcement point (`authorizePlanningRun` pattern) for all future model work. *Don't build until decided:* Codex *build* execution as a first-class flow.

**D7. Define Arcadia's own mission and status in the real workspace (and stop shipping placeholders).**
*Why now:* the committed `PROJECT.md`/`MISSION_LOG.md` say "Mission needs definition"/`incubating` — corrosive to trust in the tool's own model. *Default:* adopt the mission wording from `docs/dogfooding.md` ("Build Arcadia into a local-first mission control system…"), status Active, milestone = the v1 trial. *Easier:* the dogfooding loop has a real anchor project. *Don't build until decided:* nothing blocked, but do it first — it takes five minutes.

---

## 11. Prioritized "What Remains" Backlog

Classifications use the repo's Responsibility values. Sequence is the recommended order within each horizon.

### Now — make the daily loop dependable

| # | Item | Outcome enabled | Class | Expected artifact | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| N1 | Verify green baseline: run full `pnpm test` + builds + `test:e2e` on `main`; enable branch protection requiring CI | Trustworthy foundation for everything else | Autonomous (run) + Needs Mark (protection setting) | CI runs green; protection enabled | Both CI jobs green on `main`; merges blocked on red | — |
| N2 | Seed the real workspace: init with `--profile arcadia`, import full project portfolio with missions, statuses, milestones, next actions, metadata (repo paths, validation commands) | Outcomes 1–3; D2, D7 | Needs Mark (content) + Autonomous (commands) | Populated workspace DB; first real `reports/status.md` | `project list` shows every real project with a truthful status and next action | N1 |
| N3 | Ten-day dogfooding trial per §7, with a one-page operating log | Empirical priority signal; v1 acceptance | Needs Mark | `docs/reports/v1-dogfooding-log.md` (in workspace or repo) | Bar in §7 met or misses enumerated | N2, D2 |
| N4 | Add idempotency key to `POST /api/ask` / `ask` (client-supplied or content+window hash) | Safe phone capture on flaky connections (Outcome 2) | Codex | Code + test | Double-submit of identical request creates one `ask_requests` row; test proves it | N1 |
| N5 | Collapse `/capture` into `/` (one canonical capture presentation) | Simpler phone surface (Outcome 8) | Codex | Code + e2e touch-up | One capture entry point; e2e still green | N1 |
| N6 | Golden-suite ratchet: convert each trial routing miss into `tests/goldenRequests.ts` entries + registry fixes | Growing deterministic coverage (Outcome 2) | Codex (fixes) + Needs Mark (which misses matter) | Updated suite + `docs/reports/golden-request-suite.md` addendum | ≥5 new real entries; suite green | N3 |
| N7 | Scheduling recipe: documented launchd/cron units for `ingress process` and `worker start` in `scripts/` | Captures and approved runs progress without a terminal open | Autonomous | Script/plist samples + README section | Shortcut file processed and approved Run executed with no interactive shell | N2 |

### Next — increase usefulness after the loop works

| # | Item | Outcome enabled | Class | Expected artifact | Acceptance criteria | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| X1 | Stale-project detection: deterministic flag in status/weekly review for Active projects with no Action/Log in N days | Portfolio honesty (Outcome 1) | Codex | Code + tests + report section | Weekly review lists stale Actives with suggested status change (Mark decides) | N3 |
| X2 | Route future executable Decision types through the planning-runner pattern; shrink `reviewExecutor.ts` (per D6) | One truth system for execution (Outcome 5) | Codex | Refactor + tests | All executable Decisions pass `authorizePlanningRun`-style checks; legacy path unreachable or deleted | D6 |
| X3 | Codex build flow brought to planning-path parity (Decision-gated, digest-checked, acceptance Decision) | Implementation work through the same trusted loop | Codex | Code + e2e scenario | Build run cannot start without approved Decision; failed build never "completed" | X2 |
| X4 | Weekly frontier synthesis job (drafted narrative over weekly review + Logs) via Intelligence v0.1 | High-leverage model use (§9.1) | Codex (plumbing) + Needs Mark (accept each draft) | Job template + drafted Artifact + acceptance Decision | Draft appears as drafted Artifact with Decision; nothing auto-published | N3, D1 |
| X5 | Remote reachability per D4(b) if chosen (Tailscale doc, no code) | True away-from-home phone loop (Outcome 8) | Needs Mark (security) + Autonomous (setup) | SETUP.md section | Dashboard reachable from phone off-LAN through private overlay only | D4 |
| X6 | Finish Blogging module (Brief, Published/Logged stages) *iff* blogging is Active in the real workspace | First fully-finished capability module | Codex | Actions, CLI, tests per its plan doc | Declared commands implemented + tested; a real post flows Idea→Published | N3 signal |

### Later — explicitly deferred investments (see §8 prerequisites)

| # | Item | Class | Blocking prerequisite |
| --- | --- | --- | --- |
| L1 | Intelligence Gateway (budgets/quotas/policy/keys) | Blocked | Second real companion app hitting v0.1 limits |
| L2 | Broad ingestion (notes/mail/transcripts) | Blocked | Triage habit + intake coverage proven at deliberate-capture volume |
| L3 | Knowledge graph / embeddings over workspace | Blocked | Months of real Logs/Artifacts corpus |
| L4 | Autonomy expansion (unattended model execution) | Blocked | Long false-completion-free record + explicit per-project policy from Mark |
| L5 | Vocabulary/schema migration to canonical names | Blocked | A forcing change; then additive-alias strategy per `docs/arcadia-semantics.md` |
| L6 | Plugin system generalization / more capability modules | Blocked | Two finished modules |
| L7 | Local model routes in Intelligence | Blocked | A specific routine task where local beats deterministic |
| L8 | Hosting/auth/multi-device sync | Blocked | D4(c) deliberately decided |

---

## Appendix: Verification Notes and Labeled Inferences

- **Not executed in this review:** `pnpm test`, builds, and the Playwright suite (dependencies are not installed in this environment and the review brief forbids installing them). Statements that tests "cover" behavior are based on reading the test source and assertions; statements that the suite "passes" rest on `.github/workflows/ci.yml` existing and on the recorded runs in `docs/mission-control/daily-use-loop-audit.md` (275 tests passing on 2026-06-27, pre-Intelligence commits). Confirming a green baseline is backlog item N1 for exactly this reason.
- **Inference:** "Intelligence work is displacing loop work" is inferred from commit history (`15f9153`…`829cd30`) — six consecutive Intelligence commits following the e2e/decision-gating work — not from any statement of intent in the repo.
- **Inference:** the claim that the dogfood workspace is not in real use is inferred from the placeholder committed `PROJECT.md`/`MISSION_LOG.md` and the git-ignored `.arcadia-workspace/`; an actively used local workspace would be invisible to this review. If one exists, N2/N3 shrink accordingly but the acceptance bar still applies.
- **Recommendations** (sections 7–11 defaults, vocabulary parking, executor consolidation) are labeled as such and are choices for Mark, not repository facts.

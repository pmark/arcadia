---
arcadia: v1
type: log
slug: arcadia-mission-log
project: arcadia
updated: 2026-08-17
---

# Mission Log: Arcadia

## 2026-08-17 — Named the four governance gaps behind the PPN shim

- **Did:** Operator raised four concerns: that a project's next action should be
  distinguishable from the portfolio's, that every project must share code and
  policy controlled by this repository, that no formal path exists for a
  project's agent to request a Way change, and that `vision`, `horizon`,
  `prime_directive`, and a real definition of Milestone are missing. Verified
  each before answering. One was a misread — `demo-first-delivery` is
  `project: arcadia`, so the Action shown was Arcadia's own, though its
  acceptance criteria are written almost entirely in PPN nouns, which is why it
  read otherwise. The other three are real, and running `arcadia portfolio`
  surfaced a fourth nobody had named: `portfolio` and `next` report **different
  current milestones for the same Project**, because the DB carries a
  project-level milestone matched on ingest while dispatch reads the plan's.
  Ran `/menu` over all four.
- **Result:** Decision 0025 drafted on the operator's own redirect — a Way-change
  request travels as a `type: proposal` document committed in the project's own
  repository and arrives via `docs sync`, needing no new channel, which is
  consistent with Decision 0022's git-only rule. `proposal` is already a valid
  `DOC_TYPES` entry, `discoverDocs` already scans the whole repository, sync
  already matches documents to their project, and `portfolio` already renders
  "Waiting on you" — the pipe runs end to end and only the last inch is
  missing. Decision 0026 drafted defining a Milestone as a named outcome that
  outlives the plan pursuing it, owned by the Project and referenced by id, with
  the current Milestone derived rather than stored so the two commands cannot
  disagree. Decision 0027 drafted admitting `prime_directive` and `horizon` and
  **rejecting** `vision`, because `ProjectDoc.outcome` already carries it. New
  `way-delivery` plan created at `status: draft`, holding the rehomed
  `open-way-sync-pull-requests` — stranded since yesterday in a `complete`
  plan — and a new `accept-upstream-proposals` Action.
- **Next:** Nothing dispatched. Three Decisions await ratification, and
  `way-delivery` does not displace `demo-first-delivery` unless the operator
  moves the pointer.
- **Blockers:** None. Noted for a later pass: `arcadia portfolio` reports 11
  Decisions waiting for Arcadia and 10 for PPN, plus two malformed review items
  (R36 carries a bare code fence as its title), and Martian Rover still has no
  `repo_path` configured.

## 2026-08-17 — Answered three governance questions from one menu

- **Did:** Built a `/menu` skill that gathers pending operator items — open
  Decisions, plan questions, recorded blockers, stale pull requests — into one
  multiple-choice pass with each option's consequence stated, then acts on the
  selections. Ran it against this repository's actual state. Four items were
  pending; the operator answered all four.
- **Result:** Decision 0022 approved in its strict form: git is the only channel
  between Arcadia installations, a hosted Arcadia is rejected, and committed
  coordination records stay available but unadopted. Decision 0023 approved
  within that narrower space: `current_action` stays stored, one dispatched
  agent per repository becomes an enforced precondition, deriving the pointer is
  rejected, and parallel dispatch in one repository is an accepted limit.
  Decision 0024 written and approved for `propagation-authority`, unblocking
  `open-way-sync-pull-requests` after two days: mechanical tiers auto-merge,
  governing tiers always need a human, and Arcadia's new write authority over
  other repositories is scoped to generated paths by six stated guardrails.
  `open-way-sync-pull-requests` moved from `blocked`/`question_open` to
  `open`/`clarified` with acceptance criteria. None of the three authorizes
  code.
- **Next:** Rebase PR #74 onto `main` per the operator's fourth answer, recording
  the workspace-free `arcadia docket` as ad-hoc work rather than an Action on the
  now-complete `arcadia-way-propagation`.
- **Blockers:** `open-way-sync-pull-requests` is now clarified but lives in a
  plan whose status is `complete`, so it needs rehoming before it can dispatch.
  Not invented here — recorded for the operator.

## 2026-08-17 — Drafted the two Decisions that gate running agents in the cloud

- **Did:** Operator asked what Arcadia's architecture becomes under growing
  adoption, given that coding agents commonly run in cloud containers while
  Arcadia is local-first. Two questions came out of that discussion as the ones
  that change shape depending on when they are answered, and both were drafted
  as Decisions rather than left in conversation. Not a plan Action — operator-
  directed architecture work, and `demo-first-delivery` is untouched.
- **Result:** Decision 0022 asks whether an Arcadia installation ever
  coordinates directly with another, recommending that git is the only channel
  and rejecting a hosted Arcadia other installations call. Decision 0023 asks
  whether `current_action` survives concurrency as a stored value,
  recommending it stays stored with one dispatched agent per repository
  enforced as a dispatch precondition — reusing the unmerged-branch signal
  `arcadia work monitor` already computes — and rejecting a derived pointer
  because a tiebreak rule is an ordering heuristic standing in for the
  operator's judgment, which the continuation protocol forbids. 0023 depends on
  0022 and says so. Both `status: open`; neither authorizes code.
- **Next:** Nothing dispatched. Both Decisions need operator ratification, and
  0022 must be answered before 0023 is meaningful.
- **Blockers:** PR #74 (`arcadia docket`, workspace-free) is still open and now
  conflicts with `main`, which took #73 first and closed
  `arcadia-way-propagation`. Its plan Action and log entry target a plan that
  is now `complete`.

## 2026-08-16 — Closed arcadia-way-propagation: fixed the drift `arcadia way` found in Arcadia itself

- **Did:** Completed `stop-duplicating-a-canonical-protocol-on-adopter-zero`.
  `adoptContinuationProtocol` now treats an unmarked existing file whose body
  already equals the canonical text as the managed region itself rather than
  a project-authored section to double below it. Proving that against
  Arcadia's own worktree surfaced a second, worse defect the acceptance
  criteria's "twice" existed to catch: the canonical continuation-protocol
  source is read from Arcadia's own repository root, which is also the
  adopted target whenever setup runs against Arcadia itself, so after the
  first run the "canonical" copy already carried the markers this function
  was about to add again -- every later run nested another pair around the
  previous run's own output.
- **Result:** Fixed by unwrapping one layer of markers from the canonical
  body before rewrapping it, so the body used for adoption is always plain
  text regardless of self-reference. Verified for real: three consecutive
  `setup-context` runs against a fresh worktree checkout now produce a
  byte-identical `docs/agent-continuation-protocol.md` (confirmed by md5),
  with exactly one marker pair and no TRIAGE section. A repository whose
  protocol genuinely differs still gets it preserved under TRIAGE, unchanged.
  3 new tests in `tests/arcadia-way-propagation.test.ts`. This closes
  `arcadia-way-propagation`'s milestone -- `arcadia way` makes staleness
  visible rather than silent, and this was the one defect it found.
  `open-way-sync-pull-requests` stays open, genuinely blocked on the
  unanswered `propagation-authority` question; it does not gate the
  milestone as written. The pointer returns to `demo-first-delivery` /
  `build-demo-hero-vertical-slice`.
- **Next:** `build-demo-hero-vertical-slice` on `demo-first-delivery` -- a
  large, `session`-effort, cross-system dashboard Action, not started here.
- **Blockers:** None for this Action. `open-way-sync-pull-requests` remains
  blocked on the operator answering `propagation-authority`.
## 2026-08-16 — Gave a project the ability to answer its own docket

- **Did:** Way-verification testing in PPN put a session in a cloud container,
  where `pnpm arcadia docket` failed. Diagnosed it as structural rather than a
  bad path: PPN's `scripts/arcadia.mjs` shells `pnpm arcadia next` with `cwd`
  set to the Arcadia checkout and `--workspace` set to the martianrover
  database, neither of which exists in a container, while its sibling
  `triggers` is pure-local and worked fine. Confirmed `resolveDispatch` in
  `src/docs/dispatch.ts` imports only `node:fs`/`node:path` and computes the
  entire answer from checked-in documents — the database was doing a slug
  lookup, a back-burner count, and journaling, none of them load-bearing.
  Operator directed fixing it once in Arcadia for every project rather than
  patching PPN. Recorded as ad hoc operator-directed work, not a plan Action:
  it was written against `arcadia-way-propagation`, which closed in #73 before
  this landed, and the operator chose on 2026-08-17 to rehome it here rather
  than reopen a plan whose milestone was already met.
- **Result:** `arcadia docket [--repo <path>]` resolves the pointer,
  executability fields, and blockers with no workspace and no database.
  `next` and `docket` share one renderer, so they cannot describe the same
  state differently. Verified against PPN with no workspace flags: resolves
  `intake-to-deployed-site-integration` / `record-integration-verdict`,
  responsibility `codex`, zero blockers. Five new tests build a repository in a
  temp directory with nothing beside it. Also recorded that this plan's own
  `repo-context.md` deferral named "a second machine or a CI job needs to read
  these files" as its trigger — that trigger fired here, so the item is now
  overdue rather than deferred.
- **Next:** The pointer was not moved by this work. Packaging Arcadia so the
  command exists in a container at all is deferred behind a stated trigger on
  `arcadia-way-propagation`.
- **Blockers:** None.

## 2026-08-16 — Made the recurring Node ABI mismatch self-healing

- **Did:** Operator hit `SQLITE_NATIVE_ABI_MISMATCH` again running
  `pnpm arcadia docs sync --apply` right after merging #71, against Homebrew's
  node 25.6.1 rather than the mise-pinned 22.23.1 -- the same class of failure
  a freshly created worktree hit earlier the same session, fixed there only by
  a manual `mise install && mise exec -- pnpm rebuild better-sqlite3`. Asked
  how to avoid it forever rather than re-running the documented manual fix
  each time. Diagnosed that this machine has Homebrew node, nvm, and volta all
  coexisting on `PATH`, so which `node` a plain `pnpm arcadia` resolves to is
  not reliable. Not a plan Action -- ad hoc operator-directed infrastructure
  work.
- **Result:** `postinstall` now runs `mise exec -- pnpm rebuild better-sqlite3`
  after every `pnpm install`, and the `arcadia` package.json script runs under
  `mise exec --`, so `pnpm arcadia ...` always executes with the pinned Node
  regardless of ambient shell `PATH` state. Verified by forcing Homebrew's
  node to the front of `PATH` and confirming `pnpm arcadia way` still ran
  clean. #72.
- **Next:** `stop-duplicating-a-canonical-protocol-on-adopter-zero`, unchanged
  by this fix.
- **Blockers:** None.

## 2026-08-16 — A read-only way to tell whether a project is stale on the Way

- **Did:** Completed `report-way-drift`. Added `arcadia way`, a noun command
  that reports per registered project whether its adopted `CONSTITUTION.md`,
  `AGENTS.md` managed region, and `docs/agent-continuation-protocol.md` still
  match Arcadia's own canonical text, and what its `.arcadia/arcadia-way/adoption.json`
  `upgrade_policy` declares. It reuses `setup-context`'s own pure generator
  functions (`updateAgentsMarkdown`, `adoptContinuationProtocol`) to detect
  drift rather than writing a second definition of "adopted": a file is
  current exactly when regenerating it from the canonical source reproduces
  its own bytes. A project with no `repo_path`, or an unreachable one, is
  reported `unknown` rather than assumed current.
- **Result:** `src/projects/wayDrift.ts` and `src/commands/way.ts`, wired into
  the CLI as `arcadia way`. Run against Arcadia itself it correctly reported
  `CONSTITUTION.md` and the shared region as current and the continuation
  protocol as drifted — exactly the still-open
  `stop-duplicating-a-canonical-protocol-on-adopter-zero` defect, not a false
  positive, which is the first real evidence the tool works. 6 new tests in
  `tests/way-status.test.ts`; full suite otherwise unaffected (826 passing, 4
  pre-existing failures in `tests/narrative-digest-schedule.test.ts`
  reconfirmed failing identically on `main`, untouched by this change).
- **Next:** `stop-duplicating-a-canonical-protocol-on-adopter-zero` — fix the
  drift `arcadia way` just found in Arcadia's own repository.
- **Blockers:** None. `open-way-sync-pull-requests` stays parked behind its
  open question (`propagation-authority`); this Action does not resolve it.

## 2026-08-16 — Ran the Way's own generator at Arcadia, and it broke three ways

- **Did:** Completed `give-arcadia-its-own-context-files` by running
  `arcadia project setup-context` against this repository. The command failed
  outright, then damaged the repository on its second attempt, so the Action
  became a repair as much as an adoption. Committed `.arcadia/`'s three context
  files — the ones the shared `AGENTS.md` region has been telling every agent to
  read before broad exploration, and that Arcadia alone did not have. Fixed
  `readAdoptedFile`, which resolved Arcadia's own repository root with a fixed
  `../..`: right for `src/projects/`, wrong for `dist/src/projects/`, so the
  built CLI read every governance file back as `null` and setup refused,
  claiming `docs/agents-context.md` was missing from the repository that
  authors it. Fixed `thinClaudeWrapper`, which read the presence of
  `@AGENTS.md` as proof a `CLAUDE.md` was entirely generated and so replaced
  this repository's own with the bare wrapper; it now strips only what the
  generator writes and returns `null` when anything survives.
- **Result:** Adopter zero holds the context files it prescribes, and the two
  defects that reached that conclusion are fixed with two regression tests
  pinning the destructive one — including one asserting that setup declines to
  overwrite Arcadia's actual `CLAUDE.md`. A real `setup-context` run now reports
  `claude: null` and leaves the file byte-identical. The adopter-zero suite is
  17 passing. Four failures in `tests/narrative-digest-schedule.test.ts` are
  pre-existing and were confirmed failing at the base commit with this change
  reverted; they are untouched by it.
- **Next:** `report-way-drift` — a read-only command reporting which adopting
  projects are stale, and the first thing that would have caught all of this
  without a write.
- **Blockers:** None. The third defect found — first adoption appending a
  second copy of a continuation protocol Arcadia itself authored — is
  non-destructive and recorded as
  `stop-duplicating-a-canonical-protocol-on-adopter-zero` rather than fixed
  beside a data-loss bug.

## 2026-08-16 — Made Arcadia adopter zero and found the Way had no way back

- **Did:** A fresh-session orientation test against Private Practice Now, run to
  check whether the adopted protocol is legible to a cold agent, surfaced that
  the shared managed `AGENTS.md` region was a string literal in
  `src/projects/contextSetup.ts` while Arcadia's own `AGENTS.md` was hand-written
  and exempt from the generator entirely. That is how the noun/verb naming rule
  came to exist in every adopting repository and nowhere in Arcadia. Opened
  PR #65 stating the rule here, then PR #66 moving the shared text to
  `docs/agents-context.md`, read by `readAdoptedFile()` exactly as
  `CONSTITUTION.md` and `docs/agent-continuation-protocol.md` already were, and
  putting Arcadia's own `AGENTS.md` between the same markers every adopter uses.
- **Result:** One statement of the shared contract, in a reviewable document
  rather than a code diff, with a test asserting Arcadia's managed region equals
  the canonical file byte for byte. Two rules already canonical in the protocol
  document are promoted into the always-loaded region: the executable-Action
  conditions including `open` is executable, and naming the session, model, and
  effort the next batch needs. Adopter zero immediately earned its keep — the
  shared region tells agents to read three `.arcadia/` context files Arcadia does
  not have.
- **Next:** `docs/plans/arcadia-way-propagation.md` carries three Actions: give
  Arcadia its own context files, report Way drift without writing, and propagate
  Way changes as pull requests rather than merges. Activated on operator
  direction the same day: `active_plan` is now `arcadia-way-propagation` and
  `current_action` is `give-arcadia-its-own-context-files`.
  `demo-first-delivery` stays `active` with every Action intact, but its
  `current_action` was removed, since exactly one Action may be current across
  the project and a second declaration is reported as a competing objective.
  Resuming it is a pointer change: restore
  `current_action: build-demo-hero-vertical-slice`, which is still `open`.
- **Blockers:** `open-way-sync-pull-requests` is `question_open` on
  `propagation-authority`: which tiers of Way change may propagate automatically,
  and whether Arcadia's CI gets push access to every project repository. Settled
  already and recorded in the plan: generation is safe and automatic application
  is not, so the automatic unit is a pull request per repository, never a merge.

## 2026-08-15 — Dogfooded Arcadia Now and captured its first vertical slice

- **Did:** Used a manual Arcadia Now briefing to orient the operator through
  unusual open work across Arcadia and Private Practice Now. The operator
  reviewed and merged PPN PR #39, then selected the desired product shape: the
  same concise explanation in a phone-friendly web view or Discord, followed
  by a dynamic option menu whose consequences are explicit and whose common
  case is one button that safely advances governed state. Recorded approved
  Decision 0017 and made Arcadia Now the Pareto-first Action in the existing
  draft portfolio continuity plan.
- **Result:** The experience now has a controlled implementation contract:
  deterministic orientation, one primary option only when live state earns
  one, typed and allowlisted operations, invocation-time revalidation,
  idempotency, receipts, and preserved approval gates. Web is first; Discord
  carries the summary and deep link; native Discord buttons are deferred until
  the shared transition contract survives one live trial.
- **Next:** Activate `portfolio-continuity-view` at
  `build-arcadia-now-vertical-slice` when the operator explicitly prioritizes
  it over `demo-first-delivery`, or when the current demo-first Action is
  accepted.
- **Blockers:** None in definition. Implementation remains intentionally
  undispatched so this capture does not silently move Arcadia's active work
  pointer.

## 2026-08-15 — Turned missed attention and portfolio disconnection into governed future work

- **Did:** Recorded approved Decisions 0015 and 0016 and drafted two separate
  managed plans without moving Arcadia's active work pointer. Decision 0015
  uses GitHub pull requests and one `arcadia:attention` issue per external
  operator task as the durable bridge from disconnected cloud Projects into
  Arcadia's existing Discord delivery path. Decision 0016 defines one
  portfolio continuity projection—Past, Now, Next, and Later—and a visible
  capture receipt whenever tangential work appears in conversation. The plans
  preserve the Pareto slices and name the expensive YAGNI tail explicitly.
- **Result:** The Private Practice Now copy-review and Cloudflare-setup misses
  now have a controlled implementation path, while the broader inability to
  see planned, active, deferred, and Incubating work is preserved as its own
  Outcome rather than being smuggled into notification code. Both plans are
  draft, carry no `current_action`, and therefore cannot displace or dispatch
  around `demo-first-delivery`'s current `build-demo-hero-vertical-slice`.
  Each plan names the condition that should cause it to be reconsidered.
- **Next:** Review both draft plans after the current demo-first Action is
  accepted, or explicitly reprioritize sooner if another operator-attention
  miss or the portfolio-disconnection pain becomes the dominant constraint.
- **Blockers:** None in planning. Implementation remains intentionally
  undispatched; activating either plan is a separate priority choice.
## 2026-08-15 — Removed avoidable model calls from pull-request QA

- **Did:** Merged the independently approved minimal PR-QA Candidate in PR #55,
  then completed Decision 0019's streamlining slice. `arcadia qa pr` now refuses
  draft, unchecked, pending, non-successful, conflicting, dirty, or blocked
  Candidates before patch retrieval, reviewer selection, sandbox preflight,
  model invocation, Artifact creation, or Decision creation. It revalidates the
  full mutable evidence snapshot immediately before the model call and skips
  judgment if the snapshot moved. The CLI workspace-precedence regression now
  runs from a unique temporary directory instead of assuming the repository
  root cannot contain the dogfood `.arcadia-workspace`. Captured the durable
  Arcadia-led development vision and evidence-triggered increments in
  `docs/arcadia-development-orchestration-vision.md`.
- **Result:** Twelve focused PR-QA tests and the 88-test combined QA/CLI suite
  pass. Managed-document validation and the dogfood suite pass. The production
  build succeeds, and the CI-equivalent UTC suite covers 804 passing tests with two
  intentional skips. Running the full suite in Pacific time also exposed a
  pre-existing digest-fixture assumption about UTC date labels and Log windows;
  that unrelated repair is deferred until the next digest scheduling change or
  a non-UTC CI lane is introduced.
- **Next:** Publish and independently QA this exact Candidate, then resume
  `build-demo-hero-vertical-slice` for Private Practice Now.
- **Blockers:** None. Automatic invocation and notifications, richer proof,
  managed QA Runs, GitHub posting, patch staging, token telemetry, automatic
  repair, and consequential transitions remain deferred under Decision 0019's
  observable triggers and existing approval boundaries.

## 2026-08-15 — Arcadia QA independently reviewed its first real pull request

- **Did:** Implemented `arcadia qa pr <github-pr-url>`. The command resolves a
  configured Project, pins the initial head SHA, captures the PR body, changed
  files, complete patch, merge state, and every GitHub check, selects the
  least-cost compliant read-only reviewer through Arcadia's provider adapters,
  requires a strict structured verdict, revalidates the SHA, and persists a QA
  report Artifact plus a revision-bound Decision. Added deterministic fixtures
  for contradictory evidence, Pass gating, and same-revision receipt reuse.
- **Result:** Dogfooding against Arcadia PR #54 at `82b50cf` produced Needs
  follow-up, Artifact `art_3b368492148c4f639c`, and Decision `R44`. The report
  found the planning scope and approval boundaries coherent but refused Pass
  because the duplicate `fast` checks conflict and current database-backed
  validation remains incompletely evidenced. Repeating the command returned
  the same hardened receipts in 1.1 seconds without another model call. The
  first implementation Candidate then correctly failed its own review on PR
  #55 instead of being promoted: that failure drove an evidence-only sandbox
  that denies home and network access, exact-SHA patch retrieval, complete
  evidence revalidation, and SHA-verified reusable receipts. The second
  Candidate also correctly failed: its structurally shallow verdict validation
  and unconstrained criterion coverage could still admit an unsupported Pass.
  The resulting contract now proves its sandbox at runtime, validates every
  nested verdict field, and requires exactly one result for each of seven fixed
  review criteria before Pass is possible. The third Candidate found one more
  fail-open path: a coordinated edit could alter both cached receipt data and
  its colocated hashes. The cache now contains no verdict data; reuse rebuilds
  the result from the independent Decision context and cross-checks its
  Artifact, status, source, fingerprint, paths, and hashes before trusting it.
  The fourth Candidate exposed ambiguity in a failed network probe: ordinary
  connectivity failure could look like sandbox denial. The preflight now first
  proves that exact auth, Git control, and GitHub network controls are readable
  by the host, then requires the configured sandbox to deny those same controls
  while reading evidence; either baseline or sandbox mismatch fails closed. The
  fifth Candidate passed every substantive criterion but required direct test
  evidence for the host-baseline failure branch, which now proves that neither
  the sandbox nor reviewer runs and the observed baseline failure is preserved.
- **Next:** Resume `build-demo-hero-vertical-slice`. For PR #54, resolve the
  pull-request-event workspace isolation failure, then explicitly rerun QA on
  the unchanged revision or let a repaired revision receive a fresh automatic
  identity.
- **Blockers:** None in minimal PR QA. Dashboard/Discord delivery, local test
  reruns, browser proof, repair, GitHub posting, managed Run integration, and
  release automation remain deferred under Decision 0018's evidence triggers.

## 2026-08-15 — Promoted minimal independent PR QA from expectation to current work

- **Did:** Recorded the operator's explicit decision to build critical Arcadia
  capabilities when Private Practice Now naturally needs them. Added approved
  Decision 0018, split the immediately useful pull-request review path from the
  later browser- and release-oriented Arcadia QA program, and moved the active
  pointer to `establish-minimal-pr-qa`.
- **Result:** The current Action now requires one CLI command that freezes a PR
  revision, gathers deterministic GitHub evidence, runs a separate read-only
  structured review, and persists a QA report Artifact and revision-bound
  Decision. Arcadia PR #54 is the first real Candidate. Dashboard, Discord,
  repair, release, merge, browser proof, and managed Run integration remain
  deferred against concrete evidence triggers.
- **Next:** Implement and dogfood `arcadia qa pr` against PR #54, which must
  report the contradictory push and pull-request CI results without claiming
  Pass.
- **Blockers:** None. The operator explicitly reprioritized this Action; the
  demo hero resumes after it is accepted.

## 2026-08-08 — Digests now compose and post themselves, for every Project

- **Did:** Closed `schedule-portfolio-digests`, the last Action in
  `narrative-digests`. Added `src/digests/schedule.ts` (the one place that
  decides which window is due), `arcadia digest run --if-due` and
  `arcadia digest mark-posted`, portfolio-scoped composition alongside the
  existing per-Project composer, and `apps/discord-bot/src/digests/scheduler.ts`
  to deliver the results. Migrated `narrative_digests` to carry a scope, a
  nullable `project_id`, a NULL-safe `scope_key` deduplication identity, and a
  delivery record — a table rebuild, since SQLite cannot drop a NOT NULL or add
  a UNIQUE key in place.
- **Result:** Answered the plan's open `digest-window-boundaries` question the
  only way the acceptance criteria permit: calendar-aligned, local, and always
  the period that has already finished. A rolling lookback would move the same
  day's activity between digests depending on restart timing, and digesting the
  period in progress would compose it near-empty and never revisit it, because
  the once-per-period guard would already be satisfied. The guard itself is the
  stored `(scope, period, window)` row rather than a second schedule ledger, so
  there is nothing that can disagree with it — that one choice gives
  idempotency, missed-tick catch-up, and pending-delivery retry for free.
  Failure isolation is per subject and per cadence: one Project's unreachable
  local model costs that Project's digest and nothing else, and a failed vault
  export is a warning on a digest that still posts. 21 focused tests cover each
  acceptance criterion; full suite otherwise green, with two pre-existing
  failures untouched by this change (`tests/obsidian-memory.test.ts` atomic-write
  case, and `apps/dashboard/lib/intelligence.test.ts` which needs a built
  `dist/`).
- **Next:** None in this plan — it is complete, and so is its milestone. The
  work pointer moves to `demo-first-delivery`, activated at
  `build-qa-queue-vertical-slice`; it was already drafted from operator
  direction on 2026-08-01 under approved Decision 0007, so this follows a
  recorded decision rather than choosing a milestone on the operator's behalf.
  `portfolio-docs-protocol`'s `narrative-summarization` was explicitly not
  picked up: it is deferred under Decision 0004 against a trigger that has not
  fired, and taking it would have routed around that deferral just to keep a
  pointer non-empty.

## 2026-08-07 — Pinned the model on every agent handoff

- **Did:** Added Decision 0010 and made `recommended_model`/
  `recommended_reasoning_effort` real, parsed plan fields instead of decorative
  ones only one plan ever used. `arcadia go --apply --agent <x>` now resolves
  the launch model from `--model`, else the plan's recommendation, and refuses
  to launch a session unpinned when neither exists. Effort follows the same
  precedence but stays optional. Added `--model`/`--effort` CLI overrides.
- **Result:** The gap this closes was found live: an operator asked `go` to
  hand off to a new session, then asked which model it would use — and the
  honest answer was that nothing chose one, and the plan being handed off
  didn't declare a preference either. Now every `--agent` handoff carries a
  stated, recorded model choice or refuses with a named remedy. The model
  check deliberately runs after the fast-forward, since a plan's own
  recommendation must be read from its state *after* the merge that may have
  just introduced it — proven true immediately: the calling project's plan
  had no recommendation until a commit inside the very merge being
  reconciled added one. That ordering means an unresolved model does not
  roll back an already-completed worktree retirement; Decision 0009 already
  treats retiring the source and preparing the next worktree as independent
  outcomes, and the refusal message says explicitly nothing needs to be
  undone. Full suite green (760 passed, 2 skipped, 74 files) after the change.
- **Next:** None queued for this decision. The operator separately raised a
  larger request — a managed coding-agent job queue with monitored execution
  and Discord alerting on activity needing input — which is out of scope here
  and needs its own investigation before any design.

## 2026-08-05 — Made coding-agent continuation one safe command

- **Did:** Added the preview-first `arcadia go` command and approved Decision
  0009. It validates a named finished worktree, strict fast-forward ancestry,
  agent-owned branch identity, and the repository's exact Arcadia dispatch
  before changing anything. On `--apply` it advances the local base, retires
  only the clean merged source, and can prepare a uniquely named Codex or
  Claude Code worktree from that updated local base. Created one personal
  Agent Skills-compatible `arcadia-go` skill shared by Codex and Claude Code.
- **Result:** The branch-already-attached failure no longer requires manual Git
  recovery. Dirty, detached, divergent, non-agent-owned, and ceremonially
  blocked repositories refuse without mutation. Seven temporary-repository
  tests cover preview, safe linked and primary-worktree cleanup, next-agent
  preparation, and the important refusal paths.
- **Next:** Invoke `arcadia go` in either agent after a completed task; the
  skill previews, applies only a safe reconciliation, and enters or launches
  the prepared worktree with `arcadia advance`.
- **Blockers:** None in the command or shared skill. `arcadia go` deliberately
  surfaces blockers from the target Project instead of repairing unrelated
  documents or active work automatically.

## 2026-08-03 — Made the morning narrative durable and added AI perspective

- **Did:** Added an ownership-checked Obsidian projection for Morning Packets,
  an explicit `orientation packet export` backfill command, and a bounded
  unpaid local-preferred AI headline plus paragraph after the deterministic
  narrative. Composition checks the once-per-day row before model work and
  keeps Discord delivery intact when AI or vault memory is unavailable.
- **Result:** Today's already-sent packet now exists as a real portfolio Record
  under `Arcadia/Records/Orientation/2026/`, including a generated AI
  perspective and provenance. Focused request, composition, and vault tests
  pass.
- **Next:** Schedule calendar-aligned daily, weekly, and monthly Project and
  portfolio digests so the broader stories arrive unattended.
- **Blockers:** None in the feature. The local text route had drifted to a
  retired MLX endpoint; its operator configuration was corrected to the
  installed Ollama model.

## 2026-08-02 — Turned the morning Orientation Packet into a work narrative

- **Did:** Added a deterministic narrative lead to the existing catch-up-safe
  Discord morning packet. It draws from persisted Logs, completed Actions,
  ready Artifacts, pending Decisions, and blocked Actions to highlight recent
  changes, compare seven-day completion velocity with the preceding week,
  identify visible friction, and suggest the strongest next coding-agent
  handoff before the existing daily slate.
- **Result:** Tomorrow's normal scheduled message can provide orientation,
  motivation, and honest operational analysis without adding a model call that
  could prevent delivery. Focused packet and narrative tests and both
  TypeScript builds pass.
- **Next:** Observe tomorrow's first narrative packet, then refine its signal
  density from the operator's reaction before expanding daily/weekly/monthly
  digest scheduling.
- **Blockers:** None for tomorrow's packet.

## 2026-08-02 — Exported narrative digest Artifacts into Obsidian safely

- **Did:** Added `arcadia digest export <digest-id>`, which projects a composed
  `narrative_digest` Artifact into `Arcadia/Records/Narrative Digests/` in the
  configured Obsidian vault. It uses the established atomic-write,
  vault-containment, ownership-key, and content-hash no-op protections from
  Progress Reviews. The Record removes source Artifact frontmatter, has one
  readable title, and clearly identifies the story as AI-narrated through the
  local-preferred Intelligence route.
- **Result:** Focused narrative-digest and Progress Review memory tests (13)
  pass, as do both TypeScript builds. Re-exporting an unchanged Artifact does
  not churn the vault; disabled memory makes no vault mutation.
- **Next:** `schedule-portfolio-digests` — make daily, weekly, and monthly
  Project stories and the collective portfolio story arrive unattended.
- **Blockers:** Calendar-aligned versus rolling scheduled boundaries remains
  the one explicit policy question; it does not prevent implementing the
  scheduler's idempotent structure.

## 2026-08-01 — Put the QA queue ahead of autonomous QA

- **Did:** Refined the draft `demo-first-delivery` plan after the operator
  needed to test three active pull requests but had to reconstruct every demo
  path manually. Added `build-qa-queue-vertical-slice` as the plan's first
  Action and made the earlier Project Detail hero depend on it. The first
  Artifact is one Arcadia QA tab for configured Candidates: Project, revision,
  PR, Test link, short procedure, evidence freshness, and a pass/fail/needs-
  follow-up operator Decision bound to that revision.
- **Result:** The Pareto scope is explicit: no provider discovery, process
  scraping, screenshot automation, LLM visual judgment, autonomous QA, merge,
  deployment, or delivery in the first slice. The queue is deterministic and
  has no runtime LLM Token Impact; later capture and independent QA remain
  sequenced behind it.
- **Next:** The operator may activate `demo-first-delivery` when ready to make
  `build-qa-queue-vertical-slice` the current Action.
- **Blockers:** The plan remains draft; implementation still needs the priority
  Decision that activates it instead of displacing the current narrative-
  digests Action implicitly.

## 2026-08-01 — Added “Make it real” and enforceable Token Impact budgets

- **Did:** Added “Make it real” beside the Pareto and “If not now, then when?”
  guidelines: each Action should end in the most direct honest form a person or
  system can use, without crossing an approval boundary. Recorded Decision
  0008 and added a required plan-level `token_impact` T-shirt size plus a
  plain-language `token_budget`. Updated all six managed Arcadia plans, the
  managed-document parser, `arcadia next`, Project Detail, the authoring guide,
  semantic contract, Constitution, Start Here guide, and focused tests.
- **Result:** The current Action now reports its plan's Token Impact and Budget
  in both CLI continuation data and the Dashboard contract. The demo-first plan
  includes a routine-by-routine budget table: builds, tests, health probes,
  Playwright capture, metadata sync, and pixel comparison use no LLM tokens;
  interpretation, agentic QA judgment, implementation, and failure diagnosis
  carry the model cost. Ninety-one focused parser/dispatch tests and root
  TypeScript validation pass; `docs sync` reports zero errors or rejections.
- **Next:** Activate `demo-first-delivery` if the operator accepts the earlier
  priority recommendation; its first Action will now arrive with an explicit
  `xlarge` program impact and staged budget rather than hidden cost.
- **Blockers:** The Dashboard production build compiled and passed type
  validation, then failed page-data collection for three existing API routes
  while the live Dashboard was using the same build directory. This does not
  affect the plan/parser validation or running Dashboard, but a clean isolated
  Dashboard build remains follow-up evidence.

## 2026-08-01 — Planned demo-first handoff, Arcadia QA, and release management

- **Did:** Reviewed the operator's Private Practice Now Project Detail screen
  and found the concrete orientation failure: its summary named a stale failed-
  validation next action while Continuation named the real River Copy Studio
  trial, leaving the operator to reconcile control records before finding the
  product. Recorded approved Decision 0007, a human-readable operator demo and
  release contract, and the draft `demo-first-delivery` plan. The contract
  separates a known-good Stable target from the current Candidate, requires a
  demo before document archaeology, and makes the operator's own duties
  explicit: exercise the candidate, then read the relevant Log and QA evidence
  before acceptance, merge, release, or client delivery. The plan sequences a
  PPN demo-hero vertical slice, proof automation, a state-aware Test action,
  independent Arcadia QA, governed release management, and portfolio rollout.
- **Result:** `docs sync` parses the new managed plan and Decision with zero
  errors or rejections. Cloud-hosted previews are confirmed as viable Candidate
  targets: Cloudflare Pages supplies per-PR hash URLs and branch aliases;
  Workers supplies versioned and aliased previews. The plan treats previews as
  public unless Access protection is proved, starts screenshot capture with
  local Playwright, and retains Cloudflare Browser Rendering as an optional
  later runner. The current `narrative-digests` pointer was not changed by a
  planning-only request.
- **Next:** The operator should decide whether to activate
  `demo-first-delivery` now. Recommendation: yes; make
  `build-demo-hero-vertical-slice` current before completing scheduled digest
  work, because it directly removes the operator's present inability to find
  and show usable work.
- **Blockers:** Implementation is intentionally not authorized by “Plan it.”
  Activating this draft plan is the one priority Decision required before the
  first build Action.

## 2026-07-31 — Delivered one-Project narrative digest composition

- **Did:** Added an explicit-window Project digest composer. It gathers only
  in-window mission-Log rows, dispatch journal entries, and Decision activity;
  submits the structured fact snapshot to the unpaid local-preferred
  Intelligence route with a narration-without-invention contract; and writes a
  ready `narrative_digest` Artifact under the Arcadia workspace. Added the
  `narrative_digests` identity table so the exact Project, period label, start,
  and end tuple updates in place. Added `arcadia digest compose` with explicit
  inclusive `--from` and exclusive `--to` boundaries rather than silently
  answering the open calendar-versus-rolling question.
- **Result:** Focused digest, docs-sync, dispatch, and dispatch-journal coverage
  passes 94 tests; the full deterministic suite and both TypeScript builds also
  pass. Empty windows override model prose with an honest deterministic
  "nothing happened" account, and generated files never touch a managed
  Project repository. The full run also exposed and repaired one macOS
  `/var`-versus-`/private/var` assertion in the newly merged progress-review
  test; the production path was already correctly canonicalized.
- **Next:** `export-digest-to-obsidian` — reuse the existing progress-review
  atomic write, ownership check, and content-hash dedup for this AI-narrated
  Artifact shape.
- **Blockers:** None. Portfolio roll-up and scheduled-window boundary policy
  remain deliberately open and are not required by the next Action.

## 2026-07-31 — Scoped narrative digests as a plan, not a feature request

- **Did:** The operator asked for automatic daily/weekly/monthly narrative
  digests, for Arcadia's own project and every Project Arcadia manages.
  Grounded the ask in what already exists before drafting anything: the
  Discord bot's orientation scheduler (interval tick, idempotent per local
  period, self-catches-up after a miss) is the proven pattern for
  "automatic"; `exportProgressReview` already writes deterministic,
  non-Decision records into the Obsidian vault with atomic writes and
  content-hash dedup; `mission_logs` and the dispatch journal, both landed
  this session, are the structured substrate a digest reads from. Three
  genuine forks were the operator's to decide, not mine to infer: how a
  digest gets written (deterministic template, local AI narration, or a
  hybrid), where it goes (Artifact, Discord, Obsidian, or some combination),
  and what "automatic" runs inside (the existing bot process, or new
  infrastructure). Asked directly; recorded the answers as Decision 0006
  rather than silently deciding. Wrote `docs/plans/narrative-digests.md`
  with three ordered Actions and two genuinely open questions (a
  portfolio-wide roll-up digest, and calendar-aligned vs. rolling windows),
  and noted explicitly that this is adjacent to, but does not satisfy, the
  already-deferred `narrative-summarization` Action -- different subject
  matter, kept separately scoped rather than merged.
- **Result:** `active_plan` moves to `narrative-digests`, `current_action` to
  `compose-project-digest` -- the one piece worth building in isolation,
  since it answers the real open risk (can local AI narrate this honestly,
  without inventing outcomes the data doesn't support) before anything is
  wired to a schedule or a delivery surface.
- **Next:** Build the composer: gather one Project's mission_logs,
  dispatch_events, and Decision activity for a window, queue a
  local-preferred Intelligence job to narrate them, store the result as a
  new `narrative_digest` Artifact.
- **Blockers:** none

## 2026-07-31 — Fixed compute-ready-set: it required the pointer it exists to fix

- **Did:** Dogfooding `arcadia next --ready` against this repository, right
  after moving `active_plan` to a plan with no `current_action` set, caught a
  real defect: `resolveReadySet` called `resolveDispatch` outright, which
  itself requires a `current_action` to already resolve before returning
  anything usable. A plan declaring none refused the whole ready set for the
  same reason `next` refuses -- exactly the case this Action exists to help
  with, and exactly backwards from its own acceptance criterion ("suggests a
  `current_action` without writing one"). Extracted `resolveActivePlan` in
  `src/docs/dispatch.ts` -- the Project-and-plan resolution `resolveDispatch`
  already did, stopping short of anything about `current_action` -- and
  shared it between both functions. `resolveDispatch` still requires
  `current_action`; `resolveReadySet` no longer does, and enumerates every
  Action in the resolved plan regardless.
- **Result:** `arcadia next --ready` now correctly lists Actions, or names the
  nearest-to-ready one, even when no `current_action` is set at all -- verified
  against this repository's own real state. All 17 pre-existing
  `resolveDispatch` tests still pass unchanged, confirming the extraction
  preserved its exact behavior. 2 new regression tests cover the absent- and
  dangling-current_action cases specifically, so this exact defect cannot
  return silently.
- **Next:** None; folded into compute-ready-set's delivery before it shipped.
- **Blockers:** none

## 2026-07-31 — Delivered surface-dispatch-journal; dispatch-contract-enforcement complete

- **Did:** Added `dispatchJournal` to `DashboardSnapshot`
  (`src/dashboard/snapshot.ts`): total resolutions, how many were refused, and
  the single most frequent blocking field, computed via the existing
  `summarizeDispatchEvents` rather than a new read. Stays inside the
  snapshot's existing `withReadOnlyDatabase` transaction -- no write, no AI
  call, matching the Action's own acceptance criteria. Rendered in the CLI's
  human-readable `dashboard snapshot` output too, not only the JSON.
- **Result:** All four Actions in `dispatch-contract-enforcement` are now
  done. Its milestone -- managed plans governing work from dispatch through
  acceptance -- is reached, so the plan moves to `status: complete` with no
  `current_action`. `active_plan` moves back to `portfolio-docs-protocol`,
  the only other active plan, though it has no ready Action either: both its
  remaining increments are deferred against named triggers by Decision 0004.
  This is the honest state of the whole portfolio right now -- nothing is
  currently dispatchable anywhere -- recorded rather than papered over with
  an invented pointer. The plan-level `criteria-judgment` question stays
  open; no Action depended on its answer, so closing the plan does not close
  the question.
- **Next:** Whichever of Decision 0004's two named triggers fires first, or a
  new outcome the operator states.
- **Blockers:** none of the kind a document can repair -- there is genuinely
  no ready work queued right now.

## 2026-07-31 — Delivered compute-ready-set

- **Did:** Built `resolveReadySet` in `src/docs/dispatch.ts` and wired it to
  `arcadia next --ready`. It resolves the structural question (project,
  active_plan, real plan document) once through `resolveDispatch` and reuses
  its refusal verbatim rather than re-deriving it; every unfinished Action in
  the resolved plan is then checked individually through
  `resolveActionReadiness` -- the same function a single-action lookup
  already uses -- so the ready set can never disagree with what `next` says
  about any one Action. Deliberately does not additionally refuse the whole
  set over pointer-level blockers (an inactive Project, a competing
  current_action elsewhere) that describe the pointer rather than any one
  Action's readiness, since reporting what would be ready dispatches nothing
  and is not itself unsafe. The suggested current_action is deliberately
  unambitious: the current pointer if it is itself ready, otherwise the first
  ready Action in the plan's own declaration order -- no invented scoring,
  and never written. An empty ready set still names the unfinished Action
  with fewest readiness blockers rather than printing nothing.
- **Result:** `arcadia next --ready` against this repository correctly lists
  `compute-ready-set` and `surface-dispatch-journal` as the ready set (both
  other Actions in the plan are done), and suggests `compute-ready-set`
  unchanged since it was already current_action. 13 new tests: 11 unit tests
  on `resolveReadySet` covering each exclusion rule, the suggestion logic in
  both directions, the nearest-to-ready fallback, and agreement with
  `resolveDispatch`; 2 integration tests exercising the real CLI command
  against a docs-synced project, confirming nothing is journalled.
- **Next:** `surface-dispatch-journal` is now `current_action` -- the last
  Action in `dispatch-contract-enforcement`, exactly where the plan's own
  ordering said it should land.
- **Blockers:** none

## 2026-07-31 — Cross-referenced the "OK to go" reporting signal

- **Did:** Added a fixed `OK to go: <verb-first next step>` line to
  `AGENTS.md`'s "Always identify" list: whenever a message resolves to
  exactly one concrete, unblocked next step, end it with that exact line as
  the last thing in the message; omit it entirely otherwise. The full
  specification lives in Private Practice Now's
  `docs/agent-continuation-protocol.md`, since the rule governs every coding
  agent's reports across every project operating under the Arcadia Way, not
  only this repository -- this entry is the pointer, not a second copy.
- **Result:** A single vocabulary for "ready to execute" now spans both
  repositories rather than each inventing its own phrasing.
- **Next:** None; this is a standing reporting behavior, not a tracked
  action.
- **Blockers:** none

## 2026-07-31 — Delivered verify-acceptance-criteria

- **Did:** Built `src/stewardship/acceptanceCriteria.ts`, evaluating each of a
  plan's declared acceptance criteria against the accepted planning Artifact's
  text. Deliberately narrow: nothing here can verify a free-text English claim
  is true, only whether the Artifact addressed the topic at all, so the
  checker produces only `unmet` (the criterion's terms are absent -- real
  negative evidence) or `unchecked` (present, but truth unverifiable
  mechanically). It never produces `met` -- inventing that judgment now would
  pre-empt this plan's own open `criteria-judgment` question about whether
  local Intelligence should ever rule on what a script cannot. Wired into
  `review.ts`'s `CodexPlanningArtifactAcceptance` approval: the report lands
  in the Decision's `decisionNote` in the plan author's own words, and the
  structured per-criterion results merge into `context_json` via a new
  `mergeReviewItemContext` repository function. An Action whose plan declared
  no criteria is untouched -- the check runs only when criteria exist, so
  `decisionNote` is byte-for-byte what it was before this landed.
- **Result:** Accepting a Run's planning Artifact now reports each declared
  criterion by name, rather than accepting silently regardless of what was
  promised. 8 new unit tests cover the checker directly; 2 new integration
  tests exercise the full pipeline (packet approval through Run through
  acceptance) and confirm both the populated and untouched-when-no-criteria
  cases.
- **Next:** `compute-ready-set` remains `current_action` and is the
  dispatchable Action -- `arcadia next --ready`, listing every Action with no
  unmet prerequisite, unanswered Decision, or open question.
- **Blockers:** none

## 2026-07-31 — Answered recheck-readiness-at-approval as a hybrid

- **Did:** Traced the actual gap before answering the question: approval
  checked packet content (a sha256 digest) and link consistency, but never
  re-asked whether the plan document still said the Action was ready.
  Recorded Decision 0005 -- recheck readiness at approval only when the plan
  document's own `updated:` field has moved since the packet was built, the
  same staleness signal `docs sync` already trusts elsewhere. Implemented it:
  `ActionReadiness` now carries `planUpdated`; the planning Decision's context
  snapshots it at build time; `queueApprovedPlanningRun` compares the two
  before its transaction opens (not inside it -- a refusal that journals its
  own resolution and then rolls that journal entry back with everything else
  answers nothing, the same reason `work plan`'s guard runs before its own
  transaction). Moved `parseActionDocRef` from a private helper in
  `work.ts` to `docs/types.ts` as the inverse of `actionDocRef`, so build-time
  and approval-time checks share one implementation.
- **Result:** A packet approved long after a dependency regresses or a
  required Decision reopens is now refused, naming the blocker, provided the
  document's `updated:` moved -- which is the one signal the rest of the
  protocol already relies on. A packet approved while nothing changed pays no
  extra cost. Four new tests in `tests/dispatch-journal.test.ts` cover
  unchanged / moved-but-fine / moved-and-regressed / moved-without-a-blocker,
  plus the hybrid's one accepted, deliberately undocumented-as-a-bug gap: a
  regression whose author forgot to bump `updated:` is not caught.
- **Next:** `verify-acceptance-criteria` is next in this plan's own stated
  ordering, now that the review-and-acceptance surgery it was waiting to avoid
  duplicating is done. `compute-ready-set` remains `current_action` and is
  still the dispatchable Action.
- **Blockers:** none

## 2026-07-31 — Settled Decision 0004 and added "if not now, then when?"

- **Did:** Answered Decision 0004 rather than leaving it open: neither remaining
  increment now, both `deferred` against conditions that can actually fire —
  dependency persistence when a database-backed view must show ordering without
  re-crawling, narrative summarization when a second foreign repository is
  onboarded or a summary is genuinely wanted. Followed the consequence the
  Decision itself had recorded and moved `active_plan` to
  `dispatch-contract-enforcement`, promoting it from draft with
  `compute-ready-set` as `current_action` per that plan's own ordering note.
  Added **"If not now, then when?"** to `AGENTS.md` beside the 80/20 rule, and
  two lines to `CONSTITUTION.md`.
- **Result:** `arcadia next` now resolves a dispatchable Action with zero
  blockers and no operator question, for the first time since 2026-07-25 — the
  pointer had spent six days returning a question. `deferred` is deliberately
  not counted as resolved by `dispatch.ts`, so the two deferred Actions stay
  blocked without pretending to be startable, and neither is waiting on a person.
- **Next:** Implement `compute-ready-set` — `arcadia next --ready`, computed
  through `resolveActionReadiness` rather than a second copy of the rules.
- **Blockers:** none

## 2026-07-31 — Ingested mission Logs as rows

- **Did:** Resolved the work pointer, which returned its one operator question
  rather than a dispatch. Read the three candidate increments in code before
  surfacing it, which changed what the question was worth answering with:
  mission-Log ingestion needed only an upsert, and dependency persistence turned
  out to be half delivered already. The operator selected mission-Log ingestion
  as Decision 0003. Implemented it — a `doc_ref` column on `mission_logs`
  through the existing migration, and per-entry create/update/unchanged/skipped
  reporting matching every other document type. Keyed entries on the date alone
  at first; running it against this repository refused five of nine entries,
  because five of them are dated 2026-07-25. Rekeyed on the whole heading.
- **Result:** `docs sync` no longer reports Log files as skipped. A full apply
  against Arcadia's own repository reports 42 creates, 0 skips, and 0 errors,
  and a second apply reports everything unchanged. Narrative docs are now the
  only intentional skip a conforming repository produces. Recorded that
  `persist-dependencies` already meets its enforcement criterion, so the plan
  stops claiming work that is done. Found but did not fix an unrelated
  non-convergence: `syncProject` treats `name` as drift while `updateProject`
  cannot write it, so a renamed Project reports an update on every sync forever.
- **Next:** Answer Decision 0004 — dependency persistence, narrative
  summarization, or neither, in which case move `active_plan` to
  `dispatch-contract-enforcement` rather than leaving a pointer nobody intends
  to advance.
- **Blockers:** `persist-dependencies` is `question_open` on Decision 0004, so
  `arcadia next` will keep returning that question rather than dispatching.

## 2026-07-26 — Made Private Practice Now dispatchable again

- **Did:** Repaired Private Practice Now's control documentation. Retyped seven
  research and guide documents onto the shipped narrative vocabulary, added the
  plan and Project milestone, replaced the dangling `current_action: none` with
  the action carrying the open question, and recorded the unmade milestone choice
  as ADR 0012 rather than deciding it. Fixed a defect introduced earlier the same
  day where a plan question naming a decision raised a second Decision alongside
  the decision's own.
- **Result:** `arcadia next` went from eight blockers and no resolvable objective
  to one Project-level question for the operator. The seven refused documents
  were the larger problem: every discovery error is a dispatch blocker, so
  out-of-vocabulary `type:` values had made the entire Project undispatchable
  rather than merely unindexed. PPN now syncs with zero validation errors and
  re-runs as 0 created, 0 updated, 19 unchanged. Full suite passed 638 tests with
  2 skipped and both TypeScript builds passed. No deployment, publish, commit,
  push, credentials, or production access occurred.
- **Next:** Answer ADR 0012 to choose between `define-shared-inquiry-service` and
  `define-first-pilot-success`. Whichever wins still needs `acceptance_criteria`
  before it is dispatchable.
- **Blockers:** None. One duplicate Decision row created by the same-day defect
  was deleted from the workspace database after the code fix; it was minutes old,
  document-derived, and an exact duplicate of the surviving decision record.
  Deciding PPN's milestone order remains the operator's and was left open.

## 2026-07-26 — Cleared the open Decisions and fixed milestone lifecycle

- **Did:** Answered the three standing questions — Decision 0004 (docs sync stays
  strictly one-way, with execution history allowed only in a generated namespace
  ingestion never reads), Decision 0005 (a plan may span milestones through an
  optional per-action `milestone:` override), and Private Practice Now's ADR 0006
  (defer the editor-hosting choice until three clients are live concurrently).
  Implemented the milestone-status derivation, the per-action override, and
  question-to-decision resolution.
- **Result:** The Decision queue is empty across both Projects, down from three.
  Milestone status is now derived from plan status, so `arcadia portfolio`
  reports Arcadia's milestone as "docs sync ingests a real project's markdown"
  instead of one belonging to a completed plan — the old value was selected by a
  two-millisecond gap in insertion order, because `current_milestone` takes the
  newest active milestone and no plan ever ended one. A plan question naming its
  `decision:` inherits that decision's resolution, which is how an answered
  question leaves the queue without ingestion ever deleting. Full suite passed
  637 tests with 2 skipped, up from 633, and both TypeScript builds passed. No
  deployment, publish, commit, push, credentials, production access, or
  destructive action occurred.
- **Next:** `ingest-mission-logs` remains the current Action, now fully specified
  by Decision 0004: the entry key is the heading date plus a title slug, because
  Arcadia may not stamp an id into a human-authored file.
- **Blockers:** None for Arcadia. Two findings in Private Practice Now, reported
  and not fixed: its active plan declares no `milestone:`, so Arcadia fell back
  to the plan slug as a milestone title, and seven of its documents use `type:`
  values outside the vocabulary and were refused. Both are that repository's to
  resolve.

## 2026-07-26 — Made depends_on ordering constrain dispatch

- **Did:** Implemented `persist-dependencies` on the parallel local history.
  Added a `work_item_dependencies` edge table, a second `docs sync` pass that
  replaces each Action's document-declared edges, and a dispatch blocker for
  any unfinished prerequisite.
- **Result:** `depends_on` now constrains what Arcadia hands a coding agent and
  survives a sync round trip. Sync applied 14 real edges across three plans and
  re-ran as 0 created, 0 updated, 42 unchanged; deleting a document-owned edge
  removes it while an edge recorded outside ingestion survives. The full suite
  passed 633 tests with 2 skipped, and TypeScript passed.
- **Next:** `ingest-mission-logs` remained the next protocol Action at the time;
  it was subsequently selected and delivered under Decision 0003.
- **Blockers:** None. This parallel implementation was retained when the local
  and remote histories merged on 2026-07-31.

## 2026-07-26 — Made project continuation actionable

- **Did:** Pulled `main` to the latest merge, then added a project-scoped
  continuation API and Project view panel. The panel resolves the current
  Milestone and Action from the repository's managed documents, displays the
  source plan, expected Artifact, responsibility, resolved execution profile,
  acceptance evidence, operator questions, and deterministic document
  blockers. Added guarded **Get to work** preparation for the exact current
  Action and inline project Decision responses.
- **Result:** Private Practice Now no longer appears idle merely because its
  docs-authoritative Action is `in_progress` and therefore not eligible for the
  portfolio-wide Daily Advantage query. Its valid `systems_change` continuation
  is visible and can prepare a planning Decision without modifying PPN code or
  starting a Run. Refusal remains explicit when a pointer, question, required
  field, or responsibility prevents dispatch.
- **Next:** Keep `ingest-mission-logs` as Arcadia's authoritative current
  Action; this UX increment does not silently change protocol priority. Resolve
  the PPN planning profile only when an approved provider mapping satisfies its
  declared capability and locality requirements.
- **Blockers:** PPN's `systems_change` profile currently refuses preparation:
  no configured planning provider satisfies `c3_systems/e3_deep` while honoring
  `local_only`. Arcadia names every rejected mapping and makes no weaker
  substitution. Narrative and mission-Log persistence plus dependency
  persistence remain documented protocol gaps.

## 2026-07-25 — Made clarification Decisions conversational

- **Did:** Repaired the shared Decision-response contract, Mission Control
  Review flow, and Discord reply flow so a clarification question can be
  answered in natural language. Added immediate durable acknowledgment,
  automatic re-clarification, and an explicit AI-advice-to-editable-draft
  handoff.
- **Result:** Free-form Discord replies now resolve the exact referenced
  `ActionClarification` Decision instead of falling through to generic Ask.
  Mission Control shows **Your answer** and **Answer & continue**, removes
  approval-style execution affordances for clarification, clears the answered
  Decision immediately, and then surfaces either the concrete next Action or
  one focused follow-up. Answering never authorizes execution. Browser
  dogfooding verified the durable acknowledgment in about 1.5 seconds while a
  roughly 28-second local clarification completed independently. Focused CLI
  and Discord tests passed; the full suite passed 628 tests with 2 skipped,
  both TypeScript builds passed, and the production Dashboard build passed.
- **Next:** Keep `ingest-mission-logs` as the authoritative current Action and
  ask the operator which protocol increment to prioritize. Monitor real
  clarification replies before adding a non-threaded Discord fallback.
- **Blockers:** Automatic continuation requires local Intelligence; when it is
  unavailable, Arcadia preserves the answer and leaves the Action ready to
  continue. Dogfooding also exposed a queued no-step Run and the absence of a
  canceled Run state; its Decision was rejected and its audit record was marked
  failed before any executor ran. No deployment, publish, commit, push,
  production access, credentials, or destructive action occurred.

## 2026-07-25 — Validated docs sync and continuation against Private Practice Now

- **Did:** Read both repositories' instructions and bounded context; previewed
  then applied Arcadia workspace sync for
  `/Users/pmark/Dev/PrivatePracticeNow/platform`; resolved its milestone and
  `define-shared-inquiry-service` Action; and tested execution-profile parsing
  plus deterministic refusal of weaker capability/effort requirements.
- **Result:** Foreign sync preview found 15 managed creates, 14 intentional
  narrative/Log skips, and zero validation errors. The minimum PPN managed-doc
  patch was a `systems_change` execution declaration on the current Action and
  its plan-level milestone. Re-sync applied one milestone update with zero
  errors. Arcadia focused tests passed 49/49; PPN `pnpm typecheck` passed.
  No implementation code, deployment, publish, commit, push, credentials,
  production access, or destructive action was used.
- **Next:** Answer the one continuation question: choose mission-Log ingestion,
  narrative summarization, or dependency persistence as the next protocol
  increment. Arcadia will not infer priority from backlog order.
- **Blockers:** None for the completed validation. Narrative/Log ingestion and
  dependency persistence remain known protocol gaps, not foreign-repository
  blockers.

## 2026-07-25 — Selected the first foreign repository for protocol validation

- **Did:** Recorded Decision 0002 and selected
  `/Users/pmark/Dev/PrivatePracticeNow/platform` for the first non-Arcadia
  `docs sync` validation. Promoted `second-project-validation` to the current
  clarified Action with a cross-system execution profile and bounded acceptance
  criteria.
- **Result:** The continuation procedure now has one operator-resolved target,
  a concrete next Action, and an explicit Artifact requirement. Validation will
  remain documentation- and workspace-only; Private Practice Now application
  code, deployment, publishing, credentials, production access, and commits
  are out of scope.
- **Next:** Preview and apply the minimum managed-document changes, then run
  `docs sync`, `arcadia next`, profile resolution, and deterministic refusal
  probes against both repositories.
- **Blockers:** None after Decision 0002; any provider, credential, production,
  destructive, or unauthorized product boundary remains a stop condition.

## 2026-07-25 — Added the authoritative work pointer

- **Did:** Implemented the Arcadia Coding-Agent Continuation Contract's control fields — `active_plan`, `current_action`, per-action `acceptance_criteria`, `decisions`, and `references` — plus `arcadia next`, which resolves the objective from the repository or refuses with a named remedy per blocker.
- **Result:** Arcadia's own documents now carry a resolvable pointer. `arcadia next` reports the current action as `second-project-validation`, blocked on open decision 0002, and returns exactly one operator question instead of a request for direction.
- **Next:** Answer decision 0002 — which non-Arcadia repository to validate the protocol against — then dispatch `second-project-validation`.
- **Blockers:** Decision 0002 is open; choosing the repository is an operator call and materially changes direction, so no implementation proceeded past it.

## 2026-07-25 — Dogfooded the docs protocol against Arcadia itself

- **Did:** Built `docs sync` (frontmatter parser, vocabulary validator, repo crawler, doc_ref-keyed upsert) and `arcadia portfolio`, then converted Arcadia's own PROJECT.md, MISSION_LOG.md, and both plan documents into managed documents.
- **Result:** Arcadia's own repository is the first project ingested by the protocol it defines; the clarification-pass plan's five actions and one open question now exist as real rows.
- **Next:** Run `docs sync --apply` against a second, non-Arcadia project to test the protocol against documentation nobody wrote with the schema in mind.
- **Blockers:** none

## 2026-07-24 — Shipped the clarification loop end to end

- **Did:** Implemented Phases 1–4 of the clarification pass: CLI plumbing, five structured clarification columns, clarification Decisions plus Action subtasks, and the `arcadia clarify` orchestrator over local Intelligence.
- **Result:** Capture no longer pretends to clarify. An Action is explicitly unclarified until the rubric names a concrete next action or opens exactly one Decision.
- **Next:** Use the loop on real captured work before scoping further automation.
- **Blockers:** none

## 2026-07-23 — Established the operator-agnostic data model

- **Did:** Collapsed `needs_mark` into `requires_review` and renamed the `mark` executor type to `operator`.
- **Result:** No personal name remains in the persisted vocabulary or CLI output.
- **Next:** Begin the clarification pass.
- **Blockers:** none

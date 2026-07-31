---
arcadia: v1
type: log
slug: arcadia-mission-log
project: arcadia
updated: 2026-07-31
---

# Mission Log: Arcadia

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

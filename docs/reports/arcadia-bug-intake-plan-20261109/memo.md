# `arcadia bug`: what to build first, and in what order

**Taken:** Monday 2026-11-09 (Pacific), against `main` at `8bf4531f7`. **Spec:** [Issue #2379](https://github.com/pmark/arcadia/issues/2379). **Proposal receipt:** `agentask_df9fdc3ecaeb817fc2` / `capture_eced5738-1791-4a51-a5d8-fee32852cc2c` (request `propose-arcadia-bug-intake-dedupe-20261109`, status captured). **Author:** Claudia Atlas (claude, heavy), planner. No governed Action holds this work. Nothing was settled, merged, pressed or activated.

Operator goal, 2026-11-09: "an easy way for you to request that a bug gets logged and you don't have to worry about duplication or updating an existing one, or even really how the bug gets logged."

## The short version

1. **Build slice A first: dedupe-only intake.** Six Actions, zero model calls. Lesson promotion (slice B) waits for a named trigger.
2. **Most of it already exists, unused.** Decision 0049 approved `arcadia defect`, and it was built on 2026-09-23 (`src/defect/signal.ts`, `src/commands/defect.ts`). It already does deterministic fingerprinting, exact-retry idempotence, evidence merging and Jaccard similarity (threshold 0.7). The live `martianrover` workspace has **0** defect signals, so nobody uses it, and it never touches GitHub. Red-alert diagnosis (`src/production/redAlertDiagnosis.ts:205`) already has the GitHub half: a body-marker search, then a comment or create through an injectable `GhRunner`. Neither #2379 nor the proposal mentions either piece. `arcadia bug` should be **`defect` plus GitHub reconciliation**, not a new subsystem.
3. **The dedupe index is GitHub, read on each call.** There is no projection in slice A. A full title list of all 940 Issues (open and closed) took 7.1 s in one `gh` call today. When GitHub can't be reached, the report is kept locally as a `defect` signal and the outcome is **QUEUED**. Nothing is written to GitHub, so a blind duplicate can't happen.
4. **No new authority Decision is needed to build it.** Decision 0121 chose `arcadia bug` and 0049 approved the defect intake. The operator's routine-intake direction (2026-10-12) already covers creating and commenting on Issues in the owning repository. **The one operator choice is A or B** ([menu below](#operator-menu-first-slice)). It is previewed as a `decision` Ask with `gate_question: reasonable_disagreement`.
5. **Sequencing:** run slice A **in parallel** with the stopgap fixes. Its files don't overlap theirs. Ranked by effect on dispatch and operator attention, it comes after #2369, #2370 and #2367/#2368, and ahead of Relay fixes.

## Operator menu: first slice

| | Option | Consequence |
|---|---|---|
| ✅ **A (recommended)** | Dedupe-only intake: CREATED, APPENDED, REOPENED, LINKED or QUEUED, plus docs and skills | 6 Actions, about 1.5 to 2 sessions of build, no model spend. Agents stop searching Issues by hand from the day the guidance Action merges. A recurring `arcadia learn` lesson still becomes an Issue only when an agent files it. Slice B gets a named trigger and reuses A's key and matcher unchanged. |
| B | A plus automatic promotion of recurring lessons | 8 Actions, roughly a third more build. Lessons that recur N times become Issues without anyone remembering to file them. This adds an unattended GitHub writer whose input is noisy (inferences, low-confidence observations), and it would run before the matcher is calibrated on real traffic. A false merge or a flood of Issues lands on a backlog of 357 open Issues that triage is still shrinking. |
| C | Do nothing now | No build cost. Duplicates and hand searching continue (about 30 bug-shaped Issues a week, 8 duplicates found in the last triage). Decision 0121's utility stays unbuilt. |

**Revival trigger for B, if A is chosen:** after one full weekly triage cycle with `arcadia bug` live, the triage report counts at least 3 recurring lessons (3 or more observations each) that have no Issue, **and** A's receipts show no more than 1 false merge. Then settle B's two drafted Actions ([below](#slice-b-drafted-not-queued)) as an amendment to this Plan.

## Decisions, one recommendation each

### 1. First slice: A

| | A: dedupe-only | B: plus lesson promotion |
|---|---|---|
| Cost | 6 Actions, deterministic code and tests | 8 Actions: also a recurrence counter over similar lessons (today `learn` dedupes exact replays only) and a promoter |
| Risk | Low. A caller-initiated write to one repository, and every outcome is reversible | Medium. A writer with no caller in the loop, which multiplies any matcher error |
| Stays out | Promotion, the model tie-break, cross-repository routing, closing Issues, production-worker callers | The model tie-break, cross-repository routing, closing Issues |

The vital few are the key and matcher, the outcome engine and the guidance change. Without the guidance change no agent's behavior changes, so it is in slice A.

### 2. Where the dedupe index lives: GitHub, on each call

- **Read path, bounded at 4 `gh` calls:** (1) a body-marker search for the exact key; (2) one title list of every Issue in the owning repository, open and closed, with `stateReason`, ranked locally; (3) bodies for at most the top 5 candidates; (4) a live re-read of the target Issue's state right before any write.
- **Why no projection:** a projection would be a second copy of Issue state that can go stale. The Constitution allows a projection only as a signal, and every write would have to re-verify against GitHub anyway. At 940 Issues and about 7 s, the live read is cheap enough.
- **Revival trigger for a projection:** a call takes over 30 s, or GitHub rate-limits a call twice in one week, or the weekly triage needs bulk similarity across all Issues. The projection would then refresh by `updatedAt` and still be re-verified live before every write.
- **When GitHub is unreachable** (network failure, `gh` not signed in, a 5xx or a rate limit): record the report as a `defect` signal, so it is durable and replayable, and return **QUEUED** with no GitHub write. `arcadia bug sync` replays queued signals through the full match, so a report is never created without the duplicate check. The weekly triage and supervisors run `sync`. A partial read counts as unreachable, never as "no match".

### 3. Key, similarity and the deterministic-first design

- **Normalized report**, a pure function:
  - **Component:** the first source path in the report with its line number stripped, or else an `arcadia <command> <subcommand>`, or else a code identifier.
  - **Error signature:** an upper-snake error code such as `SQLITE_WORKSPACE_WRITE_DENIED`, or else the first 8 significant words after `Error`, or else an exit status.
  - **Symptom tokens:** the existing `summaryTokens` stop-word set.
- **Key:** a hash of the owning repository, component and error signature. It exists only when a component or an error signature was found, and wording never enters it. Each Arcadia comment and created body carries a marker holding the key and the request fingerprint.
- **Matching, in order:**
  1. Same key marker, with token overlap of at least 0.3 (so two different bugs in one file with one error code don't merge): **match**.
  2. Same component and token overlap with the title-plus-body of at least 0.6, or Jaccard of at least 0.7 (the existing threshold): **match**.
  3. Overlap between 0.4 and the match threshold: **ambiguous**.
  4. Anything lower: **new**.
- **Calibration:** these thresholds are a starting point. Action 1 sets them from a checked-in fixture: the four 2026-11-09 stopgap reports against #2367 to #2370, paraphrases, and at least 20 unrelated bug Issues as negatives. Its test pins the result.
- **Ambiguous resolves to CREATED**, with a "possibly related: #n" line in the body. Merging silently would hide a bug. A spare Issue is cheap and shows up in triage.
- **Light-model tie-break: not in slice A.** Revival trigger: one weekly triage finds 3 or more duplicate pairs that `arcadia bug` created from the ambiguous band, or ambiguous calls exceed 20% of the last 30. The tie-break would then be a local model through LiteLLM on a capped per-call token budget, never frontier, with the deterministic outcome as fallback.

### 4. Outcomes and receipts

| Outcome | When | GitHub write |
|---|---|---|
| **CREATED** | No match, or an ambiguous match | New Issue with the `bug` label, evidence, `file:line`, related refs and the marker |
| **APPENDED** | An open Issue matches | One comment with the evidence and marker. The receipt reports the **recurrence count**: Arcadia markers on that Issue, plus 1 for the original |
| **REOPENED** | A closed Issue matches **with `stateReason` COMPLETED** (a regression) | Reopen, plus a comment that names the recurrence |
| **LINKED** | The matched Issue is referenced by an unfinished governed Action in any Plan | Comment as for APPENDED. The receipt names the Plan and Action. **No Action write** |
| **QUEUED** | GitHub unreachable or the read was partial | None. Durable local `defect` signal |

- A match **closed as not planned or as a duplicate** gets APPENDED on the closed Issue with `closed_not_planned: true`, and is **not reopened**. A deliberate rejection is a record ("losing on purpose is a Decision"), and an agent must not undo it.
- **Idempotence.** The request fingerprint hashes the scope, the normalized text and the sorted evidence. A replay returns the stored receipt and makes zero GitHub writes. With an empty local store, the marker search finds the earlier comment and returns the same outcome. Similar wording with different evidence is a new observation: APPENDED, and the count rises.
- **Never** closes, relabels or retitles an Issue. **Never** writes an Action, Decision, pointer, queue, Plan or `PROJECT.md`. A test asserts this through a write spy on the fixture workspace.

### 5. Authority

- **Routine intake covers it:**
  - Creating an Issue and commenting in the **owning** repository. The operator's 2026-10-12 standing direction says "routine repository intake Issue", and `principles.md` says "an obvious bug is logged, not asked about".
  - Reopening an Issue closed as completed. It is reversible, and `principles.md` says a matching Issue "gets a reference or an update". **This is the one judgment call I couldn't verify against an explicit grant.** If the reviewer or operator reads reopening as outside routine intake, slice A ships with REOPENED returning APPENDED plus a `regression: true` flag, and loses nothing.
- **The build needs no new Decision.** Decision 0121 (answered 2026-10-11) chose `arcadia bug`, and its deferral was a deferral, not a refusal. Decision 0049 approved the defect intake this extends.
- **Exact approval boundaries:**
  1. The operator settles the Plan Ask and activates the draft Plan.
  2. The operator answers the A/B Decision.
  3. Each PR merges only under Decisions 0060/0080.
  4. Out of slice, each needing its own Decision: any automatic writer with no caller (slice B), closing or merging duplicate Issues, a model tie-break beyond a local model, calls from unattended production workers (their `gh` token is used for PRs today, not intake), and moving red-alert diagnosis onto `arcadia bug`.

### 6. Interfaces and what changes when it ships

- **Callers:**
  - Any agent session: `arcadia bug "<what happened>" --scope project:<slug> [--evidence <path|url>]... [--dry-run] [--json]`.
  - Supervisors: skill step 3.
  - The weekly triage (`arcadia-github-issues` skill): runs `arcadia bug sync`, then reads `arcadia bug list --since <date> --json` as its deduplicated stream.
  - The operator through Relay, later.
- **On ship, through Action 6:**
  - `docs/COMMANDS.md` drops "`arcadia bug` remain[s] unavailable" and documents the command.
  - `.agents/skills/arcadia-supervisor/SKILL.md` step 3 uses `arcadia bug`. The `.claude/skills` symlink already exists, so Codex, Claude Code and OpenCode discovery are all verified.
  - The `arcadia-github-issues` skill gains `sync` and `list`.
  - `principles.md`, under "Log defects with GitHub Issues", names `arcadia bug` as the way to search first and file once. GitHub stays the home, so the "no separate local defect script" rule holds: `arcadia bug` is a front door, and the `defect` signal is only its outbox.
  - The bootstrap (AGENTS.md generated region) is **not** changed in slice A, to protect the instruction budget. Revival trigger: an agent files a duplicate by hand after Action 6 merges.

### 7. Sequencing against competing work

Ranked by what changes dispatch behavior and operator attention:

| Rank | Work | Why here | Status |
|---|---|---|---|
| 1 | [#2369](https://github.com/pmark/arcadia/issues/2369) Decision-id race | Parallel-by-default makes concurrent settlements normal. A collision binds gate code to the wrong Decision, so dispatch goes wrong, and each one costs a re-settle and a review round (4 on 2026-11-07) | Open, no PR found |
| 2 | [#2370](https://github.com/pmark/arcadia/issues/2370) Plan-wide validator lint | Text traps stalled dispatch (26 Sessions, about 80 min). #2287 partly covers it | Open |
| 3 | [#2367](https://github.com/pmark/arcadia/issues/2367) + [#2368](https://github.com/pmark/arcadia/issues/2368) no-progress event and liveness page | Stalls went unseen for hours: Nov 7, 8:29 to 10:11 AM PST, and the keeper lapse from Nov 7, 7:57 PM to Nov 8, 1:20 PM PST. Operator attention is spent finding them | Open |
| 4 | **`arcadia bug` slice A** | Changes how every session files bugs, and shrinks the operator's triage load. The operator asked for it explicitly. **Disjoint files** (new `src/bug/`, one new table, one new command), so it runs **now, in parallel** with ranks 1 to 3, not after them | This memo |
| 5 | Relay fixes (#2346, #2119, #2013 and the 15 Relay proposals) | Relay isn't shipped, so these change operator attention only after it is. Revival trigger: the Relay build-item-6 Decision is answered, or Relay build resumes | Inventoried in #2349 |
| — | The three named bugs (#1366, #749, #2011) | Fixes are merged (PRs 2337, 2339, 2340). Only draft-Plan PR 2177's bookkeeping remains | Not competing |
| — | Test-pin Plans | `record-run-unattended-test-pins-20261107-part-2` is `status: complete` | Not competing |
| — | Slice B, projection, tie-break | Deferred, with triggers above | — |

Ranks 1 to 3 are recommendations to the coordinator (Rowan, under Signal). This planner dispatches nothing.

## Slice A Plan (previewed as an `intent: plan` Ask, inactive draft)

Every Action is test-first, has one writer per file set, and has `execution: build`. Acceptance text avoids the validator traps from #2370: each Action names only its own test file, and there are no quoted path-like inputs or escape sequences.

| # | Action id | Writer's file set | Depends on | Authority-adjacent |
|---|---|---|---|---|
| 1 | `bug-report-key-and-match` | `src/bug/key.ts`, `src/bug/match.ts`, its own test file, a checked-in fixture | none | none |
| 2 | `bug-github-issue-index` | `src/bug/githubIndex.ts`, its own test file | none (parallel with 1) | Reuses the `GhRunner` type. Read-only |
| 3 | `bug-intake-outcomes` | `src/bug/intake.ts`, a new `bug_receipts` table in `src/db/schema.ts`, its own test file | 1, 2 | **`src/db/schema.ts`** (shared migrations). GitHub writes |
| 4 | `bug-cli-command` | `src/commands/bug.ts`, registration in **`src/cli.ts`**, its own test file | 3 | **`src/cli.ts`** (a conflict hot spot: rebase late) |
| 5 | `bug-stopgap-replay-proof` | a new evidence report under `docs/reports/` | 4 | Live `gh` reads, and one live comment on #2370 for the idempotence proof (routine intake) |
| 6 | `bug-guidance-and-skills` | `docs/COMMANDS.md`, the supervisor skill, the GitHub-issues skill, `docs/agent-guidance/principles.md` | 5 | **Agent guidance and skills.** Changes procedure, not authority. The reviewer checks this |

Token impact: small. Zero model calls at runtime. Build uses existing session allowances.

### Slice B (drafted, not queued)

- `lesson-recurrence-count`: count similar lessons (A's matcher over `learn` lessons in one scope) and expose the count on `arcadia learn show`.
- `promote-recurring-lessons`: `arcadia bug promote --threshold N` (default 3) files each recurring lesson through `arcadia bug`, run from the weekly triage. Never automatic on capture.

## Previewed Asks (receipts; not settled)

| Ask | Request id | Proposal | Capture | Fingerprint | Result |
|---|---|---|---|---|---|
| Plan, slice A ([plan-ask.json](plan-ask.json)) | `plan-arcadia-bug-intake-slice-a-20261109` | `agentask_2552596036e2791080` | `capture_3822da73-f1b1-4da6-91bf-3f637c49c96b` | `2552596036e2…6dbe` | ok, 6 create effects, no refusals, 0 Project writes; would create an inactive draft Plan |
| Decision, first slice ([decision-ask.json](decision-ask.json)) | `decision-arcadia-bug-first-slice-20261109` | `agentask_eb791d9b6b481f1080` | `capture_94c9a4ce-a914-44f2-8466-fce581981231` | `eb791d9b6b48…cf6f` | ok, 1 create effect, `gate_question: reasonable_disagreement`, no refusals, 0 Project writes |

Both previews were run in workspace `martianrover`, and a replay returned the same receipts. Settling is the operator's step, through the supervisor or Signal.

## What I could not verify

- **Threshold quality.** The 0.3, 0.4, 0.6 and 0.7 values are design starting points. The 2026-11-09 lessons are not in the `learn` store under the terms I searched (0 matches), so Action 1 builds its fixture from the stopgap Issue texts.
- **Reopen authority.** See §5.
- **Headless `gh` auth** in launched Sessions. Slice A treats an auth failure as QUEUED, so nothing is lost, but whether launched Sessions can write Issues isn't tested.
- **Owning-repository resolution.** I assume the Project's registered repository remote is the owner. Cross-repository reports are out of slice. Revival trigger: the first report filed to the wrong repository.
- **`execution: build` on a draft Plan.** #2134 is closed, and the draft-Plan writer emits the route (`src/ask/settlement.ts:2736`). The preview's effect summary doesn't display it, so it is proven only at settlement.
- **Latency.** The 7.1 s figure is one sample from this host.

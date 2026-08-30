# Arcadia Command Guide

This guide shows the most common command paths for daily use.

All examples use:

```sh
WORKSPACE=./tmp/demo-workspace
```

## Initialize A Workspace

```sh
pnpm arcadia init "$WORKSPACE"
```

## Capture Intent

Use `capture` when you have natural-language intent and want Arcadia to structure it as an Action.

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --text "Generate status report" \
  --json
```

Safe known Actions are placed in `work_queue` as `autonomous`. Ambiguous Actions are placed in `requires_review`.

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --text "Improve Rebuster candidate review flow" \
  --json
```

## Ask Natural Language

Use `ask` when you want Arcadia to resolve a natural-language request through Phase 3 intent registries, create an audit record, create an Action, and create a workflow plan.

```sh
pnpm arcadia ask \
  --workspace "$WORKSPACE" \
  "Create a new blog site named MartianRover Field Notes." \
  --json
```

When a request needs Codex, Arcadia writes a prompt packet under `prompts/codex/<invocation-id>/` and records the invocation. It does not invoke Codex, deploy, publish, use credentials, or make unsafe changes by default.

### Prepare a new software Project idea

Use the explicit Project path when the input should become active planning work
rather than a Back Burner item:

```sh
pnpm arcadia project prepare \
  "Teacher Commons" \
  "A calm web app where teachers exchange classroom resources and keep attribution intact." \
  --workspace "$WORKSPACE" \
  --path /path/to/teacher-commons \
  --json
```

The response reports **Project Work**, **Plan First**, and **Codex**
responsibility, plus the Project, managed planning Action, packet, Decision,
and exact approval trigger. Preparation writes the valid managed pointer chain
and coding-agent context but invokes no model and starts no Run. Omit `--path`
to use the workspace Projects directory. Existing Project names, registered
repositories, `PROJECT.md` files, and managed plans are never overwritten.

After the approved read-only planning Run produces a validated Artifact,
accept its Planning Decision with `arcadia review approve <decision>`. For this
explicit Project-preparation workflow, acceptance deterministically updates the
checked-in plan first: the planning Action becomes done and its smallest useful
follow-up goal becomes exactly one clarified current Codex Action. Arcadia then
syncs that Action and prepares one immutable build packet. The response includes
the promoted Action, packet path, and exact `arcadia work run ...
--allow-codex-build` trigger. Acceptance itself starts no build Run. Repeating
the acceptance returns the original receipt; stale or malformed planning output
is refused without moving the managed pointers. Other planning workflows keep
their existing acceptance behavior.

### Shelve and resurface an idea

`ask --back-burner` uses the existing deterministic Ask/Intake path to shelve
an idea. With no surface option its condition is `manual`, so it never fires
automatically. A legacy Idea without condition metadata may still display as
opportunistic for compatibility.

```sh
pnpm arcadia ask "Revisit the compact status view" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --project proj_example \
  --surface-date 2026-10-01 \
  --source-ref docs/ideas/compact-status.md \
  --tag quick-win experiment
```

Use exactly one automatic condition:

- `--surface-date YYYY-MM-DD`
- `--surface-dependency <action-id> --dependency-status done`
- `--surface-predicate <registered-name>`; the initial registry includes
  `project-has-three-open-actions`

Predicates are named deterministic checks registered in code. Arcadia never
stores or evaluates predicate expressions. An unknown name stays visible as a
warning rather than crashing or silently reading as false.

Filter and group the shelf without turning it into a work queue:

```sh
pnpm arcadia back-burner list \
  --workspace "$WORKSPACE" \
  --status all \
  --fired yes \
  --project proj_example \
  --tag quick-win \
  --group-by project
```

`--group-by` accepts `fired`, `project`, `tag`, or `none`. Facet tags are
limited to `quick-win`, `experiment`, `nice-to-have`, `chore`, and
`capability`. The stored Back Burner status remains for lifecycle and legacy
Idea compatibility; conditioned items derive their effective opportunistic
status and fired state on every read. No fired flag is stored.

Inspect an item with `back-burner show <id>`. Only the explicit
`back-burner promote <id>` command creates an Action; condition evaluation,
`back-burner list`, `arcadia next`, and Dashboard reads never promote,
dispatch, schedule, or execute an item.

## Codex Companion

Use `codex list` to observe current Codex Cloud tasks and local Codex goals, then show the Arcadia snapshot:

```sh
pnpm arcadia codex list \
  --workspace "$WORKSPACE" \
  --active-only \
  --json
```

Associate an observed Codex task with an Arcadia project:

```sh
pnpm arcadia codex associate ctask_example \
  --workspace "$WORKSPACE" \
  --project proj_example \
  --milestone ms_example \
  --json
```

You can pass either the Arcadia task id, such as `ctask_example`, or the Codex source id, such as a local thread id or cloud task id.

Refresh the snapshot without relying on the list command output:

```sh
pnpm arcadia codex sync \
  --workspace "$WORKSPACE" \
  --source all \
  --json
```

Arcadia only observes Codex state. Codex remains responsible for implementation work, task execution, and goal lifecycle. When an associated Codex task transitions to a successful terminal status, Arcadia writes a mission log and links it to the observed task.

## Arcadia Intelligence

Start the local Intelligence API and in-process worker:

```sh
pnpm arcadia intelligence serve \
  --workspace "$WORKSPACE" \
  --port 4710
```

Run one local Codex image-generation smoke job through the normal
Intelligence lifecycle:

```sh
ARCADIA_CODEX_IMAGE_ROUTE=codex-cli \
pnpm arcadia intelligence smoke-image \
  --workspace "$WORKSPACE" \
  --prompt "a simple black square centered on a white background" \
  --json
```

The smoke command returns the terminal job, artifact URIs, and the isolated
job workspace path under `.arcadia/intelligence/jobs/`.

Show read-only current-day Intelligence usage and coding-agent availability:

```sh
pnpm arcadia intelligence usage --workspace "$WORKSPACE" --json
```

Arcadia aggregates token and cost data recorded by completed jobs and exposes a provider-neutral coding-agent availability snapshot. Codex account windows come from the local Codex app-server protocol. Claude Code 5-hour/7-day account limits are refreshed from Claude Code's local OAuth credentials when available; its context data still comes from the status-line JSON payload, captured by:

```sh
scripts/claude-code-statusline.sh
```

Configure that script as Claude Code's `statusLine.command`. The script writes the latest payload to `~/.arcadia/telemetry/claude-code.json`; override the location with `ARCADIA_CLAUDE_USAGE_PATH`. Arcadia also retains the most recently reported normalized provider snapshots in `~/.arcadia/telemetry/coding-agent-usage.json` (override with `ARCADIA_CODING_AGENT_USAGE_CACHE_PATH`). If a live read is temporarily unavailable, the CLI and Intelligence screen show that retained value as a **Last reported snapshot**. Missing or unsupported provider fields remain explicitly unknown.

Run deterministic safe steps immediately:

```sh
pnpm arcadia ask \
  --workspace "$WORKSPACE" \
  "Prepare a weekly Martian Rover Labs update from recent mission logs." \
  --run-safe \
  --json
```

## Process iCloud Drive Ingress Files

Apple Shortcuts can create Arcadia requests by writing files to the default iCloud Drive root:

```text
~/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress/iCloudIdeas/In/YYYYMMDD-HHMMSS.txt
```

The file contents are treated as the natural-language request. To process pending files explicitly, use the iCloud Drive root:

```sh
pnpm arcadia ingress process \
  --workspace "$WORKSPACE" \
  --source iCloudIdeas \
  --ingress-root "$HOME/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress"
```

Run deterministic safe steps for matching requests:

```sh
pnpm arcadia ingress process \
  --workspace "$WORKSPACE" \
  --source iCloudIdeas \
  --run-safe
```

Preview pending files without moving files or executing work:

```sh
pnpm arcadia ingress process \
  --workspace "$WORKSPACE" \
  --source iCloudIdeas \
  --dry-run
```

Inspect the current queue, active Workflow Runs, watcher health, and recent
completion/failure sidecars without changing files:

```sh
pnpm arcadia ingress activity \
  --workspace "$WORKSPACE" \
  --limit 20
```

Arcadia processes `.txt`, `.md`, and `.markdown` requests and media files matched by enabled Workflows oldest first. Workflow and unmatched binary files remain pending until two observations show their size and modification time unchanged for at least 30 seconds; Workflows also require `--run-safe`. Requests are claimed in `Processing`. Idea captures move to `<ingress-root>/iCloudIdeas/Done/Ideas/`, unmatched files are preserved in `Done/Unclassified/`, other successful requests move to `Done/`, and failures move to `Failed/`. Each moved file gets a readable JSON sidecar, and every non-empty processed request gets an ingress Log. Files placed in `Attachments/<request-basename>/` are recorded as ready Artifacts.

To stage local files from an Admin Ask/upload surface using the same convention as the Apple shortcuts:

```sh
pnpm arcadia ingress capture \
  --workspace "$WORKSPACE" \
  --file /path/to/idea.md \
  --description "Capture and organize this idea."
```

Watch mode is intentionally not implemented. For periodic processing, configure macOS `launchd` to run `arcadia ingress process` on an interval. See `docs/APPLE_INGEST.md` for the macOS Quick Action and iPhone/iPad Shortcut flow.

Install and maintain that periodic macOS service through Arcadia rather than hand-editing a LaunchAgent:

```sh
pnpm arcadia ingress service install --workspace "$WORKSPACE"
pnpm arcadia ingress service status --workspace "$WORKSPACE"
pnpm arcadia ingress service doctor --workspace "$WORKSPACE"
pnpm arcadia ingress service uninstall --workspace "$WORKSPACE"
```

The service uses the iCloud Drive `ArcadiaIngress` root by default, checks every 60 seconds, waits 30 seconds for Workflow media to stabilize, and passes `--run-safe` so only Workflows explicitly marked safe can execute. Standard output is discarded because Arcadia retains Run evidence; errors go to `~/Library/Logs/Arcadia/ingress-iCloudIdeas.err.log`.

## Deterministic Workflows

```sh
pnpm arcadia workflow list --workspace "$WORKSPACE" --json
pnpm arcadia workflow show thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow match './Thundertonk practice 2026 July 16.m4a' --source iCloudIdeas --workspace "$WORKSPACE" --json
pnpm arcadia workflow validate thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow add ./workflow.json --workspace "$WORKSPACE" --json
pnpm arcadia workflow enable thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow disable thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow run thundertonk-practice './Thundertonk practice 2026 July 16.m4a' --workspace "$WORKSPACE" --dry-run --json
pnpm arcadia workflow runs --workspace "$WORKSPACE" --json
pnpm arcadia workflow run-info show <run-id> --workspace "$WORKSPACE" --json
```

Workflow definitions are JSON files in `config/workflows/`; workspace definitions override built-ins with the same stable ID. Executables and argument arrays are stored separately, and `{input}` must be one complete argument. A successful Run preserves raw stdout/stderr Logs and a JSON Run manifest below `artifacts/workflow-runs/<run-id>/`.

Attach captured work to project context when known:

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --project proj_example \
  --milestone ms_example \
  --text "Write specification for the next review flow" \
  --expected-artifact "Review flow specification" \
  --json
```

## Export A Morning Packet To Obsidian

```sh
pnpm arcadia orientation packet export <packet-id> --workspace "$WORKSPACE" --json
```

New Morning Packets automatically add one bounded local-AI headline and one
why-it-matters paragraph after the deterministic narrative, then project the
packet into `Arcadia/Records/Orientation/` when memory is enabled. A failed AI
call or vault write is reported as a warning and never prevents deterministic
Discord delivery. The explicit command backfills an existing packet and adds
the AI perspective to its Obsidian Record without mutating an already-sent
Discord message.

## Compose A Project Digest

```sh
pnpm arcadia digest compose \
  --workspace "$WORKSPACE" \
  --project arcadia \
  --period week \
  --from 2026-07-24T00:00:00.000Z \
  --to 2026-07-31T00:00:00.000Z \
  --json
```

`--project` accepts an id or slug. `--period` labels the explicit window as
`day`, `week`, or `month`; it does not calculate the boundaries. `--from` is
inclusive and `--to` exclusive. Use this for a window the scheduled cadences
below do not cover; for the ordinary case, prefer `digest run`.

The command queues unpaid local-preferred narration, persists the gathered fact
snapshot, writes the Markdown under `artifacts/narrative-digests/` inside the
Arcadia workspace, and creates or updates one `narrative_digest` Artifact for
the exact Project/period/boundaries tuple.

## Export A Narrative Digest To Obsidian

```sh
pnpm arcadia digest export digest_example --workspace "$WORKSPACE" --json
```

This projects an already-composed `narrative_digest` Artifact into the
configured Obsidian vault. The Record is explicitly labelled
`local_preferred_ai`, preserves the Artifact as source of truth, uses an
atomic ownership-checked write, and skips an unchanged Artifact without
rewriting the vault file. It does nothing when workspace memory is disabled.

## Run Every Due Digest Cadence

```sh
pnpm arcadia digest run --workspace "$WORKSPACE" --json
```

This is what the Discord bot's digest scheduler calls. For each cadence it
composes, stores, and exports one digest per **active** Project plus one
collective **portfolio** roll-up, then reports which of them still need
delivering.

Windows are calendar-aligned, local, and always the last *completed* period:
yesterday for `day`, the last Monday-to-Monday week for `week`, the last
calendar month for `month`. Nothing is backfilled beyond the most recent
completed period.

The once-per-subject-per-period guard is the stored
`(scope, period, window_start, window_end)` row itself — there is no separate
schedule ledger to disagree with it. Each returned entry carries a `status`:

| Status | Meaning |
| --- | --- |
| `composed` | Newly narrated and stored on this run; deliver it. |
| `pending-delivery` | Stored earlier but never posted; deliver it. |
| `skipped` | Already stored and already delivered. |
| `failed` | This subject failed; every other subject and cadence still ran. |

A failure is reported as an entry and a warning, never thrown, so one
Project's unreachable local model cannot cost any other Project or cadence its
digest. A failed vault export is likewise a warning on an otherwise good entry
— the digest still composed and can still be posted.

```sh
pnpm arcadia digest mark-posted digest_example --message-id 123 --workspace "$WORKSPACE" --json
```

Records that a composed digest reached its delivery surface. Until it is
recorded, the digest comes back as `pending-delivery` on the next run rather
than being lost behind the once-per-period guard.

## Manage Artifacts And Expected Outcomes

An Action's `expected_artifact` is the concrete "done" signal — the thing
that should exist when the Action is finished. It matters beyond
description: coding-agent planning preparation refuses to run without one
(`work plan` requires `expectedArtifact` to be set on the Action before a
managed Codex/Claude planning packet can be created), and it is what tells
you and any reviewing agent whether a Run actually finished the job or just
did *something*.

Set or change it after capture, without re-writing the whole Action:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --expected-artifact "Published status report at reports/2026-07-status.md" \
  --json
```

Use `--expected-artifact none` to clear it (for example, if an Action turns
out to be exploratory and has no single deliverable).

**Example scenario:** you `capture` "Investigate why the nightly sync job
is slow" with no expected artifact. A day into investigating, you realize
the real deliverable is a short root-cause writeup. `work update
--expected-artifact "Root-cause writeup for nightly sync slowness"` turns
that vague Action into one that can pass through planning preparation,
without losing its history or requiring you to re-capture it.

Create an Artifact directly — for a deliverable that already exists (a
document you wrote by hand, a design doc from a call), or to link a
Milestone/Action to a piece of evidence before Arcadia produces one itself:

```sh
pnpm arcadia artifact create \
  --workspace "$WORKSPACE" \
  --title "Nightly sync root-cause writeup" \
  --type document \
  --status ready \
  --path reports/nightly-sync-root-cause.md \
  --project proj_example \
  --work-item work_example \
  --json
```

`--project` and `--work-item` are both optional, but if given they must
refer to Actions/Projects that already exist — Arcadia validates the link
rather than silently dropping it. `--status` defaults to `planned`; omit
`--path` for an Artifact that is expected but not produced yet (planning
packets do this automatically for the Action's `expected_artifact`).

**Example scenario:** during a dogfood session you manually write a
decision memo in Obsidian before Arcadia has any orchestrator to produce
one. `artifact create --path <vault path> --work-item <id>` registers that
memo as the Action's real output, so `artifact list` and the Dashboard
reflect what actually happened instead of showing the Action as artifact-less.

## Clarify Actions

Capture is not clarify. `capture` routes an Action into a queue and writes a
placeholder next action — usually *"Clarify the desired outcome or approve a
Codex execution path."* — but nobody has yet decided what to actually do. The
`next_action` column can't record that, because it is `NOT NULL` and always
holds *some* string. So `clarification_status` is the field that carries GTD's
"clarify" step: it, not the text, is the source of truth for whether an Action
has a real next action.

Every Action captured from now on lands as `unclarified`. The three states:

| Status | Meaning |
| ------ | ------- |
| `unclarified` | No concrete next action has been named yet. The `next_action` text is a placeholder — listings mark it `— (pending clarification)`. |
| `question_open` | Someone looked, and something is missing. `gap_type` says what kind, `open_question` holds the single question whose answer unblocks it. |
| `clarified` | A real, physically doable next action is recorded, with `clarification_source` for what justified it and `confidence` for how far to trust it. |

A `NULL` status is a fourth, distinct case: the Action predates clarification
or was never evaluated. That is deliberately *not* the same as `unclarified`,
which asserts that the Action is known to lack a next action.

Why the field matters beyond bookkeeping: it is what makes "which Actions are
actually ready to work?" answerable without reading every row by eye, and it is
the input any later automation gates on — a policy like *"a clarified Action
with high confidence and effort ≤ short may dispatch without a per-instance
Decision"* is expressible only because these columns exist.

Record a gap and the one question that unblocks it:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --clarification-status question_open \
  --gap-type missing-decision \
  --question "Should the nightly sync retry on partial failure, or fail the whole run?" \
  --confidence medium \
  --json
```

`--gap-type` takes exactly one of the rubric's four kinds, because each one
implies a different question:

| Gap type | The Action is blocked because… | What the question should ask for |
| -------- | ------------------------------ | -------------------------------- |
| `missing-decision` | a choice hasn't been made | the decision, plus the 2–4 criteria that matter |
| `missing-external-input` | you're waiting on someone or something outside | who/what, plus a draft of the ask |
| `missing-definition` | it's a problem label, not an action | a proposed decomposition into 2–5 subtasks, as a proposal to approve |
| `missing-success-criteria` | the action is clear but "done" is not | what finished looks like, specific to this Action |

Record a resolved clarification once the answer arrives:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --clarification-status clarified \
  --next-action "Add a per-batch retry to the nightly sync and log partial failures" \
  --source "Decision review_0007; docs/plans/nightly-sync.md" \
  --confidence high \
  --gap-type none \
  --question none \
  --json
```

`--source` records *what justified* the next action — an Action detail, a
linked doc, a resolved Decision — so a later reader can tell a considered call
from a guess. `--confidence` is `high`, `medium`, or `low`; it is a coarse
label on an Action, distinct from the `0–1` confidence score on a Decision.
Every one of these flags takes `none` to clear it, which is how an Action that
was `question_open` sheds its stale gap when it becomes `clarified`.

**Example scenario:** you capture "Fix the flaky checkout test" on a walk. It
lands `unclarified`, and `work list` shows its next action as pending, so it
never looks ready. Reviewing the queue later you realize you can't name a fix
until you know whether flakiness is a timing issue or a fixture issue —
`--gap-type missing-definition --question "Which of the three failing
assertions fails in isolation?"` puts that question on the record instead of
letting the Action rot in the queue looking actionable. When you find the
answer, `--clarification-status clarified --next-action …` promotes it, and the
`[GAP …]` prefixes an earlier dogfood pass had to jam into the next-action text
are no longer needed.

## Clarify Automatically

Everything above is the manual version of the clarify step. `arcadia clarify`
runs the same rubric over every `unclarified` Action for you.

```sh
pnpm arcadia clarify --workspace "$WORKSPACE"
```

**This is a dry run.** It prints what it would write and changes nothing. That
is the default on purpose: clarification rewrites `next_action` and
Responsibility — the two fields that decide whether work gets dispatched — and a
batch pass that silently re-routed your queue would be exactly the kind of
unobservable automation Arcadia is built to avoid. Add `--apply` when the
preview looks right:

```sh
pnpm arcadia clarify --workspace "$WORKSPACE" --project proj_example --apply
```

Scope it with `--project <id>`, `--limit <n>`, or `--work <id>` for a single
Action. `--work` evaluates that Action whatever its current state; without it,
a pass only considers Actions that are `unclarified` and not done. Actions with
a `NULL` clarification status are skipped — those predate the feature, and
sweeping your whole history into a model pass on first run would be a surprise
rather than a feature.

For each Action the rubric produces one of two outcomes, and `--apply` writes
it:

| Verdict | What gets written |
| ------- | ----------------- |
| **YES** — a concrete next action exists | `next_action` is replaced, `clarification_status` becomes `clarified`, `clarification_source` records what justified it, `confidence` records how far to trust it, and the rubric's `actor` sets Responsibility (`operator` → Requires Review, `coding-agent` → Codex, `external-party` → Blocked), which moves the Action to the matching queue. |
| **NO** — something is missing | A clarification Decision is opened with the single question (exactly what `review open` does by hand), and the Action moves to `question_open` with its `gap_type`. |

A `missing-definition` verdict comes back with a proposed decomposition.
**`clarify` never creates those subtasks.** They are printed and returned so you
can act on them, and `work add-subtask` is how they become real. Decomposition
is a proposal until you approve it.

The engine is Arcadia Intelligence — the local structured-generation service —
requested as `local-preferred` with `allowPaidUsage: false`. A pass runs over
every unclarified Action, and one that quietly billed a frontier model per
Action is not one anybody would leave running. If the local model is
unreachable, the command fails with `CLARIFY_ENGINE_UNAVAILABLE` and writes
nothing.

A verdict that comes back unusable — a "clarified" with no next action, a gap
type outside the taxonomy — is skipped and reported, and that Action keeps
exactly the state it had. One bad response does not abandon the rest of the
pass.

**Example scenario:** you capture six things on a walk. `clarify` names concrete
next actions for four of them and routes two to Codex; the other two come back
as questions — one `missing-decision`, one `missing-definition` with a proposed
three-way split. You answer the first with `review approve … --answer`, and turn
the second into real subtasks with `work add-subtask`. Nothing moved without
you seeing it first.

## Ask One Question As A Decision

Recording a gap on the Action (above) says *that* it is blocked. Opening a
Decision puts the question where the operator will actually see it — `review`,
`attention`, and the Dashboard all list open Decisions, so a clarification
question queues alongside every other thing waiting on a human instead of
sitting in a field nobody reads.

```sh
pnpm arcadia review open work_example \
  --workspace "$WORKSPACE" \
  --question "Do we cut over per-tenant or all at once?" \
  --gap-type missing-decision \
  --recommendation "Per-tenant keeps rollback cheap." \
  --json
```

This writes both records at once: a Decision carrying the question, and the
Action moved to `question_open` with the same `gap_type` and `open_question`.
The rubric's rule holds here — **one** question, the single highest-leverage
one. If you find yourself wanting `--question` twice, the Action probably needs
decomposing (`missing-definition`) rather than a longer interrogation.

Answer it when you know:

```sh
pnpm arcadia review approve R1 \
  --workspace "$WORKSPACE" \
  --answer "Per-tenant, starting with the three smallest accounts." \
  --json
```

`--answer` is **required** for a clarification Decision, and no executor runs —
unlike approving a planning Decision, answering a question is information, not
authorization to do work. The answer lands in `clarification_source`, the open
question is cleared, and the Action returns to `unclarified` rather than jumping
to `clarified`: an answer is an *input* to clarification, not the concrete next
action itself. At the CLI, re-clarifying remains an explicit `arcadia clarify
--apply` step. Interactive surfaces perform that same observable step
automatically only after the answer is durable.

The Dashboard exposes this as a **Your answer** field rather than an Approve
button. In Discord, reply directly to the clarification notification with
free-form text. Both surfaces route through `review resolve-reply`, record the
same durable Decision note and `clarification_source`, and confirm that no
executor ran. AI advice in the Dashboard may be copied into the field as a
draft, but the operator must edit or submit it explicitly. Those interactive
surfaces immediately run clarification again after the answer is durable, so
the operator sees either the concrete next Action or one focused follow-up
question without a second command.

`review reject R1` withdraws a question that turned out to be wrong — the
Decision keeps the history, and the Action drops back to `unclarified` so it
stops advertising a question nobody will answer. `review defer R1` leaves it
`question_open`, because the question is still live.

## Break An Action Into Subtasks

When the gap is `missing-definition` — the Action is a problem label, not a
task — the fix is decomposition. Subtasks are real Actions with a
`parent_work_item_id`, not checklist strings, so each one can be queued,
planned, and run on its own.

```sh
pnpm arcadia work add-subtask work_example \
  --workspace "$WORKSPACE" \
  --title "Migrate the invoice table" \
  --json
```

One subtask per call, on purpose: a proposed decomposition stays a *proposal*
until you approve it, and creating children one at a time keeps that boundary in
your hands rather than letting a whole tree materialize from a suggestion.

A subtask inherits the parent's Project and Milestone, defaults to the parent's
Responsibility, and starts `unclarified` — naming a subtask is not the same as
deciding how to do it. Pass `--next-action` when you already know the concrete
step, and it is recorded as given instead:

```sh
pnpm arcadia work add-subtask work_example \
  --workspace "$WORKSPACE" \
  --title "Backfill historical invoices" \
  --next-action "Run the backfill script against staging" \
  --json
```

`work list` and `queue` indent children beneath their parent, so a decomposition
reads as one piece of work. A queue view is filtered, so a subtask sitting in a
different queue from its parent renders at top level there rather than
disappearing.

Re-parent or promote an existing Action with `work update --parent <id>`, or
`--parent none` to make it top-level again. Arcadia refuses a parent that
doesn't exist, self-parenting, and any cycle. Deleting a parent clears its
children's link rather than cascading — a child is independently captured work,
and losing a parent should never destroy it.

**Example scenario:** "Improve onboarding" is a label, not an action. You open a
`missing-definition` Decision asking which step actually loses people; the
answer is the email verification step. You then add two subtasks — "Instrument
the verification screen" and "Draft a fallback email" — each of which is small
enough to clarify, size, and plan on its own, while the parent keeps the
history of why they exist.

## Ingest Documentation As Data

Conversations with frontier models produce Markdown. `docs sync` turns that
Markdown into Projects, Milestones, Actions, and Decisions, so the portfolio can
be managed from Arcadia rather than by re-reading files. The schema and the
paste-able chatbot prompt live in
[docs/plans/portfolio-docs-protocol.md](plans/portfolio-docs-protocol.md).

```sh
pnpm arcadia docs sync --workspace "$WORKSPACE"
```

**Dry run by default**, the same posture as `clarify`: ingestion rewrites the
Actions and Decisions you plan against, and a job that silently rewrote a queue
from a file someone edited is exactly the unobservable automation Arcadia
avoids. The preview runs the identical code path with the writes withheld, so it
cannot drift from what `--apply` does.

```sh
pnpm arcadia docs sync --workspace "$WORKSPACE" --project arcadia --apply
```

Arcadia crawls each Project's recorded `repo_path`, so point a Project at a real
repository first:

```sh
pnpm arcadia project metadata proj_example --workspace "$WORKSPACE" --repo-path ~/Dev/example
```

Discovery is **by marker, not by path**: any `.md` file whose frontmatter
contains `arcadia: v1` is managed, wherever it sits. Organize `docs/` however
you like; a file becomes Arcadia's business only when it opts in.

### What survives a re-run

Every ingested row carries a `doc_ref` — `plan/<slug>#<action-id>`,
`decision/<slug>`, `log/<slug>#<date>--<title-slug>` — built only from
identifiers the protocol promises never change. Reword an action's title and the existing Action is **updated**; it does
not fork a duplicate. Re-running with no document changes reports everything as
unchanged and writes nothing.

Rows with **no** `doc_ref` — everything you captured by hand, or that `clarify`
produced — are invisible to ingestion and can never be overwritten by a document
that happens to describe something similar.

A document older than the record it describes is **skipped**, not applied: if
`clarify` moved an Action on Tuesday and the file is dated Monday, the file
describes a world that no longer exists.

### When a document is wrong

Validation refuses rather than guesses. An out-of-vocabulary enum, a
non-kebab-case slug, an action marked `clarified` with no `next_action`, or two
files claiming the same reference are all reported per-file with the field path,
and that file is not ingested — the rest of the crawl continues.

Malformed YAML in a file that claims `arcadia: v1` is reported as an error, not
skipped. An unquoted value containing a colon is the way generated frontmatter
most often breaks, and a document that silently vanished from the portfolio
would be far worse than one that loudly failed.

### What to work on next

`docs sync` and `portfolio` answer "what exists" and "how healthy is it".
`arcadia next` answers the only question a dispatched coding agent needs:

```sh
pnpm arcadia next --workspace "$WORKSPACE" --project arcadia
```

It resolves the **authoritative work pointer** — `PROJECT.md`'s `active_plan`,
then that plan's `current_action` — and prints the objective with its
acceptance criteria, required decisions, references, and what the agent is
authorized to do. It reads the repository, not the database, because
checked-in documentation is authoritative when the two disagree.

Supporting records (`continuation`, `proposal`, `template`, `review`) and plans
marked `dormant` or `proposed` are recognized but cannot block, redirect, or
compete with that pointer. Their lifecycle and activation conditions belong to
their repository-local protocol.

When one or more Back Burner conditions have fired, `next` adds one final line
with the count and the `back-burner list --fired yes` discovery command. It
does not preview the items. When the count is zero, the output is unchanged.

Exactly one action may be current across a project. A second plan declaring
`current_action` is reported as a competing objective rather than silently
losing to the active plan.

An action's `depends_on` ordering is a dispatch constraint, not a note. `next`
refuses while any Action the current one depends on is unfinished, naming the
prerequisite and offering three repairs — finish it, point `current_action` at
it, or delete the dependency if it no longer holds:

```text
  ! docs/plans/portfolio-docs-protocol.md [actions.persist-dependencies.depends_on]: Depends on "build-upsert" ("Build the upsert layer"), which is "open", not done.
      Finish "build-upsert" first, or point current_action at it, or remove the dependency if it no longer holds.
```

`docs sync` persists those edges, replacing the set each run so deleting a
`depends_on` line in a document actually removes the constraint. A dependency
recorded outside ingestion is never removed by a document that fails to mention
it.

An action may also name its own `milestone:` when a plan spans more than one
(Decision 0005). It inherits the plan's otherwise, and the plan's own milestone
keeps its existing identity, so adding an override migrates nothing. A plan's
status decides its milestone's: a `complete` or `superseded` plan ends its
milestone rather than leaving it active forever.

A plan-level question may name the `decision:` that answers it, and ingestion
mirrors that decision's resolution onto the question. This is how an answered
question leaves the review queue: ingestion never deletes, and treating a
question's absence as resolution would let a document that merely trails reality
silently close live work.

When the pointer cannot be resolved, `next` refuses and names the repair:

```text
No current action could be resolved.

  ! PROJECT.md [active_plan]: PROJECT.md declares no active_plan, so no plan governs current work.
      Set `active_plan` to one of: clarification-pass, portfolio-docs-protocol.

Repairing the control documentation is the immediate work.
```

That is the intended behavior, not a failure: incomplete control documentation
*is* the work, and guessing an objective from commit history or backlog order
is exactly what this command exists to prevent.

Three outcomes are possible, and each is a complete answer:

| Outcome | Meaning |
| ------- | ------- |
| **Dispatchable** | One action resolved, no blockers, responsibility is `codex` or `autonomous`. An agent may begin. |
| **One operator question** | The current action is `question_open`. The single question is surfaced; no other action is promoted to fill the gap. |
| **Blockers** | Named file, field, and remedy for each. Repair those first. |

An action owned by `requires_review` or `blocked` resolves cleanly but is never
dispatchable — the pointer is valid, the work simply is not a coding agent's.

### The whole ready set, not just the pointer

`next` answers "what is current"; `--ready` answers "what could be current" —
every Action in the active plan with no unmet prerequisite, no unanswered
required Decision, and no open clarification question:

```sh
pnpm arcadia next --ready --workspace "$WORKSPACE" --project arcadia
```

```text
Active plan: dispatch-contract-enforcement — docs/plans/dispatch-contract-enforcement.md

Ready set (2):
  * compute-ready-set — Compute the ready set instead of only refusing a bad pointer [codex]
    surface-dispatch-journal — Surface the dispatch journal where the operator already looks [codex]

Suggested current_action: compute-ready-set (the operator still decides; nothing was written).
```

The `*` marks the suggestion. It changes nothing: if the current
`current_action` is itself in the ready set it is suggested unchanged,
otherwise the first ready Action in the plan's own declaration order is
suggested — no invented scoring, and never written without the operator
setting it themselves.

Every candidate is checked the same way a single-action lookup is, so this can
never disagree with what `next` says about that one Action. An empty ready set
still names the unfinished Action nearest to it, with its actual blockers,
rather than printing nothing:

```text
Ready set: empty. No unfinished Action is fully ready.

Nearest to ready: ship-it
  Ship the thing
  Responsibility: codex
  Blockers:
  ! docs/plans/sample-plan.md [actions.ship-it.depends_on]: Depends on "migrate", which is "open", not done.
      Finish "migrate" first, or make it the current_action, or drop the dependency if it no longer holds.
```

Not journalled like `next` and `work plan` are: it reports a whole set on
every call rather than resolving one dispatch attempt, and recording every
Action it inspects would swamp the journal's real purpose — tracking actual
dispatch attempts — with exploratory queries that never dispatched anything.

### The Agent Queue

When the operator wants to keep work moving across Projects, `advance queue`
is the single read-only feeder view. It composes the document-authoritative
ready set with active Runs, pending coding-agent packets, open Decisions, and
known repository or dispatch blockers:

```sh
pnpm arcadia advance queue --workspace "$WORKSPACE"
```

It reports three lanes:

- **Ready to feed** — Actions that satisfy the same readiness and
  responsibility rules as `next --ready`.
- **Running or queued** — Runs already admitted to the worker; wait for their
  evidence before starting another one for the same stream.
- **Needs attention before dispatch** — every known stop, with its reason,
  concrete next action, and named file/field remedy where applicable.

Mission Control shows the same projection above **What fits?**, with direct
links to the strongest existing Project, Review, or Run surface. It is a view,
not a second queue and not an approval shortcut. A plan's declared T-shirt
Token Impact and plain-language Token Budget remain visible; provider usage
limits are still observed by the existing coding-agent availability gate and
are not treated as unlimited when unknown.

### Whether the documents are earning their keep

Every resolution — from `next` and from `work plan` alike — is journalled:
what was asked, whether it was allowed, and which fields blocked it.

```sh
pnpm arcadia next history --workspace "$WORKSPACE" --limit 20
```

```text
Dispatch resolutions: 34 · dispatchable 21 · blocked 13

Blocked on:
  actions.ship-it.depends_on — 9 of 34 resolutions (26%)
  current_action — 4 of 34 resolutions (12%)

Recent:
  2026-07-26T05:43:24.205Z work.plan arcadia / portfolio-docs-protocol / ingest-mission-logs — question
```

The control documents are worth their overhead only if refusals are rare and for
good reasons, and that is not answerable from memory. A field that blocks a
quarter of all resolutions is either a rule worth relaxing or a habit worth
fixing; the tally is what tells the two apart. Fields are counted once per
resolution, so a plan with many dependencies does not outrank a rule that
quietly blocks everything.

### The executive view

```sh
pnpm arcadia portfolio --workspace "$WORKSPACE"
```

One block per Project: status, goal, current milestone, Actions in flight, and —
the number that actually decides where the next hour goes — the **clarity**
breakdown. "12 open Actions" flatters a portfolio; "4 ready, 6 unclarified, 2
awaiting an answer" tells you whether any of it is workable. Decisions waiting on
you are listed oldest-first, because the oldest unanswered question is usually
the most expensive one.

**Example scenario:** you spend an hour with a chatbot designing a migration. It
emits `docs/plans/nightly-sync-rework.md` with six actions, two of them carrying
questions instead of next actions. `docs sync --apply` creates six Actions and
two Decisions. `arcadia portfolio` then shows the project as four ready and two
blocked, and answering the two Decisions is visibly the thing standing between
you and a workable queue.

### Mission Logs

Each dated entry in a `MISSION_LOG.md` becomes one row. The whole
`## YYYY-MM-DD — title` heading is the key — `log/<slug>#<date>--<title-slug>` —
so re-running an append-only file creates only the row for the new entry, and
several entries may share a date, which real Logs do routinely. Two entries
sharing a whole heading are reported as an error, because the key cannot tell
them apart. Editing an entry's body updates its row; retitling an old entry
records it as a new one.

An entry with no `**Next:**` bullet records that it has none rather than
inventing one. Re-ingesting rewrites only what the document owns — the Did,
Result, Next, and Blockers text — and leaves any Project, Milestone, or Artifact
that Arcadia later attached to that Log alone.

### Not yet ingested

Narrative docs (`type: architecture | strategy | reference`) are parsed and
validated but not yet turned into rows; `docs sync` reports them as skipped so
you can see the protocol recognizes them.

### Action ordering and acceptance criteria

Action `depends_on` links are validated at parse time: a dependency on an id
that does not exist is an error, and so is a dependency cycle — no action in a
cycle can ever become ready, so the plan describes work that cannot start.

`arcadia next` enforces the ordering. If the current action depends, directly or
transitively, on an action that is not `done`, the dispatch is blocked and each
unmet prerequisite is named with its status and the chain that reached it.
Finish it, make it the current action, or drop the dependency. Ordering is still
not persisted to the database — it is enforced from the documents, which are
authoritative.

`arcadia work plan` enforces the same rules for any Action that came from a
managed plan, whether or not it is the current action: unfinished prerequisites,
unanswered required Decisions, and an open clarification question all refuse the
preparation and name the file and field to repair. Actions Arcadia captured
itself have no plan to be judged against and are unaffected.

An action's `acceptance_criteria` are carried through `docs sync` onto the
Action and quoted verbatim to the coding agent in the packet's Acceptance
Criteria section, ahead of Arcadia's generated guardrails. Write them as the
conditions you would check at review; they are what the agent is asked to
satisfy.

## Author A Decision Document

`review open`/`review approve` (above) manage a Decision tied to one Action's
clarification. This is the other kind: the free-standing narrative Decisions
under `docs/decisions/` — Arcadia's own portfolio-level record of "what was
decided and why." Until now those were hand-written markdown, validated only
by running a full `docs sync` or `arcadia next` afterward — which is exactly
how Decision 0014 shipped `approved` with no `answer`, and how Decision 0033
briefly carried an out-of-enum `gap_type`. Both mistakes were only caught
minutes later, by the full validator, after the fact.

`arcadia decision new` and `arcadia decision approve` write the same
documents deterministically and validate them with that same parser
*before* anything touches disk — one file in, one file out, no model call,
no repository-wide crawl:

```sh
pnpm arcadia decision new ask-request-deduplication \
  --project arcadia \
  --question "Should ask refuse a near-duplicate request instead of creating another packet?" \
  --recommendation "Check undecided packets for an exact-match request first." \
  --gap-type missing-decision \
  --confidence high \
  --json
```

This assigns the next `NNNN` id automatically, quotes any field containing a
colon so the frontmatter can't break, and refuses to write anything that
fails validation. Ratifying is the same shape:

```sh
pnpm arcadia decision approve ask-request-deduplication \
  --project arcadia \
  --answer "Yes: exact-match check before writing a new packet." \
  --json
```

`approve` accepts the numeric id, the slug, or the exact filename. It sets
`status`, `answer`, and `decided` in place — every other field an operator or
prior agent wrote is left untouched, in the order it was written — and
refuses to write if the result would fail validation, e.g. approving without
`--answer`.

`arcadia decision validate <id> --project <project>` checks one existing file
against the same rule set with no write at all, for a hand-edited document or
a suspicious one found in `advance queue`.

## Plan Work

```sh
pnpm arcadia work plan work_example \
  --workspace "$WORKSPACE" \
  --agent-profile claude_planning \
  --json
```

The plan records each step, executor type, command label, and whether the step is safe to run. Omit `--agent-profile` to use the workspace default (Codex by default). A managed planning Decision is permanently bound to the profile used when its packet was created.

## Run Safe Work

Run the latest plan for an Action:

```sh
pnpm arcadia work run work_example \
  --workspace "$WORKSPACE" \
  --json
```

Run a specific plan:

```sh
pnpm arcadia work run work_example \
  --workspace "$WORKSPACE" \
  --plan plan_example \
  --json
```

Arcadia executes only deterministic safe steps. Codex, publishing, destructive, unclear, or review-required steps pause as `requires_review`.

Explicitly approved coding-agent steps can be run through configured profiles:

```sh
pnpm arcadia work run work_example \
  --workspace "$WORKSPACE" \
  --plan plan_example \
  --allow-codex-planning \
  --agent-profile codex_planning \
  --json
```

`--allow-codex-build` is separate from `--allow-codex-planning`. Arcadia refuses `danger-full-access` profiles in managed runs.

The built-in managed profiles are `codex_planning`, `codex_build`, `claude_planning`, and `claude_build`. The `codex` wording in the two allow flags is retained as a compatibility name for coding-agent work.

For a generic approved implementation Decision, choose a built-in review executor directly:

```sh
pnpm arcadia review approve review_example \
  --workspace "$WORKSPACE" \
  --execute \
  --executor claude-code \
  --json
```

The other built-in review executors are `codex` and `gemini`. Custom CLI adapters such as OpenCode or Aider can be configured in `config/arcadia.json` or the target repository's `.arcadia/executors.json`.

## Review A Run

```sh
pnpm arcadia run show run_example \
  --workspace "$WORKSPACE" \
  --json
```

This includes run status, plan steps, step outcomes, mission log path, linked artifacts, and the compact `needsOperator` compatibility list.

## Common Execution Loop

```sh
capture_json="$(pnpm arcadia capture --workspace "$WORKSPACE" --text "Generate status report" --json)"
work_id="$(printf '%s' "$capture_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.workItem.id))')"

plan_json="$(pnpm arcadia work plan "$work_id" --workspace "$WORKSPACE" --json)"
plan_id="$(printf '%s' "$plan_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.plan.id))')"

run_json="$(pnpm arcadia work run "$work_id" --workspace "$WORKSPACE" --plan "$plan_id" --json)"
run_id="$(printf '%s' "$run_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.run.id))')"

pnpm arcadia run show "$run_id" --workspace "$WORKSPACE" --json
```

## Existing Daily Commands

```sh
pnpm arcadia project list --workspace "$WORKSPACE"
pnpm arcadia queue --workspace "$WORKSPACE"
pnpm arcadia dashboard snapshot --workspace "$WORKSPACE" --json
pnpm arcadia work list --workspace "$WORKSPACE"
pnpm arcadia report status --workspace "$WORKSPACE"
pnpm arcadia review weekly --workspace "$WORKSPACE"
pnpm arcadia artifact list --workspace "$WORKSPACE" --json
```

### Progress review, per Project or portfolio-wide

```sh
pnpm arcadia review weekly --workspace "$WORKSPACE"                       # whole workspace
pnpm arcadia review weekly --workspace "$WORKSPACE" --project rebuster    # one Project
pnpm arcadia review weekly --workspace "$WORKSPACE" --project rebuster \
  --since 2026-07-01 --until 2026-07-31                                   # any bucket
```

Deterministic throughout — it compiles completed Actions, Logs, blocked work,
Decisions, and Artifact changes from existing rows. No model runs.

`--project` narrows every section to that Project and writes to
`reports/weekly/<slug>/<until>.md`, so a Project review never overwrites the
portfolio one for the same date. The two answer different questions: pooled
says what happened, scoped says whether *this* moved — which pooling hides,
because one busy Project reads as a productive week while four others sat
still. The "Projects Without Open Next Actions" section is portfolio-level and
is omitted from a scoped report.

`--since`/`--until` are free-form, so the "weekly" name is only the default
window — daily, monthly, or quarterly buckets are the same command.

When the workspace has opted into vault memory (`memory.enabled`), each review
is also projected into Obsidian as a `record_type: progress_review` Record under
`Arcadia/Records/Progress/<scope>/<year>/`. Unlike an accepted planning
Artifact, this is **not** gated behind a Decision: a progress review is a
deterministic compilation of things that already happened, so there is no
generated content to accept. Re-running a review that found nothing new is a
no-op — the Record is hashed with its generation timestamp excluded, so an
unchanged window does not churn the vault. A vault misconfiguration is reported
but never costs you the report.

### Preview or refresh a Project living-system story

```sh
pnpm arcadia memory system sync --workspace "$WORKSPACE" --project arcadia
pnpm arcadia memory system sync --workspace "$WORKSPACE" --project arcadia --apply
pnpm arcadia memory system sync --workspace "$WORKSPACE" --all --json
```

Exactly one of `--project` and `--all` is required. Preview is read-only and
reports created, updated, unchanged, stale, skipped, and refused entries;
`--apply` writes the same deterministic projection beneath
`Projects/<project-slug>/`. One bad Project does not stop `--all`. The command
uses the configured repository and Obsidian vault, makes no model or network
call, never installs a plugin, and never treats vault edits as authority.

Each repository owns its `docs/living-system.yaml`. Managed Project documents
and optional explicit `Action: plan-slug#action-id` Log lines supply history.
Generated pages expose provenance and freshness and remain useful as plain
Markdown; WikiLinks, transclusions, Markmap panes, and the Canvas split view are
progressive enhancements. To rebuild or roll back, operate only on the marked
generated Project subtree and re-run `--apply`; collisions with unmarked files
are refused and stale generated pages are retained rather than deleted.

Update an Action manually:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --queue work_queue \
  --responsibility autonomous \
  --next-action "Run the deterministic skill" \
  --status in_progress \
  --json
```

Mark an Action done:

```sh
pnpm arcadia work done work_example --workspace "$WORKSPACE" --json
```

## Time, Scale, And Reports

Give a ledger entry a coarse size so Arcadia can reason about time cost.
Sizes are `quick` (≤15m), `short` (≤1h), `session` (1–3h), and `project`
(multi-session). Use `none` to clear one.

```sh
pnpm arcadia orientation entry update oentry_example --workspace "$WORKSPACE" --effort session
pnpm arcadia work update work_example --workspace "$WORKSPACE" --effort short
```

Say what today actually holds, then ask what fits a real gap. Both the fit
query and the packet's plan are deterministic — no model call.

The daily Discord Orientation Packet also includes a deterministic morning
narrative assembled from recent Logs, completed Actions, ready Artifacts,
pending Decisions, and blocked Actions. It highlights recent operating
changes, compares the last seven days of completed-Action throughput with the
preceding seven, names visible drag, and points out a likely coding-agent
handoff. It never invents causes or outcomes, and it does not depend on a model
being available at send time.

```sh
pnpm arcadia orientation capacity set --workspace "$WORKSPACE" \
  --note "one client session + ~1h of fragments; evening gone" \
  --session-blocks 1 --fragment-minutes 60
pnpm arcadia orientation fits --workspace "$WORKSPACE" --minutes 20
pnpm arcadia orientation timeline --workspace "$WORKSPACE"
```

Log real work you already did. `--at` is a local clock time and is optional;
so is linking the block to a ledger entry.

```sh
pnpm arcadia time log --workspace "$WORKSPACE" \
  --minutes 90 --description "Nav and contact form on the practice site" \
  --at 09:00 --entry oentry_example
pnpm arcadia time list --workspace "$WORKSPACE" --days 7
```

Read the story back. `activity` shows the raw interaction log Arcadia keeps
for free; the reports compose it into what moved, where the time went, and
what is becoming urgent.

```sh
pnpm arcadia activity --workspace "$WORKSPACE" --days 7
pnpm arcadia report daily --workspace "$WORKSPACE"
pnpm arcadia report weekly --workspace "$WORKSPACE"
```

The same natural-language reply loop understands all of it — sizes, capacity,
and time already spent:

```sh
pnpm arcadia orientation reply "the disposal's a whole afternoon" --workspace "$WORKSPACE"
pnpm arcadia orientation reply "today I have one client session and about an hour of gaps" --workspace "$WORKSPACE"
pnpm arcadia orientation reply "I spent about an hour on the car mirror this morning" --workspace "$WORKSPACE"
pnpm arcadia orientation reply "I have 20 minutes, what fits?" --workspace "$WORKSPACE"
```

## Working-Copy Safety

Scan every active Project's configured repository and all of its Git worktrees
and unmerged local branches without changing repository state:

```sh
pnpm arcadia work monitor --workspace "$WORKSPACE"
pnpm arcadia work monitor --workspace "$WORKSPACE" --json
pnpm arcadia work monitor --workspace "$WORKSPACE" --no-pull-requests
```

The scan reports preservation (`UNSAVED`, `LOCAL ONLY`, `PUSHED`,
`IN PR`, `LANDED`) separately from delivery (`WORKING`, `DRAFT`, `REVIEWABLE`,
`MERGE-READY`, `BLOCKED`). GitHub lookup is best-effort and read-only; with
`--no-pull-requests`, local Git evidence remains complete except for PR state.

Reconcile one completed coding-agent worktree and verify the repository's next
governed handoff:

```sh
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree --agent codex --apply
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree --agent claude --apply
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree --agent claude --apply --model claude-opus-5 --effort high
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree --json
```

The first command is a deterministic preview. `--apply` is accepted only when:

- the source and any checked-out base worktree are clean;
- the source has a named agent-owned branch (`codex/`, `claude/`, `agent/`, or
  Claude Code's `worktree-` prefix);
- the local base branch is an ancestor of the source, so integration is a
  strict fast-forward;
- the repository resolves exactly one dispatchable Arcadia Action with no open
  Decision or document blocker; and
- the source is neither detached nor historically divergent.

On success, Arcadia fast-forwards the local base branch, removes a linked
source worktree or switches a primary task checkout back to the base branch,
deletes only the now-merged source branch, prunes worktree metadata, rechecks
dispatch, and reports the base ref plus the `arcadia advance` handoff. With
`--agent codex` or `--agent claude`, it also creates a uniquely named isolated
worktree from that updated local base and prints an exact launch command,
pinned to a model: `--model` on the command line, else the plan's
`recommended_model` (and optional `recommended_reasoning_effort`), read from
the plan as it exists *after* the fast-forward — the recommendation itself may
be new content the merge just introduced. Neither resolving is a refusal;
Arcadia will not launch an agent session unpinned. That refusal does not
undo an already-completed fast-forward, since the two are independent
outcomes: retiring the finished worktree is valid on its own, with or without
a next agent session. It does not stage, commit, reset, force-merge, push,
open a PR, or launch an agent process implicitly.

This command intentionally evaluates only the named source worktree. Other
worktrees remain untouched. Unsafe source state is a refusal with an exact
remedy, not permission to clean it automatically.

List every open GitHub pull request across Project repositories with
plain-English readiness ratings. This is read-only and reports repository
configuration or GitHub lookup errors explicitly:

```sh
pnpm arcadia work prs --workspace "$WORKSPACE"
pnpm arcadia work prs --workspace "$WORKSPACE" --json
```

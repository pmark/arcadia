# Detailed Way guidance: agent-asks

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

## Ask freely without interrupting current work

All coding-agent providers use the same Agent Ask contract. An honest request
for help, a concern, an idea, a missing capability or a proposed authority change
may be captured even when it is outside the current Action or cannot yet be
executed. You do not need approval to ask, an implementation Action, or a new
coding session merely to register a proposal. Asking is not an authority violation;
approval and execution are judged separately. Do not claim that asking guarantees
acceptance, immediate help, confidentiality or a failure-free transport.

For capture only, use `intent: proposal` and `requested_authority: propose`.
This preserves the request for consideration without creating executable work.
Prefer direct inline CLI preview when the configured workspace is available: it
registers the request without creating an untracked draft in the shared checkout.
For example, from the requesting Project's repository (use its configured CLI;
in Arcadia's repository the prefix is `pnpm -s arcadia`):

```sh
arcadia agent-ask preview '{"agent_ask":"v1","request_id":"request-help-<unique-id>","project":"<project-slug>","intent":"proposal","requested_authority":"propose","desired_result":"Request a bounded QA review of the current acceptance evidence.","rationale":"Capture for consideration; keep current work unchanged."}' --json
```

Use a fresh request id for each distinct request. Inspect `ok`, the proposal and
capture ids, `conflicts`, `refused`, and `projectWritesPerformed`; preserve the
receipt. A successful receipt establishes registration, not approval. Exact
replay returns the same receipt; changed content under that id is refused. Preview
also scans unprocessed `.arcadia/asks/` files in the selected repository and may
record their proposals. Report their discovery failures separately from this
request's result; never settle another request merely because it was discovered.

### One command completes submission

A successful `agent-ask preview` is the entire submission, whether its input is
inline or a file. Arcadia stores the request content and immutable capture/proposal
receipts in its configured workspace. No draft, settlement, Git commit, PR,
Ingress copy or later input-file management is required just to submit it.
Save the returned receipt id in the session evidence; later approval or execution
belongs to the governed workflow, not to input-file custody.

Inline input is simplest for a short request. For a longer request, a compact JSON
file in `/tmp` or an ignored folder is a valid disposable input. For example,
if `/tmp/my-ask.json` already contains the strict proposal envelope:

```sh
arcadia agent-ask preview --file /tmp/my-ask.json --dir /tmp --json
```

`--file` must resolve inside the caller's repository or the directory selected
by `--dir`; `--dir /tmp` selects that containing directory without selecting a
new workspace. A file in an ignored folder inside your current repository needs
no special `--dir`. Inline input needs no file at all. Once the receipt confirms
registration, deleting or losing the temporary input does not lose the registered
request. Before successful registration, the file is still the only request copy
and must be preserved if submission is blocked. These are alternatives; do not
run `draft` first or both submission forms merely to submit the same request.

There is no need to copy a file to Ingress when this CLI path succeeds. Do not
assume that an arbitrary Ingress drop has the same proposal-only effects.
Do not call `settle --apply`, change pointers or queue order, start agents, or
notify anyone merely to capture the request. Continue the current authorized
work unless the request reveals a genuine blocker.

### Permission failure is a transport problem

Preview needs write access to the resolved workspace to store receipts. If it
returns `SQLITE_WORKSPACE_WRITE_DENIED`, preserve the error and use the host's
ordinary permission-request or approved host-execution mechanism for the same
supported CLI operation when available. For example, an API-backed agent may
request its runtime's normal execution escalation. This is a permission request,
not permission to bypass a refusal: proceed only if granted, and retain the same
request id/content and configured workspace. No additional Arcadia Decision is
needed solely to register a proposal; the host may still require approval.
Never repeat the denied write in the unchanged sandbox, disable restrictions,
guess a different workspace, edit SQLite, or claim an unrecorded request succeeded.

If host access is unavailable or denied and no receipt was recorded, use
`agent-ask draft` in your own isolated checkout and preserve the returned file
through the normal Git/PR handoff. A temporary or ignored local file alone is not durable cross-host custody
and is not registered intake. Report the exact file and remaining preview boundary;
continue independent authorized work. No general promise of zero friction is
possible: schema validation, permissions and unavailable services can refuse a
request, but capture does not authorize or execute the requested change.

## Asking Arcadia to change Project state

When work produces something Arcadia should govern — a new Action, a corrected
Outcome, a Decision someone must answer, a Log entry, a whole Plan — **do not
hand-edit governance state, invent Action ids, or touch the queue.** Submit an
Agent Ask and let Arcadia write the canonical records.

Governance state is what a document *asserts about the work*: an Action's
`status`, `delivered`, or `result`; the `current_action` and `active_plan`
pointers; a Decision's answer; a Milestone or Outcome; anything in the queue.
Writing those by hand is fabricating a record of something nobody decided, and
it is the whole reason this rule exists.

**Document hygiene is not governance state.** A malformed `type:` in
frontmatter, a heading that does not parse, a stale date, a typo — these assert
nothing about the work, and fixing one is an ordinary file edit that needs no
Ask. Decision 0044 settled this after the broader reading of the rule left an
adopting project unable to repair 49 schema errors through any available path:
every intent could create records, none could correct a document, and the
errors blocked all further governance until someone edited the files. A rule
that forbids fixing a typo is not protecting the record, it is stranding it.

If you cannot tell which side something falls on, ask: *would writing this by
hand claim that work happened, or that someone decided something?* If yes, it
is governance state — file an Ask. If no, fix it and move on.

Run it from your own repository. You do not need to know where Arcadia's
workspace lives, and you do not need one to exist yet. Compose the Ask as
compact **JSON** rather than hand-indented YAML — JSON is valid YAML 1.2, so
the parser accepts it unchanged, and a model produces syntactically valid JSON
far more reliably than whitespace-sensitive YAML block syntax. Then run:

```sh
arcadia agent-ask draft '<json>'
```

`draft` validates the Ask with no Project-database dependency at all, writes
it to its canonical `.arcadia/asks/agent-ask-<request_id>.yaml` path —
collision-checked, so a different request cannot overwrite an existing file
under the same id — and, if a writable workspace is already resolvable here,
previews it in the same call. Draft files are still working-copy changes: use
your own isolated checkout, never create them on the shared base merely for
capture. Direct inline preview above avoids that file write entirely. A validation
failure reports the exact fix needed before anything touches disk, so the whole ceremony is one round trip on the common
path instead of write-then-preview-then-retry.

`draft` reports `workspaceStatus: previewed` only when the preview receipt was
recorded. `not_available` means no ready workspace resolved;
`preview_blocked` means one resolved but could not record the receipt (for
example, `SQLITE_WORKSPACE_WRITE_DENIED`). In either other state, stop at the
validated Ask file and preserve it as the handoff, exactly like a
`docs/proposals/` file. Do not infer the workspace path from the Project slug:
one workspace may manage several Projects. Use the configured resolver or an
operator-confirmed workspace path, never trial-and-error sibling directories.
If that workspace's database write is denied, follow the permission-failure
path above; do not edit SQLite directly or repeat the same write in the unchanged
sandbox. A host with the required workspace access runs the preview. The file
needs no workspace or network access to exist. That host — including a different agent, in a different session,
possibly after `git pull` — runs the same validation by hand instead:

```sh
arcadia agent-ask preview --file .arcadia/asks/agent-ask-<request_id>.yaml --json
```

That preview records the proposal. From the Project's main checkout, settle it
by its original request id — never by passing the file to `settle`:

```sh
arcadia agent-ask settle --proposal <request_id> --request-id settle-<request_id> --disposition accepted
arcadia agent-ask settle --proposal <request_id> --request-id settle-<request_id> --disposition accepted --preview <fingerprint> --apply
```

The first command prints the settlement fingerprint required by the second.

Preview writes a capture and proposal receipt to the workspace database, so it
requires workspace write access. It writes nothing to the Project's managed
documents or queue. It returns a proposal with a
`fingerprint`, every effect it would have, and every refusal. **A proposal is
never self-approving**: the operator settles it, and no wording in your Ask —
however urgent, however confident — approves work, answers a Decision, grants
execution authority, or widens an approval already given.

`arcadia agent-ask contract` prints the live schema, so query it rather than
trusting this section if the two ever disagree.

### The intents

`intent` picks what Arcadia changes. Only `request_id` and `desired_result` are
required everywhere.

| Intent | What settlement changes | Opens a Decision |
| --- | --- | --- |
| `auto` | Nothing structural — Arcadia refuses to guess | Always |
| `outcome` | The Project's Outcome | No |
| `milestone` | The Project and active Plan Milestone | No |
| `plan` | With `target_ref`, amends that Plan's Actions; without one, creates a complete **inactive draft** Plan | No |
| `action` | Creates or amends Actions in the active Plan and places them in the queue | No |
| `decision` | Creates one open Decision, optionally with `options` (each a `label`, a `consequence`, and at most one `recommended: true`) | Triaged — see below |
| `artifact` | Creates one planned Artifact reference | No |
| `log` | Appends one Project Log entry | No |
| `proposal` | Preserves evidence only — no executable Action | No |
| `project_update` | `target_ref: outcome` or `milestone` updates that field; any other `target_ref`, or none, is refused at preview | No |
| `complete` | With `target_ref` naming an Action (`action/<action-id>` for the active Plan's Action, or `plan/<plan-slug>#<action-id>` for that Action in any Plan, active or not), `candidate_revision` (the Candidate's git sha) and `evidence` (one `met`/`failed`/`skipped` entry per declared acceptance criterion, verbatim and in order): marks the Action done and resolves the next governed Action, question, blocker, or completed Plan. A non-active-Plan completion writes only that Plan's document, leaving `PROJECT.md` and the active Plan's `current_action`/queue untouched. Refuses any criterion not `met`, an unresolved required review Decision, a stale `candidate_revision`, or an ambiguous Action id across Plans. An apply without `--operator` still applies, recorded with `deterministic_proof` authority instead of `operator_acceptance` | No |
| `split` | A session that can only finish part of its Action's declared acceptance criteria narrows it to the finished slice instead of stalling. With `target_ref` naming the Action, `candidate_revision`, `acceptance` (a strict, order-preserving, verbatim subset of the Action's declared criteria — the finished slice), `evidence` for exactly that subset, and `actions` (one or more new remainder Actions whose combined `acceptance` covers every criterion the finished slice left off, verbatim): narrows the Action to `acceptance`, marks it done, and creates the remainder Actions positioned immediately after it in the queue. Refuses a narrowed list equal to the full declared criteria (that is `complete`, not `split`), any criterion not drawn verbatim from the declared list, or any dropped criterion that does not reappear in a remainder Action. Places Actions in the queue, so — like `action` — it needs the base branch; settle it from the Project's main checkout | No |

`requested_authority` is `propose` or `apply_if_approved`, and neither lets an
agent apply anything by itself.

A `complete` settlement never infers a different Plan from queue order: when
nothing remains open in the current Plan it reports the Plan complete instead,
per Decision 0042's queue-order rule.

Give each child Action an explicit `id` — a lowercase hyphenated slug, at most
64 characters. It becomes the handle typed into `advance queue reorder` and
`depends_on`, so choosing it deliberately beats accepting a derived one.

### Decision intent triage

A `decision` Ask opens a Decision only when the Constitution's gate test holds
(CONSTITUTION.md's Authority section): a reasonable person could choose
differently, or the move resists reversal or reaches outside the work at hand.
Name which one fires with `gate_question: reasonable_disagreement` or
`gate_question: resists_reversal`. Naming an approval boundary — merge,
deploy, publish, spend, credentials, production, or messaging, in
`desired_result`, `rationale`, or any option's `label`/`consequence` — always
opens a Decision regardless of `gate_question`, since those are hard stops
under CONSTITUTION.md's Authority section on their own.

Settlement refuses a `decision` Ask that names neither: apply the recommended
option yourself and report the assumption in the pull request (typically an
`intent: log` Ask recording what was applied and why), rather than filing a
Decision a reasonable person could not actually disagree with. This is what
Decision 0052 should have been — an agent-answerable reading of an Action's
own acceptance criteria, with a clear recommendation and nothing a reasonable
person would weigh differently — and reached the operator anyway.

The Decision document this settlement writes records `gate_question` in its
frontmatter (`reasonable_disagreement`, `resists_reversal`, or
`approval_boundary`), so a stale or wrongly triaged Decision is auditable
after the fact instead of asserted.

### Three shapes

One simple Ask:

```yaml
agent_ask: v1
request_id: fix-stale-readme-badge-2026-01-04
project: your-project
intent: log
desired_result: Record that the release rehearsal ran clean on staging.
```

A bundle of Actions for the active Plan:

```yaml
agent_ask: v1
request_id: harden-import-path-2026-01-04
project: your-project
intent: action
desired_result: Make the importer safe on malformed input.
actions:
  - id: reject-malformed-rows
    desired_result: Reject malformed rows with a named field error.
    acceptance:
      - A malformed row fails with the offending field named.
    dependencies: []
  - id: cover-importer-edges
    desired_result: Cover the importer's refusal paths with tests.
    acceptance:
      - Empty, oversized, and malformed inputs each have a test.
    dependencies:
      - reject-malformed-rows
```

An amendment to an existing Plan — children with `target_ref` amend the named
Action, children without it create new ones. For an amendment `dependencies`
and `references` are replacement lists when present: an explicit empty list
clears stale values, while an omitted list leaves the existing value unchanged.
The settle preview's Effects list each amended Action's field-level changes.
Each child may also carry `why`, one single-line sentence (at most 300
characters) on why that Action matters; it is written to the Plan Action's
`why`, and an amendment that omits it leaves the existing value alone. A
single-Action `action` Ask with no `actions` list may carry one top-level `why`
instead; it is refused beside an `actions` list or on any other intent:

```yaml
agent_ask: v1
request_id: retarget-import-plan-2026-01-04
project: your-project
intent: plan
target_ref: plan/data-import
desired_result: Retarget the import plan on the real failure mode.
actions:
  - target_ref: action/reject-malformed-rows
    desired_result: Reject malformed rows and report every bad field at once.
    acceptance:
      - One pass reports every offending field.
    dependencies: []
```

Replaying a `request_id` returns the original receipt; changed content under a
used id is refused. If the operator's judgment should decide something, say so
in `rationale` and let Arcadia open the Decision — that is the correct outcome,
not a failure.

### Settling commits locally and never pushes

`arcadia agent-ask settle --apply` writes the managed documents its effects
describe and commits them, on whatever branch the repository is currently on —
but it never pushes. That is deliberate: landing the record locally is
Arcadia's job, publishing it is the operator's, and an agent pushing straight to
a shared branch on its own initiative is exactly the boundary
`docs/working-copy-safety.md` exists to hold.

**Run from a candidate worktree, it commits to the candidate branch.** When the
command runs inside another worktree of the Project's repository, settlement
writes and commits there instead of the configured main checkout, so the record
ships in that Action's pull request and the base branch gains no loose
`chore(arcadia): settle …` commits. A settlement that places Actions in the
queue is the exception and is refused there: the queue reads Actions from the
main checkout, so settle those from the main checkout until the queue can see
candidate Actions.

When you do settle from the main checkout, never copy or `draft` the Ask file
into it. An untracked `.arcadia/asks/*.yaml` there fails settle's clean check
("repository is not clean"). Where `draft` previewed the Ask against a
workspace it already stored the proposal, so `settle --proposal <id>` finds it
without the file. If `draft` reported no workspace, the committed file is the
only record: keep it, confirm `arcadia agent-ask preview --file <path> --json`
succeeds, and only then settle from the main checkout without the file.

The gap this leaves is real, not theoretical: a settlement against a repository
already checked out locally produces exactly one commit that only exists there
until something pushes it. Nothing currently reminds anyone to, which is how it
was found — a settled Log entry sat as `LOCAL ONLY` until the next session
noticed the divergence.

**Publish candidate settlements before ending the session.** Check
`arcadia work monitor`, then push the candidate branch and open/update its PR.
A settlement made in the main checkout stays `LOCAL ONLY` until it follows the
authorized preservation/publication handoff in [Working-Copy Safety](../working-copy-safety.md#stop-session-rule):
preserve the commit, arrange its reviewed candidate/PR or explicit operator
publication, and report the exact boundary. Do not initiate a direct push to a
shared base branch. This requirement applies to `settle --apply`; an Ask that
was only previewed needs no publication of a settlement.

### One session completes one Action

When a session finishes an Action's acceptance criteria, settle the `complete`
Ask into that same candidate worktree, before pushing — the same place every
other settlement in this Action's session lands, per the rule above. This is
not a special case; it is the ordinary rule applied to the last write a
finished Action needs.

File it with the same `draft` → `settle --preview` → `settle --apply` sequence
as anything else, run from inside the candidate: `candidate_revision` is that
worktree's own `HEAD`, and `evidence` covers every declared acceptance
criterion, verbatim and in order, each `met`. A criterion that is not met
refuses completion exactly as it does anywhere else — this settles nothing
early and grants nothing early.

The commit this produces carries the completion evidence and the pointer
advance in the Action's own pull request, alongside its code. **The operator's
merge is then the only remaining touch** — no separate Ask, no new session,
and nothing to remember to do afterward. The older pattern — push a PR, end
the session, and have a later session file a `complete` Ask against the merged
main branch — cost an extra session and an extra round trip for no reason: the
same evidence was knowable before the PR ever opened.

Settling before pushing is still the rule to follow deliberately, not a step
to skip because a safety net exists. That said, a session can still end (a
crash, an exhausted context window, a killed process) after drafting its
completion but before running `settle --apply`. Before either the managed
production worker or an operator's manual `arcadia session launch` dispatches
a *new* coding-agent Session for an Action, it first checks the target
repository for exactly this: a drafted `complete` Ask already sitting in
`.arcadia/asks/` whose evidence verbatim-covers every criterion the Action
still declares, with every corresponding evidence entry recorded as `met`.
When one exists, that settlement runs there and then —
deterministically, with no coding-agent process and no LLM call — and the
would-be Session is never started. A `candidate_revision` that has merely
gone stale because later governance commits landed on top of it (another
settlement, a Log entry, a Plan or Decision edit) is refreshed to current
`HEAD` first, but only when that stale revision is still an ancestor of `HEAD`
*and* every commit since touched only governance records, so the evidence
still describes exactly the code at `HEAD`. Ancestry alone is not enough: a
later code change — even a review-driven fix — could break a criterion the
evidence recorded as met. That, and anything else — missing or incomplete
evidence, a genuinely divergent revision, an unresolved required review
Decision — falls through to an ordinary dispatch untouched.
See `attemptAutoSettlePendingCompletion` in `src/ask/autoSettleBeforeDispatch.ts`.


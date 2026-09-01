# Arcadia: Start Here

Installing Arcadia on a new machine, especially to make sense of an existing
AI-built project? Give your coding agent
[`INSTALL_WITH_A_CODING_AGENT.md`](INSTALL_WITH_A_CODING_AGENT.md). It covers
the minimal source installation, private workspace setup, repository adoption,
and first release audit. The hostnames below describe the maintainer's
configured instance; they are not portable installation defaults.

This is the canonical brief operator guide. From an iPhone, iPad, or any device on the tailnet, open **Mission Control** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/> — this is the link that actually works from a phone, verified live rather than assumed. On this Mac only, <http://127.0.0.1:3020/> reaches the same dashboard without going through Tailscale.

Open **Now** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/now> (on this Mac: <http://127.0.0.1:3020/now>). This is the screen to bookmark. It answers one question — how far away is the single thing that matters, and what is the one next move toward it — and refuses to answer any other. The target, the Project that owns it, and the gates that stand between you and it are declared in `NORTH_STAR.md` at the workspace root; edit that file to change what the screen measures. Below the distance, local Intelligence writes a short, specific account of what actually happened this week from the commit subjects in each Project's repository, followed by the share of the week's commits that landed in the target Project. One action is offered at full size, and one fifteen-minute alternative that is still on the target. The same brief is available in the terminal:

```bash
pnpm arcadia now --narrate
```

Drop `--narrate` for the deterministic pass, which makes no model calls and returns immediately.

Open **Path** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/path> (on this Mac:
<http://127.0.0.1:3020/path>) for the other question Now deliberately refuses: not
"what do I do in the next hour?" but "what is actually left between here and the
target?" Each `NORTH_STAR.md` gate becomes a leg, and under it every Action the
plan documents place before that gate, ordered by the `depends_on` those
documents declare — dependencies first, the gate's own Action last. Finished
steps are kept and collapsed, because a path with sixteen done steps behind it
reads differently from one that has not started; **Show the finished steps**
expands them.

Where nothing is planned, the path says so at full weight rather than leaving a
blank: an operator-owned gate no Action tracks, a gate whose `action:` reference
no plan carries any more, and an Action whose next move is still undecided each
render as a marked gap. That unplanned stretch is usually the real distance to
the target, and every surface that showed it as empty space taught you to read a
short list as a short distance.

Nothing can be added on this screen. It is a projection of `NORTH_STAR.md` and
the plans behind it — to change the path, change those documents. The same view
is in the terminal:

```bash
pnpm arcadia path
```

Under **The finish line**, gates that only you can see are tappable — a real
practitioner agreeing to be the pilot is not something Arcadia can observe, so
you tell it. One tap marks the gate done and the distance falls immediately;
tapping again undoes it. Gates that track an Action are not tappable, because
their status comes from that Action's record and a tap would put the document
and the database into disagreement. The same two verbs work in the terminal:

```bash
pnpm arcadia gate complete pilot-recruited
```

Use `gate reopen <id>` to undo. Both edit only the one `status:` line in
`NORTH_STAR.md` and leave the rest of the file exactly as you wrote it.

Open **System Status** at <http://127.0.0.1:3020/admin/status> when you need a quick readiness check. It shows whether Arcadia is ready for normal operation, image generation, and background processing, with live dependency reachability, worker heartbeats, and Intelligence job counts.

Open **Dispatch Journal** at <http://127.0.0.1:3020/admin/dispatch-journal> to see how often Arcadia refused to dispatch work, and which field in the managed documents blocked it. A field that blocks a large share of resolutions is either a rule worth relaxing or a habit worth fixing. It is read-only, like every other admin surface.

Open **Outstanding PRs** at <http://127.0.0.1:3020/admin/pull-requests> to see every open pull request across configured Project repositories, grouped with its Project, branch, review/check state, and plain-English readiness rating. Each card now includes a deterministic **Briefing**: changed paths, files not named in the PR body, managed pointer or plan changes, governed Decision documents, schema or migration changes, outward-facing paths, branch-order collisions, and the current CI conclusion. Expand the changed-path list when you need the evidence behind a fact. This view is read-only and never approves, merges, comments, or dispatches a PR; if GitHub cannot provide the detail payload, the inventory remains visible and the card says that briefing facts are unavailable.

Open the **QA queue** at <http://127.0.0.1:3020/qa> to test each configured Candidate from one exact procedure. The queue shows the configured revision, target state, validation and evidence freshness; **Test Candidate** opens only that configured target. **Check** runs the live reachability probe without delaying page load; an access-protected target that returns 403 is labelled unverifiable from here, not unhealthy. Above the Candidate cards, a **project strip** shows each configured Project once — the branch its checkout is actually on, its HEAD, how far it has drifted, and what its services report. Updating a checkout is a Project operation, so it lives there rather than repeating on every target card. Each strip offers one primary action for the state it is in: **Check for updates** fetches origin's refs and touches nothing else, **Pull *n* commits** fast-forwards without restarting, and **Restart services** is offered separately — and only when the incoming diff says it is needed. The verdict is computed from the changed paths before you pull, so a lockfile change reads as *install then restart* while a stylesheet reads as *HMR should cover this*; the files behind every verdict are one tap away, and the wording never claims a restart is unnecessary, only that HMR should cover it. **Check** stays available even when the pull is refused, because fetching never touches the working tree. When a checkout is on some other branch or detached, the strip offers **Switch to *base*** — one destination, the Project's own base branch, never a branch picker. Switching leaves the branch it moved away from exactly where it was, and says whether that branch had commits origin does not, so moving away from unmerged work is stated rather than silent. A dirty tree is refused before anything happens, and being ahead of origin is refused too — those stay yours to resolve. Remote targets never offer pull or restart because their deployment workflow owns that authority, and Projects without `scripts/services.sh` say plainly that Arcadia cannot restart them. Record Pass, Fail, or Needs follow-up with an optional note to create a revision-bound Decision. This records QA evidence only—it never merges, deploys, or releases work. Target configuration lives in the workspace at `config/qa-targets.json` — repository paths and LAN hostnames are facts about one machine, so they are not checked in; `config/qa-targets.example.json` documents the shape. Revision, validation, and evidence freshness are computed from each project's checkout rather than typed by hand.

Every Project Detail page at <http://127.0.0.1:3020/projects/{id}> now opens with a **demo hero**: one state — proof unavailable, Candidate failure, ready for your demo, QA failed, release Decision needed, or Stable-only — with exactly one primary next action, resolved from real checks rather than claimed. Below it, each configured Stable and Candidate target gets its own card with URL, environment kind, access state, source revision, health, and last verified time, plus its own **Show Stable** / **Test Candidate** link (works from a phone-reachable Mission Control whenever the target itself is not local-only) and a **Check now** button that runs a live reachability probe and persists the result. Stable/Candidate targets are a projection of the same workspace `config/qa-targets.json` list; a Candidate target reuses its QA queue id so a recorded QA Decision (`arcadia qa record`) is reflected in the hero automatically. Run a check from the command line with:

```sh
pnpm arcadia proof-target check <target-id>
```

For independent pull-request QA, give Arcadia the full GitHub URL:

```sh
pnpm arcadia qa pr https://github.com/owner/repository/pull/123
```

Use one token-efficient sequence: finish the Candidate, publish the complete
operator QA plan in the pull request, mark the pull request ready, wait for all
GitHub checks to complete successfully with an acceptable merge state, then run
Arcadia QA once. A draft, absent checks, any pending or non-success check,
conflicting duplicate checks, or a dirty or blocked merge state returns a
machine-readable not-ready refusal before patch retrieval, reviewer selection,
sandbox preflight, model invocation, QA Artifact creation, or QA Decision
creation. The refusal names every observed blocker and the retry condition; it
uses no reviewer tokens. Use `--rerun` only for a fresh independent judgment of
otherwise unchanged ready evidence, never to bypass readiness.

The repository must belong to a configured Arcadia Project. The command freezes
the current head SHA, reads the pull-request body, changed files, complete patch,
merge state, and GitHub checks, then runs one separately executed read-only
structured review inside an evidence-only, home-denied, network-denied sandbox.
The reviewer receives the exact base/head patch and no repository working copy,
credential-bearing home context, user tools, or configured command arguments. It
first establishes readable host controls for a Codex auth file, the Project's
Git HEAD, and GitHub network access, then requires the same sandbox invocation
to read its evidence while denying those exact controls. An unavailable host
baseline is Needs follow-up rather than being mistaken for sandbox denial. Its verdict must
exhaustively validate and cover Arcadia's seven fixed QA criteria. The command
rechecks the complete mutable evidence snapshot afterward and writes a QA report
Artifact plus a revision-bound Pass, Fail, or Needs-follow-up Decision under the Arcadia
workspace's `artifacts/qa/pull-requests/` directory. A failed, pending,
contradictory, missing, or stale check prevents Pass. Repeating the command for
the same completed revision with unchanged body, base, files, merge state, and
checks returns the existing receipts without another model call. Changed GitHub
evidence automatically creates a preserved new attempt; use `--rerun` only when
a fresh independent judgment of otherwise unchanged evidence is worth the added
token cost. The canonical receipt is only a cache hint: reuse reconstructs the
result from the independently persisted Decision context and cross-checks the
Artifact, Decision status, PR source, evidence fingerprint, paths, and stored
file hashes. Any mismatch creates a fresh review instead of trusting the cache.

Pull-request QA never runs commands copied from PR prose, edits the Candidate,
posts to GitHub, approves release, merges, deploys, or repairs a finding. It is
evidence for the operator's Decision, not that Decision's external effect.

## The four queues

Every item Arcadia tracks sits in exactly one queue, and the queue says who
owes the next move:

| Queue | Meaning |
| --- | --- |
| **Inbox** | Captured but not yet classified. Nothing acts on it until it leaves. |
| **Work Queue** | Classified and ready to be worked, by Arcadia or a coding agent. |
| **Requires Review** | Waiting on the operator to act, approve, or decide. A coding agent must not advance it. |
| **Blocked** | Waiting on an outside party or an external state change. |

```sh
pnpm arcadia queue --workspace "$WORKSPACE"
```

An Action's Responsibility answers the same question from the other side —
Autonomous, Codex, Requires Review, Blocked. The two vocabularies share
**Requires Review** and **Blocked** and mean the same thing there. They differ
at the front: a queue distinguishes unclassified (Inbox) from ready (Work
Queue), while Responsibility distinguishes who works a ready item (Autonomous
or Codex).

## Start a software Project from an idea

### Astro Field Notes staging demo

Arcadia has one deliberately narrow idea-to-live golden path. Send this shape
through Ask or Discord:

```text
Create a MartianRover Field Notes blog site
```

Arcadia deterministically classifies it as an Astro Field Notes Project,
creates an **Incubating** Project and one scoped proposal Decision, and sends a
Discord notification whose Project-details link is
`/projects/{project-id}`. The Project page is pre-populated with the template,
`$create-astro-site` generator skill, selected coding agent, validation command,
and Cloudflare Workers staging target.

For the live demo:

1. Create an empty GitHub repository. Do not initialize it with a README.
2. Open the Project link from Discord, enter the GitHub HTTPS or SSH URL, choose
   Codex or Claude Code, and save Project Setup.
3. Read the proposal boundary and approve its Decision on the same page.
4. Keep the Arcadia worker and Discord adapter running. The worker initializes
   the configured local repository, attaches the GitHub URL as `origin`, asks
   the selected agent to use `$create-astro-site`, runs `pnpm run build`, and
   runs `wrangler deploy --env staging`. Wrangler creates or updates the
   separate `{project-name}-staging` Worker with static assets from `dist`.
5. Wait for the Discord Artifact notification titled `Live staging URL:` and
   open the HTTPS `workers.dev` link. The same URL is stored on the Project page.

Approval covers only that repository initialization, dependency/network use by
the selected coding agent, the build, one Cloudflare Workers staging deploy, and
the configured Discord notification. It does **not** authorize Git push, a pull
request, merge, production deployment, custom domain, publication, deletion, or
spending. The GitHub URL is attached as provenance/origin; this golden path does
not push to it. Cloudflare staging uses Workers Static Assets and a named
Wrangler `staging` environment rather than Pages or Git integration. The worker
must already have working Cloudflare Wrangler
authentication, and the selected coding agent must have the
`create-astro-site` skill installed. A missing skill, build failure, missing
Wrangler installation, missing Cloudflare authentication, or absent
staging `workers.dev` URL fails the Run legibly and never records a fake live
link.

Next.js and Node generators are not claimed by this path yet. Add the second
stack when its concrete generator skill, build output, and staging contract are
ready to test end to end.

### Explicit planning-first preparation

Use the explicit preparation path when the input is a new software-Project
idea, not an idea to shelve in Back Burner:

```sh
pnpm arcadia project prepare "Teacher Commons" \
  "A calm web app where teachers exchange classroom resources and keep attribution intact." \
  --path /path/to/teacher-commons
```

Omit `--path` to create the repository directory under the Arcadia workspace's
Projects directory. The command classifies the request as **Project Work → Plan
First → Codex**, preserves the idea verbatim, creates an Active Project and its
first Milestone and planning Action, writes the `PROJECT.md` → active plan →
current Action pointer chain, adopts the repository's agent context, and creates
the immutable read-only planning packet plus one Planning Decision.

It invokes no model and starts no Run. Its final `Trigger:` line is the exact
`arcadia review approve <decision>` command that authorizes one read-only
planning Run for that packet. Approval does not authorize implementation,
merge, deployment, release, credentials, spending, production access,
publishing, deletion, or outbound communication. Accepting the resulting
validated planning Artifact now marks the planning Action done, promotes its
smallest concrete implementation goal into exactly one current managed build
Action, and prepares that Action's immutable build packet. Acceptance starts
no implementation Run. Its receipt prints the exact separate
`arcadia work run ... --allow-codex-build --agent-profile ...` trigger that can
start the build after the operator chooses to do so. Re-acceptance reuses the
same Action and packet, while a changed or malformed planning Artifact fails
closed before either managed pointer moves.

Preparation refuses an already registered Project name or repository and any
repository that already carries a `PROJECT.md` or managed plan. It never
replaces another Project's work pointer.

## Normal daily use

1. Read **Today's Advantage**: one ready Action, its expected Artifact, and why it matters now.
2. Click **Prepare Planning Decision**. This creates the bounded planning packet but does not run Codex.
3. Open **Needs you**, inspect the packet, and choose Approve & Run, Reject, or Defer. Each
   choice previews its consequence before it is confirmed, and a Defer is refused
   until it names the trigger condition that will bring it back. Packet and Run
   handoffs use the same two-step interaction: confirmation states what will and
   will not happen, then leaves a receipt with the durable record or guarded
   command. Confirming a handoff alone records no Decision and starts no Run.
4. Use **Runs** to follow approved work and inspect its Artifacts, Validation, and Log.
5. Return to **Needs you** to accept a successful plan; for an explicitly
   prepared software Project, the page renders the original idea, Milestone,
   proposed Actions, Token Impact and Budget, target repository, and judged
   Artifact revision without requiring raw Markdown. Choose exactly one outcome:
   **Approve plan** marks the planning Action done, promotes one current build
   Action, and prepares—but does not run—its packet; **Defer** requires the named
   condition that revives it; or **Send back** requires refinement feedback,
   preserves the current Artifact, and reopens the planning Action for Codex.

Use the collapsed **Focus** control at the top of **Needs you** to choose a
primary Project, an optional secondary Project, and Projects to park for now.
Each completed change saves automatically in the Arcadia workspace, so the
same ranking follows the operator across browsers and devices. The stored
`config/arcadia.json` `reviewFocus` also keeps the visible set bounded.
Use **Search Decisions** above that control to find a Decision by its governed
number, question text, recommendation, or Project. Search includes focused,
parked, lower-priority, and historical items rather than treating the focus
limit as a search boundary. Document-backed items display their governed
number (for example, **Decision 0038**) on the selected card, compact queue
rows, and excluded rows; database-native Decisions retain their `R…` number.
Historical packets and Runs older than 30 days remain behind the history
control unless they belong to a selected current Action. No Review, packet, or
Run is deleted.

For a clarification that looks stale or disconnected, choose **Reassess**.
Arcadia checks the question against the Project's checked-in active plan before
asking for an answer. If the source plan or question no longer governs current
work, the Decision leaves **Needs you** and remains preserved in history with a
receipt explaining why. If the active plan still declares it, Arcadia reports
**Still declared**—not that the question remains semantically valid—and keeps
the Decision visible. Choose **Flag for agent review** to park that Decision
outside **Needs you** in Agent Queue for a later repository-aware assessment;
flagging starts no coding-agent Run. The same transitions are available as
`arcadia review reassess <id>` and `arcadia review flag-agent <id>`.

Before feeding another coding agent, inspect the portfolio **Agent Queue**. It
keeps every approved, unfinished Action in one explicit order, including work
that is blocked, dependency-waiting, operator-owned, or waiting for its
checked-in Project pointer. The terminal projection reports the queue revision,
whether every Action has a position, and the first pointer-authorized eligible
Action:

```sh
pnpm arcadia advance queue --workspace "$WORKSPACE"
```

An item in the attention lane always names the reason and next repair or
Decision. The queue never grants authority: a ready row still passes through
the existing document, responsibility, approval, repository, and provider
availability gates. An unpositioned Action makes the order invalid and leaves
`Next` empty until its position is explicitly approved.

Preview a move, then apply the exact move against the displayed revision:

```sh
pnpm arcadia advance queue reorder --move arcadia/example-action --top \
  --revision 7 --request-id operator-20260901-1 --workspace "$WORKSPACE"
pnpm arcadia advance queue reorder --move arcadia/example-action --top \
  --revision 7 --request-id operator-20260901-1 --apply --workspace "$WORKSPACE"
```

Use `--before <project/action>` or `--after <project/action>` instead of
`--top`. For a complete drag-and-drop style replacement, use `advance queue
arrange --order <project/action...>` with every active Action exactly once.
Every applied mutation returns a receipt; preview and then apply
`advance queue undo --receipt <receipt-id>` to restore the immediately prior
order. Request ids are idempotent, stale revisions are refused, and undo is
refused after the queue has changed again.

Queue order does not override checked-in dispatch truth. To choose a ready
queued Action that is labelled `waiting_for_pointer`, preview the exact Project
and active Plan patch, then apply its fingerprint:

```sh
pnpm arcadia advance queue make-next --action arcadia/example-action \
  --revision 7 --request-id pointer-20260901-1 --workspace "$WORKSPACE"
pnpm arcadia advance queue make-next --action arcadia/example-action \
  --revision 7 --request-id pointer-20260901-1 \
  --preview <sha256-from-preview> --apply --workspace "$WORKSPACE"
```

Apply is refused when the queue revision, Git worktree, managed documents, or
preview fingerprint changed. Arcadia re-resolves dispatch from the edited
documents before recording the receipt and restores both files on failure.

For software work, use the demo-first handoff contract even while Mission
Control's richer proof surface is still being built:

1. The coding agent supplies a stable runnable demo, or explicitly records why
   the Action has no observable behavior to demonstrate.
2. The operator exercises the candidate first and records product feedback.
3. Before accepting the Action, approving a merge or release, or delivering to
   a client, the operator reads and understands the relevant Log and QA
   evidence. The Log is the audit trail; it is not a substitute for the demo.
4. A candidate does not replace the known-good stakeholder demo until QA and
   release verification have passed.

The Project Detail hero and its state-aware Test/Show action are described
above and live now. A screenshot proof gallery, automatic GitHub/Cloudflare
target discovery, and a release-Decision workflow beyond this configured QA
queue remain specified but unbuilt in `docs/plans/demo-first-delivery.md`; the
demo-first handoff contract above still governs those steps manually until
they exist.

Use the **Ask** box for a new request that is not already an Action in Arcadia.

Deterministic special routes are declared in the operator workspace at
`config/ask-rules.json`. Version 1 rules use one exact, case-insensitive
start-of-message prefix with explicit colon, whitespace, or end boundaries;
they cannot contain regular expressions, code, nested conditions, or hidden
priority. Ask reports the matched rule, route evidence, stripped processing
payload, ordered processors, proposed writes, non-actions, and approval gates
while preserving the submitted message unchanged.

For the first Living Songbook route, point `sourceRef` at the checked-in file
that defines the Project-owned processing contract:

```json
{
  "version": 1,
  "rules": [{
    "id": "songbook",
    "enabled": true,
    "prefix": "songbook",
    "boundaries": ["colon", "whitespace", "end"],
    "destinationProject": "living-songbook",
    "processingProfile": "living-songbook-v1",
    "sourceRef": "docs/ask-processing.md",
    "examples": {
      "matches": ["songbook", "songbook repertoire", "songbook: practice 20"],
      "misses": ["Please update my songbook", "songbooks"]
    }
  }]
}
```

Test a rule through the same matcher and deterministic extractor used by live
Ask. This performs no capture or Project write and supports the standard JSON
envelope:

```sh
pnpm arcadia ask-rule test "songbook: add this source https://example.com/song" --workspace "$WORKSPACE"
pnpm arcadia ask-rule test "songbook plan Living Songbook work" --project arcadia --workspace "$WORKSPACE" --json
```

Routing precedence is explicit `--project`, exact enabled prefix, unambiguous
reply context, extracted Project reference, then the general intent registry.
The receipt retains lower-precedence disagreements as ignored candidates.

### Agent Ask v1

A coding agent can hand Project-management intent back to Arcadia without
authoring managed documents or database rows. The reliable form is strict YAML:

```yaml
agent_ask: v1
request_id: agent-example-001
project: arcadia
intent: action
desired_result: Add deterministic validation for Agent Ask envelopes.
rationale: Agents need a reliable handoff into governed Project work.
acceptance:
  - Invalid authority claims are refused before capture.
  - Exact retries return the original receipt.
dependencies: []
requested_authority: propose
```

Save the envelope to a file and preview it:

```sh
ARCADIA_SURFACE=claude pnpm arcadia agent-ask preview --file /absolute/path/agent-ask.yaml --workspace "$WORKSPACE" --json
```

Preview preserves an immutable capture and proposal receipt but performs zero
Project writes and creates no queue entry. `requested_authority` may be
`propose` or `apply_if_approved`; an agent cannot claim that work is approved,
answer its own Decision, or grant execution authority. Exact request-id replay
returns the first receipt, while changed content under that id is refused.

Plain text is available as a deliberately less precise `auto` fallback and
requires an explicit request id:

```sh
ARCADIA_SURFACE=claude pnpm arcadia agent-ask preview \
  "Make Arcadia explain why one Action is next." \
  --request-id agent-natural-001 --project arcadia --workspace "$WORKSPACE" --json
```

The fallback never invents a Project, intent kind, dependency, date, priority,
or approval.

Settlement accepts strict proposals for an explicit configured Project. For a
new Action, the operator supplies the approved Responsibility and queue
position, previews the exact managed Plan and portfolio-order effect, then
applies only that fingerprint:

```sh
pnpm arcadia agent-ask settle \
  --proposal agent-example-001 --request-id settle-agent-example-001 \
  --disposition accepted --responsibility codex --top --revision 4 \
  --workspace "$WORKSPACE"
pnpm arcadia agent-ask settle \
  --proposal agent-example-001 --request-id settle-agent-example-001 \
  --disposition accepted --responsibility codex --top --revision 4 \
  --preview <sha256-from-preview> --apply --workspace "$WORKSPACE"
```

Apply requires a clean Project worktree, at least one observable acceptance
criterion, valid active-Plan dependencies, a valid existing queue, and the
unchanged preview fingerprint. It writes the canonical Action, synchronizes the
operational projection, assigns one explicit queue position, and persists a
settlement receipt. Use `--disposition rejected` without a Responsibility or
queue placement to preserve the proposal while creating no executable work.

Every applied accepted or rejected settlement creates one durable Discord
outbox item. The configured Arcadia Discord bot posts a brief effect summary,
queue position, and resulting next Action, then records the Discord message id.
Preview, refusal, conflict, and rollback create no ping. Other accepted intents
use the same receipt path and smallest canonical effect:

- `outcome` updates the Project Outcome; `milestone` updates the Project and
  active Plan together.
- `plan` creates a non-active draft Plan, or amends the named Plan Milestone.
- `action` with `target_ref` amends that Action's next step, acceptance, and
  explicit dependencies while preserving Responsibility and queue position.
- `decision` creates one open Decision; `auto` and an untargeted
  `project_update` also create one open Decision instead of guessing structure.
- `artifact` creates a planned Project Artifact reference, `log` appends the
  Project Log, and `proposal` preserves accepted evidence without inventing a
  parallel Project record.
- `project_update` currently accepts explicit `target_ref: outcome` (or `goal`)
  and `target_ref: milestone`; other targets become the focused open Decision
  above.

Rejection is supported for every proposal and never creates executable work.

## Protect active coding work

The Morning Packet puts **Coding work safety** first whenever an active
Project has uncommitted files, local-only commits, a pushed branch without a
pull request, a detached working copy, or invalid repository configuration.
Inspect the complete read-only snapshot with:

```sh
pnpm arcadia work monitor
pnpm arcadia work monitor --json
```

Preservation and delivery are separate. `UNSAVED` and `LOCAL ONLY` mean work
can still be lost; `PUSHED` means it is backed up, with the report separately
stating whether an open PR was found. Use one branch and worktree per coding session, and leave
every session merged or represented by at least a draft PR. The full recovery
procedure is in `docs/working-copy-safety.md`.

Each newly composed Morning Packet also includes a clearly labelled, bounded
local-AI perspective: one headline and one paragraph explaining what the
recorded work means. If the local model is unavailable, the deterministic
packet still composes and delivers. When workspace memory is enabled, the
same packet is projected into `Arcadia/Records/Orientation/` in Obsidian.
Backfill or verify any durable packet explicitly with:

```sh
pnpm arcadia orientation packet export <packet-id> --workspace "$WORKSPACE"
```

When a coding-agent task is complete and the repository already records its
single next Action, use `arcadia go` to reconcile the finished task before
starting another session. Preview first; the second command performs only a
strict fast-forward, then retires only a clean, merged agent worktree and
branch:

```sh
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree --agent codex --apply
# or: --agent claude
```

The command refuses dirty, detached, divergent, non-agent-owned, or
non-dispatchable state. It never commits, force-merges, resets, or pushes. With
`--agent`, it prepares a uniquely named isolated worktree from the updated
local base branch and prints the exact Codex or Claude Code launch command with
`arcadia advance`. The personal `arcadia-go` skill performs the preview/apply
sequence and uses the current agent's native session handoff when available.

To opt into Arcadia launching the next Claude Code process, add `--launch`.
This is the only `go` option that authorizes process creation; preview and the
manual command above remain non-launching:

```sh
pnpm arcadia go \
  --repo /path/to/project \
  --source /path/to/finished-worktree \
  --agent claude \
  --apply \
  --launch \
  --workspace "$WORKSPACE"
```

Launch requires the current governed Action's approved, immutable promoted
build packet; matching provider profile, binding, model, and Git base revision;
a clean agent-owned source and isolated target worktree; available `tmux`; and
no prepared or running Session lease for the same repository. Arcadia creates
the worktree itself and wraps Claude Code in tmux—it does not use Claude Code's
worktree-owning tmux mode. A separately admitted repository may hold its own
Session.

The command prints the Session id and exact reattach command. The same
read-only receipt is available later:

```sh
pnpm arcadia session show --workspace "$WORKSPACE"
pnpm arcadia session show <session-id> --workspace "$WORKSPACE"
tmux attach-session -t <printed-tmux-name>
```

`session show` reports only stored linkage and whether the named tmux process
is alive. It never captures panes, mirrors transcripts, estimates progress, or
injects input. If tmux has exited, use the printed `claude --resume
<provider-session-id>` command from the recorded worktree. A successful process
exit does not complete the Action or approve, merge, deploy, publish, message,
spend, or use credentials; repository reconciliation is a separate governed
transition.

Bare `arcadia advance` and `arcadia advance --session <id>` resolve the same
deterministic Project transition used by `go` and the Agent Queue. Its result
is exactly one of launch, plan, Decision, repair, reconcile, wait, or Milestone
completion, with one concrete next step.

To shelve an idea until a concrete condition is true, use the existing Ask
path with `--back-burner`. For example:

```sh
pnpm arcadia ask "Revisit the compact status view" \
  --back-burner \
  --project proj_example \
  --surface-date 2026-10-01 \
  --source-ref docs/ideas/compact-status.md \
  --tag quick-win experiment
```

See conditions that have fired with
`pnpm arcadia back-burner list --fired yes`. This reports shelf
items only: Arcadia never dispatches or promotes them automatically. Use
`pnpm arcadia back-burner promote <id>` when you explicitly decide an item
should become an Action.

For project-specific, vague, household, date-based, dependency-based, and
predicate-based examples, see the [Back Burner Guide](docs/back-burner-guide.md).

## Narrative digests arrive on their own

The daily Morning Packet leads with a deterministic portfolio stand-up. A
Project appears when it has received a Log in the trailing seven days, has
uncommitted repository work now, or has an unmerged branch with a commit in
that period — regardless of its longer-lived Project status. For each recently
active Project the packet reports **Yesterday** from work landed on its locally
known default branch plus the previous local calendar day's Logs, **Today**
from its latest recorded or open Action, and **Blockers** from current blocked
Actions plus blockers recorded yesterday.

The Discord bot composes and posts narrative digests without being asked. Once
past `ARCADIA_DIGEST_TARGET_TIME` (local, default `07:00`, just after the
Morning Packet), each cadence produces one digest per active Project plus one
collective portfolio roll-up:

| Cadence | Window it narrates |
| --- | --- |
| Daily | Yesterday, local midnight to midnight |
| Weekly | The last completed Monday-to-Monday week |
| Monthly | The last completed calendar month |

Every cadence narrates the period that has **finished**, not the one in
progress — that is the only rule under which each recorded fact lands in
exactly one digest of each cadence. A digest fires at most once per subject
per period, and a bot that was down at the target time composes the same
window on its first tick after restart. One Project's narration failing costs
that Project's digest and nothing else.

Run the same thing by hand at any time:

```sh
pnpm arcadia digest run --workspace <path>
```

It composes and exports everything due that has not been composed yet, and
reports what is awaiting delivery. `ARCADIA_DIGEST_CHECK_INTERVAL_SECONDS`
(default `900`) sets how often the bot checks.

## Compose a Project digest for an explicit window

Use the advanced CLI when you want one narrative digest for boundaries the
cadences do not cover. Supply explicit half-open ISO boundaries:

```sh
pnpm arcadia digest compose \
  --project arcadia \
  --period day \
  --from 2026-07-30T00:00:00.000Z \
  --to 2026-07-31T00:00:00.000Z
```

The command gathers only that Project's Logs, dispatch journal entries, and
Decision activity in `from <= activity < to`, asks the unpaid local-preferred
Intelligence route to narrate those facts, and writes one ready
`narrative_digest` Artifact under the Arcadia workspace. Re-running the same
Project/period/boundary tuple updates the same Artifact. It never writes into
the managed Project repository.

When workspace memory is enabled, project that already-composed Artifact into
Obsidian explicitly:

```sh
pnpm arcadia digest export <digest-id> --workspace <path>
```

The vault Record is clearly labelled AI-narrated, is safe to delete and
recreate, and is not rewritten when the source Artifact has not changed.

## Ingress Artifacts

Open **Ingress** from the menu to view files waiting in the local
`~/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress/iCloudIdeas/In`
folder. Select one or more files, describe the Action you want Arcadia to take, and choose **Describe Action**. Arcadia writes
the description and selected files into the normal ingress queue for processing.
From an iPhone or iPad, the shortest path for a band recording is **Voice
Memos → Share → Save to Files**, then choose
`iCloud Drive/ArcadiaIngress` (or its `iCloudIdeas/In` subfolder). Arcadia
observes both locations and matches any `.m4a` placed there, so the recording
name does not need to contain “Thundertonk” or “practice.” If you prefer a
Share Sheet action for arbitrary files, use **Send
Any Document to Arcadia** and import the signed shortcut from
`scripts/apple/Send Any Document to Arcadia (iPhone-iPad).shortcut`.
On the Mac, import `scripts/apple/Send Any Document to Arcadia (Mac).shortcut`
and enable it as a Finder Quick Action or Share Sheet action; it performs the
same direct copy into `iCloudIdeas/In/`.
If an item is present in iCloud but not local, Ingress labels it accurately and
offers **Download from iCloud** before previewing it.

The **Activity** panel on the Ingress page shows the vital few operator facts:
pending files, files currently being processed, active Workflow Runs, recent
completed or failed sidecars, and the watcher health check. It refreshes every
10 seconds while work is active and every 30 seconds while idle.

Every item is eventually moved out of `In`: active work is claimed in
`Processing`, successful idea captures land in `Done/Ideas`, unmatched files
are preserved in `Done/Unclassified`, and failures land in `Failed`. A Markdown
idea is routed through deterministic Ask/Back Burner handling and, when memory
is enabled, also becomes a managed note under `Arcadia/Ideas/` in Obsidian.
Band-practice `.m4a` files run the configured `/opt/homebrew/bin/rehearsal run
<absolute-recording-path>` Workflow and publish the extracted MP3 Artifacts to
the configured Google Drive Desktop folder. Arcadia asks macOS to launch Google
Drive in the background before starting extraction.
The **Capture** Ask surface accepts text, arbitrary files, or both. Every Send
creates one immutable receipt before routing begins: it names the capture id,
source, time, submitted URLs, and attachment count. File receipts preserve the
original filename, byte size, media type, SHA-256, and outside-repository
storage reference; text extraction and unavailable media processors are shown
as derived results and never replace the original. Retrying the same submitted
request id returns the same receipt, while different content under that id is
refused. File submissions then continue through the identical ingress path.

### Project continuation

Open a Project from **Projects** when you need to work from that repository's
managed documents rather than the portfolio-wide Daily Advantage. The Project
view follows the authoritative `PROJECT.md` → active plan → current Action
pointer; supporting records and dormant/proposed plans cannot redirect it. It
shows the docs-authoritative Milestone, current Action, responsibility,
expected Artifact, source plan, resolved execution profile, and the plan's
T-shirt Token Impact plus its plain-language Token Budget. Deterministic builds,
tests, health checks, Playwright navigation, and screenshot capture consume no
LLM tokens unless a model is asked to interpret their output. **Get to work**
prepares a planning Decision for that exact Action; it never runs code or
deploys. If preparation is refused, the same view names each blocking document
field and its concrete remedy. Open questions and project Decisions can be
answered inline, with the same answer/approval distinction used by Needs you.

The terminal brief resolves the same pointer:

```sh
pnpm arcadia next --project arcadia
```

`next` reaches the repository through the workspace database, so it needs a
workspace on this machine. When you are standing in a project repository — or
in a cloud container, a fresh clone, or CI, where no workspace exists — ask the
repository itself:

```sh
pnpm arcadia docket --repo /path/to/project
```

`docket` reads only that repository's `PROJECT.md` and `docs/plans/`, and
prints the same brief `next` does, including responsibility, clarification, and
acceptance criteria. It takes no `--workspace`, opens no database, and says so
on every run: it reports one repository and never the portfolio. Use `next`
when you want the portfolio's answer, `docket` when you want the project's.

Below the `Authorization:` line, the brief prints **Standing constraints**: the
repository's `CONSTITUTION.md`, verbatim. Nothing parses the Constitution, so
printing it here is what makes a dispatched agent read the rules that bind the
Action rather than merely be pointed at the file. It is deterministic and costs
no LLM tokens.

Edit `CONSTITUTION.md` to change what appears — the brief has no second copy to
keep in step. A repository without a `CONSTITUTION.md` simply omits the section;
its absence never blocks dispatch, because foreign repositories Arcadia manages
are not required to adopt one.

## Working across many projects without losing the thread

Momentum across several projects at once depends on two things nobody usually
gets for free: the command you run has to answer for the project you are
actually standing in, and the debris every session leaves behind — worktrees,
branches, half-finished checkouts — has to stay legible instead of quietly
turning into either lost work or noise you can no longer trust. Both failed
here in practice before they were fixed: a bare `arcadia docket` run inside a
different project silently answered for Arcadia instead, and 15 worktrees and
54 branches accumulated over weeks with nothing ever surfacing that fact. The
three pieces below are the fix, and they run automatically once installed —
there is nothing to remember to do.

### Running `arcadia` from anywhere

`scripts/arcadia`, symlinked onto your `PATH`, lets `arcadia <command>` run
from any directory and mean **the project you are standing in**:

```sh
cd ~/Dev/PrivatePracticeNow/platform
arcadia docket      # Private Practice Now's docket, not Arcadia's
arcadia next        # resolves the Project from where you are standing
```

Arcadia's CLI has to execute inside Arcadia's own checkout, so the launcher
changes directory to get there — and that would normally destroy the one piece
of context these commands need. It records where you actually were in
`ARCADIA_INVOKED_FROM` first, and the CLI resolves repositories and Projects
from that rather than from wherever the runtime happens to be.

Outside any managed project you get a blocker naming the directory it searched,
never a quietly substituted answer. Pass `--repo` or `--project` to override.

A relative `--repo` is read the same way — `arcadia docket --repo .` means the
directory you are standing in, not the checkout the launcher moved to. Commands
echo the resolved absolute path back, so the answer always names the repository
it actually read.

Install or repair the symlink with:

```sh
ln -sf "$(pwd)/scripts/arcadia" ~/.local/bin/arcadia
```

### Cleaning up worktrees and branches

Agent sessions leave worktrees and branches behind. `arcadia tidy` retires the
ones whose work is provably already on the base branch, and reports everything
else without touching it:

```sh
arcadia tidy              # dry run — nothing is changed
arcadia tidy --apply      # retires what the dry run listed
```

The safety rule is one sentence, true by construction: **nothing is removed
unless every commit it carries is already reachable from the base branch, and
its working tree is clean.** A branch whose commits are all ancestors of the
base branch has no commits of its own to lose, so this cannot destroy work —
there is no state in which it does.

It fetches `origin` first by default. Every worktree in a repository shares one
set of refs, so a `main` nobody has pulled in recently makes every worktree's
ancestry check stale at once — a genuinely merged branch reads as unmerged, not
because anything is wrong, but because the local answer is out of date. Pass
`--no-fetch` to compare against the local branch only.

It also checks GitHub for merged pull requests when `gh` is available. A
squash or rebase merge rewrites history, so a branch merged that way never
becomes an ancestor of the base branch — only the commit GitHub actually
produced does. `tidy` verifies that commit's ancestry rather than trusting
GitHub's "merged" label alone, so a squash-merged branch is correctly retired
instead of sitting forever in "unmerged." Pass `--no-github` to skip this.

Merged branches you named yourself are reported but not retired, since
deleting your own ref is your call — pass `--include-own-branches` to include
them. Agent-owned branches (`codex/`, `claude/`, `agent/`, `worktree-`
prefixes) are retired by default.

Anything genuinely unmerged is never touched, and anything with no remote copy
is called out explicitly as the only copy of that work.

### Nothing is ever unrecoverable

`tidy` proves a branch landed three ways before retiring it, and reports which
one applied: plain **ancestry**, **patch equivalence** (`git cherry`, which
sees through cherry-picks, rebases, and amended commits with no network), or a
verified **merged pull request** (checking the commit GitHub actually produced,
not just its "merged" label). A branch is only called unmerged once all three
decline it.

When `git branch -d` refuses — which it does for anything that landed by squash
or rebase, and for a branch whose remote counterpart still exists — `tidy`
writes an `archive/<branch>` tag before forcing, and prints the restore command:

```sh
git branch <branch> archive/<branch>
```

Push those tags (`git push origin --tags`) and the commits are recoverable
forever, from any clone, whatever happens to the local branch.

### Noticing before it piles up

`arcadia go` now ends by stating the repository's state — extra worktrees and
already-merged branches — and points at `tidy` when there is anything to clear.
It is a local count only, with no fetch and no GitHub call, so it costs nothing
at a session boundary. That check exists because the accumulation that prompted
`tidy` sat unnoticed for weeks: nothing ever put the state in front of anyone.
Together with the cwd-aware launcher above, this is what lets you run many
projects at once without either losing track of which one you are talking to
or quietly accumulating a mess you cannot safely see through.

## Answering Decisions

Arcadia separates approval Decisions from clarification Decisions:

- An approval Decision offers **Approve**, **Reject**, and **Defer** because it
  asks whether a proposed action or Run may proceed.
- A clarification Decision shows **Your answer**. Write the answer in your own
  words and choose **Answer & continue**. Arcadia records the information and
  immediately runs clarification again; it either produces the concrete next
  Action or surfaces one focused follow-up question. This does not authorize
  execution. **Get help answering** can generate advice and copy it into the
  answer box as an editable draft.

In Discord, reply directly to a clarification notification with the answer in
your own words. Arcadia confirms the Decision id, records the answer, and
continues clarification. Use `defer` to leave the question open or `reject` to
withdraw it. Approval Decisions still require an explicit `approve`, `reject`,
or `defer`; free-form text never grants execution authority.

Mission Control opens each detail view at its own URL. Use the browser Back button to return through the views you opened, or use the in-page **Back** link to return to Mission Control.

Codex remains the default coding agent. Managed planning and build packets can also use Claude Code through the `claude_planning` and `claude_build` profiles. The Dashboard uses the defaults in `config/coding-agent-profiles.json`; advanced CLI use can select a profile per packet with `arcadia ask --agent-profile <name>` or `arcadia work plan --agent-profile <name>`. A Decision stays bound to the profile named in its exact packet.

Managed plan Actions may also declare a vendor-neutral execution profile. For
those Actions, Arcadia uses the replaceable provider mappings in
`config/provider-adapters.json` to choose the least costly available
configuration that satisfies the required capability, reasoning effort, tools,
context, sandbox, and data locality. An explicit `--agent-profile` narrows the
eligible configurations but cannot weaken the Action requirement. If no
configuration qualifies, Arcadia refuses the Run instead of silently choosing a
weaker model. See `docs/agent-execution-policy.md`.

Execution profiles do not change approval authority. A more capable model still
cannot deploy, publish, merge, delete, spend money, use credentials, access
production data, or send messages without the applicable operator Decision.
Arcadia records observed provider usage and limits but does not yet estimate
Action token consumption or schedule from predictive budgets.

The **Intelligence** screen shows recorded current-day usage, live Codex account limits, and the latest Claude Code context and subscription-limit snapshot. Use **Refresh usage** in the usage section to request current data from all configured coding-agent providers; the section also refreshes automatically when its snapshot is stale. Arcadia reads Codex through its local app-server protocol. Claude Code supplies telemetry through `scripts/claude-code-statusline.sh`, configured as the user's Claude status line. Arcadia retains the most recently reported provider snapshot in `~/.arcadia/telemetry/coding-agent-usage.json`, so a transient provider or UI refresh does not erase it; stale values are labelled as the last reported snapshot. Missing provider fields remain explicitly unknown.

Other CLI commands are advanced or compatibility surfaces, not part of normal daily operation unless a current task says otherwise.

## Durable planning memory

An opted-in workspace can project accepted planning Artifacts into an Obsidian vault. SQLite remains operational truth, workspace files remain execution evidence, and synchronization is one-way from Arcadia to the vault. Arcadia exports only after deterministic planning Validation passes and the final `CodexPlanningArtifactAcceptance` Decision is approved; draft plans, initial Run approvals, failed output, and raw executor evidence are not exported.

Final acceptance writes the managed vault Record before marking the Artifact ready, the original Action done, and the Decision approved. If the vault write fails, those SQLite transitions do not occur; fix the reported vault problem and retry acceptance. Historical or changed Records can be inspected and repaired with:

```sh
arcadia memory sync --workspace <path> --dry-run
arcadia memory sync --workspace <path>
```

The command never reads operational state from Obsidian and never deletes vault content. Files under the vault's `Arcadia/Records/` subtree are Arcadia-managed projections, not editable inputs.

## Living-system navigator

A Project that owns a validated `docs/living-system.yaml` can project its
capability map and Action timeline into `Projects/<project-slug>/` in the same
vault. Repository files own durable meaning; managed documents, explicit
`Action: plan-slug#action-id` Mission Log links, and operational receipts own
status and history. Preview is the default:

```sh
arcadia memory system sync --project <project> --workspace <path>
arcadia memory system sync --project <project> --workspace <path> --apply
arcadia memory system sync --all --workspace <path> --json
```

Home, Topic, and episode pages work as plain Markdown. Obsidian adds WikiLinks,
transclusions, optional Markmap panes, and a Canvas split view. Claims show
provenance and freshness; gaps remain visible. Sync never installs plugins or
calls a model. Generated pages are replaceable: preserve or remove only that
Project's generated subtree, then re-run `--apply` to roll back or rebuild it.
Accepted Action transitions attempt a refresh only when vault memory is enabled;
a refresh warning never reverses the accepted transition.

## Automatic local services

After you sign in following a laptop restart, Arcadia's managed launch agents start and keep these services running:

- **Dashboard (core)** — Mission Control, Needs you, Runs, and System Status at port 3020.
- **Managed Run worker (core)** — executes only queued, authorized Runs with the coding agent bound to each packet.
- **Intelligence API and worker (feature-specific)** — structured generation at port 4710. Its durable SQLite queue dispatches cloud, local LiteLLM, Codex CLI, and Claude Code CLI generation through separate bounded pools, so a long image job no longer blocks unrelated requests. The health and admin-capability views advertise a LiteLLM offering only while its model group appears in the proxy's authenticated model inventory; a configured deployment that LiteLLM rejected is therefore unavailable before submission rather than failing as a test job. Local structured-text callers can select Claude Code with `executionTarget: "claude-code"`; the default route uses the installed `claude` CLI and does not authorize paid cloud usage.
- **ComfyUI image backend (feature-specific)** — local FLUX.2 Klein generation/editing at port 8188 when configured.
- **Discord adapter (feature-specific)** — capture, status, notifications, and
  the morning Orientation Packet. That packet opens with a factual narrative
  of recent Project changes, seven-day velocity versus the prior week,
  accumulated blockers/Decisions, and the strongest coding-agent handoff
  opportunity before presenting today's normal orientation slate.

The Dashboard binds to local interfaces for this operator-only workflow, so a
phone can reach it over the LAN or Tailscale. If the Projects card and the
repository's docket ever disagree, refresh the page: the card selects the
most recently updated open Action, while the repository remains authoritative
for the full control record.

The optional iCloud file-ingress job also starts automatically and checks its drop folder once a minute. It is not required for the Today page.

Do not start separate legacy processes manually. Anything outside this list is not part of the normal local service set.

Intelligence defaults to independent cloud, Codex CLI, Claude Code CLI, and local
capacity. Tune the pool limits only when provider quotas or local hardware
require it; the available `ARCADIA_INTELLIGENCE_*_CONCURRENCY` settings are
listed in `docs/intelligence/ROUTING.md`. `GET
/api/intelligence/health` reports each pool's configured concurrency and live
active/waiting counts.

For local image generation, start ComfyUI with `scripts/comfyui/start.sh` before
using Arcadia Intelligence. It is loopback-only; Arcadia stores generated
images as normal Artifacts. See `docs/intelligence/COMFYUI_IMAGE_EXECUTOR.md`.

If Arcadia is unavailable, ask Codex to **check or restart all Arcadia services**. The direct fallback is:

```sh
scripts/services.sh restart
```

Arcadia pins Node in `mise.toml`, and Corepack activates the pnpm version in
`package.json`. The restart script installs and validates that toolchain, then
writes every managed LaunchAgent to start through `mise exec`; login-shell PATH
state cannot select a different Node ABI.

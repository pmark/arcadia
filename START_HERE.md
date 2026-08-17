# Arcadia: Start Here

This is the canonical brief operator guide. On this Mac, open **Mission Control** at <http://127.0.0.1:3020/>. From an iPhone or iPad, `127.0.0.1` means the phone itself; use the Mac's LAN address (for example `http://192.168.86.38:3020/`) on the same Wi-Fi, or the Mac's Tailscale address (for example `http://100.66.244.44:3020/`) when both devices are on Tailscale.

Open **System Status** at <http://127.0.0.1:3020/admin/status> when you need a quick readiness check. It shows whether Arcadia is ready for normal operation, image generation, and background processing, with live dependency reachability, worker heartbeats, and Intelligence job counts.

Open **Dispatch Journal** at <http://127.0.0.1:3020/admin/dispatch-journal> to see how often Arcadia refused to dispatch work, and which field in the managed documents blocked it. A field that blocks a large share of resolutions is either a rule worth relaxing or a habit worth fixing. It is read-only, like every other admin surface.

Open **Outstanding PRs** at <http://127.0.0.1:3020/admin/pull-requests> to see every open pull request across configured Project repositories, grouped with its Project, branch, review/check state, and plain-English readiness rating. This view is read-only.

Open the **QA queue** at <http://127.0.0.1:3020/qa> to test each configured Candidate from one exact procedure. The queue shows the configured revision, target state, validation and evidence freshness; **Test Candidate** opens only that configured target. Record Pass, Fail, or Needs follow-up with an optional note to create a revision-bound Decision. This records QA evidence only—it never merges, deploys, or releases work. Candidate configuration is checked in at `config/qa-candidates.json`.

Every Project Detail page at <http://127.0.0.1:3020/projects/{id}> now opens with a **demo hero**: one state — proof unavailable, Candidate failure, ready for your demo, QA failed, release Decision needed, or Stable-only — with exactly one primary next action, resolved from real checks rather than claimed. Below it, each configured Stable and Candidate target gets its own card with URL, environment kind, access state, source revision, health, and last verified time, plus its own **Show Stable** / **Test Candidate** link (works from a phone-reachable Mission Control whenever the target itself is not local-only) and a **Check now** button that runs a live reachability probe and persists the result. Stable/Candidate target configuration is checked in at `config/proof-targets.json`; a Candidate target reuses its QA queue id so a recorded QA Decision (`arcadia qa record`) is reflected in the hero automatically. Run a check from the command line with:

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

## Normal daily use

1. Read **Today's Advantage**: one ready Action, its expected Artifact, and why it matters now.
2. Click **Prepare Planning Decision**. This creates the bounded planning packet but does not run Codex.
3. Open **Review**, inspect the packet, and choose Approve & Run, Reject, or Defer.
4. Use **Runs** to follow approved work and inspect its Artifacts, Validation, and Log.
5. Return to **Review** to accept a successful plan; acceptance marks the original Action done.

Before feeding another coding agent, open the **Agent Queue** section in
Mission Control. It keeps three explicit lanes in view: **Ready to feed**,
**Running or queued**, and **Needs attention before dispatch**. The same
read-only projection is available in the terminal:

```sh
pnpm arcadia advance queue --workspace "$WORKSPACE"
```

An item in the attention lane always names the reason and next repair or
Decision. The queue never grants authority: a ready row still passes through
the existing document, responsibility, approval, repository, and provider
availability gates.

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
The **Capture** Ask surface accepts the same arbitrary files with an optional
instruction and queues them through this identical ingress path.

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
answered inline, with the same answer/approval distinction used by Review.

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

## Automatic local services

After you sign in following a laptop restart, Arcadia's managed launch agents start and keep these services running:

- **Dashboard (core)** — Mission Control, Review, Runs, and System Status at port 3020.
- **Managed Run worker (core)** — executes only queued, authorized Runs with the coding agent bound to each packet.
- **Intelligence API and worker (feature-specific)** — structured generation at port 4710. Its durable SQLite queue dispatches cloud, local LiteLLM, Codex CLI, and Claude Code CLI generation through separate bounded pools, so a long image job no longer blocks unrelated requests. Local structured-text callers can select Claude Code with `executionTarget: "claude-code"`; the default route uses the installed `claude` CLI and does not authorize paid cloud usage.
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
/Users/pmark/.codex/skills/restart-arcadia-services/scripts/restart-services.sh restart /Users/pmark/Dev/MR/Arcadia/arcadia
```

Arcadia pins Node in `mise.toml`, and Corepack activates the pnpm version in
`package.json`. The restart script installs and validates that toolchain, then
writes every managed LaunchAgent to start through `mise exec`; login-shell PATH
state cannot select a different Node ABI.

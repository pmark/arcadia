# Arcadia: Start Here

This is the canonical brief operator guide. On this Mac, open **Mission Control** at <http://127.0.0.1:3020/>.

Open **System Status** at <http://127.0.0.1:3020/admin/status> when you need a quick readiness check. It shows whether Arcadia is ready for normal operation, image generation, and background processing, with live dependency reachability, worker heartbeats, and Intelligence job counts.

## Normal daily use

1. Read **Today's Advantage**: one ready Action, its expected Artifact, and why it matters now.
2. Click **Prepare Planning Decision**. This creates the bounded planning packet but does not run Codex.
3. Open **Review**, inspect the packet, and choose Approve & Run, Reject, or Defer.
4. Use **Runs** to follow approved work and inspect its Artifacts, Validation, and Log.
5. Return to **Review** to accept a successful plan; acceptance marks the original Action done.

Use the **Ask** box for a new request that is not already an Action in Arcadia.

## Ingress Artifacts

Open **Ingress** from the menu to view files waiting in the local
`~/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress/iCloudIdeas/In`
folder. Select one or more files, describe the Action you want Arcadia to take, and choose **Describe Action**. Arcadia writes
the description and selected files into the normal ingress queue for processing.
From an iPhone or iPad Share Sheet, use **Send Any Document to Arcadia** to copy
an image or other document directly into the same folder; import the signed
shortcut from `scripts/apple/Send Any Document to Arcadia (iPhone-iPad).shortcut`.
On the Mac, import `scripts/apple/Send Any Document to Arcadia (Mac).shortcut`
and enable it as a Finder Quick Action or Share Sheet action; it performs the
same direct copy into `iCloudIdeas/In/`.
If an item is present in iCloud but not local, Ingress labels it accurately and
offers **Download from iCloud** before previewing it.

Every item is eventually moved out of `In`: active work is claimed in
`Processing`, successful idea captures land in `Done/Ideas`, unmatched files
are preserved in `Done/Unclassified`, and failures land in `Failed`. A Markdown
idea is routed through deterministic Ask/Back Burner handling and, when memory
is enabled, also becomes a managed note under `Arcadia/Ideas/` in Obsidian.
The **Capture** Ask surface accepts the same arbitrary files with an optional
instruction and queues them through this identical ingress path.

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
- **Intelligence API and worker (feature-specific)** — structured generation at port 4710. Its durable SQLite queue dispatches cloud, Codex, and local generation through separate bounded pools, so a long image job no longer blocks unrelated requests.
- **ComfyUI image backend (feature-specific)** — local FLUX.2 Klein generation/editing at port 8188 when configured.
- **Discord adapter (feature-specific)** — capture, status, and notifications.

The optional iCloud file-ingress job also starts automatically and checks its drop folder once a minute. It is not required for the Today page.

Do not start separate legacy processes manually. Anything outside this list is not part of the normal local service set.

Intelligence defaults to parallel cloud/Codex work and conservative local
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
PATH=/opt/homebrew/Cellar/node/25.6.1/bin:$PATH /Users/pmark/.codex/skills/restart-arcadia-services/scripts/restart-services.sh restart /Users/pmark/Dev/MR/Arcadia/arcadia
```

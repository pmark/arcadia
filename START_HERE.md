# Arcadia: Start Here

This is the canonical brief operator guide. On this Mac, open **Today** at <http://127.0.0.1:3020/>.

Open **System Status** at <http://127.0.0.1:3020/admin/status> when you need a quick readiness check. It shows whether Arcadia is ready for normal operation, image generation, and background processing, with live dependency reachability, worker heartbeats, and Intelligence job counts.

## Normal daily use

1. Read **Today's Advantage**: one ready Action, its expected Artifact, and why it matters now.
2. Click **Prepare Planning Decision**. This creates the bounded planning packet but does not run Codex.
3. Open **Review**, inspect the packet, and choose Approve & Run, Reject, or Defer.
4. Use **Runs** to follow approved work and inspect its Artifacts, Validation, and Log.
5. Return to **Review** to accept a successful plan; acceptance marks the original Action done.

Use the **Ask** box for a new request that is not already an Action in Arcadia.

Codex remains the default coding agent. Managed planning and build packets can also use Claude Code through the `claude_planning` and `claude_build` profiles. The Dashboard uses the defaults in `config/coding-agent-profiles.json`; advanced CLI use can select a profile per packet with `arcadia ask --agent-profile <name>` or `arcadia work plan --agent-profile <name>`. A Decision stays bound to the profile named in its exact packet.

The **Intelligence** screen shows recorded current-day usage, live Codex account limits, and the latest Claude Code context and subscription-limit snapshot. Arcadia reads Codex through its local app-server protocol. Claude Code supplies telemetry through `scripts/claude-code-statusline.sh`, configured as the user's Claude status line. Arcadia retains the most recently reported provider snapshot in `~/.arcadia/telemetry/coding-agent-usage.json`, so a transient provider or UI refresh does not erase it; stale values are labelled as the last reported snapshot. Missing provider fields remain explicitly unknown.

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

- **Dashboard (core)** — Today, Review, Runs, and System Status at port 3020.
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

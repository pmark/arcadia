# Arcadia: Start Here

This is the canonical brief operator guide. On this Mac, open the **Today page** (currently labeled **Mission Control**) at <http://127.0.0.1:3020/>.

## Normal daily use

1. Put a new request in the **Ask** box.
2. Use **Review** for Decisions that need approval, rejection, or deferral.
3. Use **Runs** to follow approved work and inspect its Artifacts, Validation, and Log.
4. When an existing stored Action specifically needs a bounded planning packet, run `pnpm arcadia work plan <ACTION_ID>`. This prepares one Decision; it does not run Codex.

Other CLI commands are advanced or compatibility surfaces, not part of normal daily operation unless a current task says otherwise.

## Automatic local services

After you sign in following a laptop restart, Arcadia's managed launch agents start and keep these services running:

- **Dashboard (core)** — Today, Review, and Runs at port 3020.
- **Managed Run worker (core)** — executes only queued, authorized Runs.
- **Intelligence API and worker (feature-specific)** — structured generation at port 4710.
- **Discord adapter (feature-specific)** — capture, status, and notifications.

The optional iCloud file-ingress job also starts automatically and checks its drop folder once a minute. It is not required for the Today page.

Do not start separate legacy processes manually. Anything outside this list is not part of the normal local service set.

If Arcadia is unavailable, ask Codex to **check or restart all Arcadia services**. The direct fallback is:

```sh
PATH=/opt/homebrew/Cellar/node/25.6.1/bin:$PATH /Users/pmark/.codex/skills/restart-arcadia-services/scripts/restart-services.sh restart /Users/pmark/Dev/MR/Arcadia/arcadia
```

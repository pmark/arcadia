# Arcadia: Start Here

This is the canonical brief operator guide. On this Mac, open **Today** at <http://127.0.0.1:3020/>.

## Normal daily use

1. Read **Today's Advantage**: one ready Action, its expected Artifact, and why it matters now.
2. Click **Prepare Planning Decision**. This creates the bounded planning packet but does not run Codex.
3. Open **Review**, inspect the packet, and choose Approve & Run, Reject, or Defer.
4. Use **Runs** to follow approved work and inspect its Artifacts, Validation, and Log.
5. Return to **Review** to accept a successful plan; acceptance marks the original Action done.

Use the **Ask** box for a new request that is not already an Action in Arcadia.

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

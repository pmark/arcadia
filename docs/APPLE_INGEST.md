# Apple Platform Ingest

## Milestone

Send text, clipboard contents, links, photos, and files from macOS, iPhone, and iPad into Arcadia with the system Share Sheet.

## Recommended Architecture

Use an Apple Shortcut as the Share Sheet surface and iCloud Drive as the transport. On the Mac, `scripts/apple/arcadia-ingest` packages the input. Arcadia's existing deterministic `ingress process` command consumes the request.

```text
Share Sheet or Finder Quick Action
  -> iCloud Drive/ArcadiaIngress/iCloudIdeas/In
  -> arcadia ingress process
  -> text request: Action, Decision, Artifact, and Log flow
  -> matching media file: configured deterministic Workflow and Run
```

This is the best first implementation because it works across all three Apple platforms, works while the Mac is offline, introduces no public server or authentication surface, and keeps every request inspectable. A native app can later replace the Shortcut without changing the folder contract.

An iOS or iPadOS wrapper cannot execute arbitrary shell commands. Apple sandboxes apps and Share Extensions. A future native Arcadia Ingest app should therefore remain a small Share Extension that writes the same request and attachments to an iCloud container, or submits them to an authenticated Arcadia HTTP endpoint if remote processing becomes a requirement.

## macOS Command

Make the helper executable once:

```sh
chmod +x scripts/apple/arcadia-ingest
```

Capture clipboard text:

```sh
scripts/apple/arcadia-ingest --clipboard
```

Capture context and files:

```sh
scripts/apple/arcadia-ingest \
  --text "Review these files and identify the next Action." \
  ~/Desktop/example.pdf ~/Desktop/screenshot.png
```

The helper copies shared files into `ArcadiaIngress/<source>/Attachments/<capture-id>/` and atomically publishes a `.txt` request into `In/`. By default it uses the iCloud Drive folder when iCloud Drive exists, and otherwise uses `~/ArcadiaIngress`. Set `ARCADIA_INGRESS_ROOT` or pass `--ingress-root` to override that choice.

For a file that should be matched and executed by a configured Workflow, place the file itself atomically in `In/`:

```sh
scripts/apple/arcadia-ingest --direct-files \
  "$HOME/Music/Recordings/Thundertonk practice 2026 July 16.m4a"
```

`--direct-files` does not create a text request or copy the recording into `Attachments/`. Arcadia retains the recording by moving it to `Done/` after a successful Run or `Failed/` with an error sidecar after a failed Run.

## Finder Quick Action

The most common no-code macOS integration is a Finder Quick Action:

1. Open Automator and create a **Quick Action**.
2. Set “Workflow receives current” to **files or folders** in **Finder**.
3. Add **Run Shell Script**.
4. Set “Pass input” to **as arguments**.
5. Use this script, replacing the repository path if necessary:

```sh
exec /Users/pmark/Dev/MR/Arcadia/arcadia/scripts/apple/arcadia-ingest \
  --text "Capture these shared files in Arcadia." -- "$@"
```

6. Save it as **Send to Arcadia**.

It will appear in Finder's Quick Actions and Share menus. The helper is also suitable for a macOS Shortcut using the **Run Shell Script** action.

For a clipboard-only macOS Shortcut, add **Run Shell Script** with:

```sh
exec /Users/pmark/Dev/MR/Arcadia/arcadia/scripts/apple/arcadia-ingest --clipboard
```

Pin that Shortcut to the menu bar or assign a keyboard shortcut.

## iPhone and iPad Shortcut

Create a Shortcut named **Send to Arcadia** and enable **Show in Share Sheet**. Allow Files, Images, Media, URLs, and Text as accepted types.

Use these actions:

1. **If** `Shortcut Input` has no value, use **Get Clipboard** and set `Shortcut Input` to the result.
2. **Get Type** of `Shortcut Input`.
3. For Text or URL input, create a text file named with the current date in `ArcadiaIngress/iCloudIdeas/In/` whose contents are the input.
4. For files, save the input into a new dated folder below `ArcadiaIngress/iCloudIdeas/Attachments/`.
5. Create a same-dated `.txt` file in `ArcadiaIngress/iCloudIdeas/In/` containing:

```text
Capture these shared files in Arcadia and identify the next Action.

Shared Artifacts:
- <saved iCloud Drive path or file name>
```

6. Finish with **Show Notification**: “Sent to Arcadia.”

Turn off “Ask Where to Save” on every **Save File** action. Use a timestamp including seconds in both the attachment folder and request filename to avoid collisions.

The Shortcut is the correct initial iOS UI. A native app becomes worthwhile when Arcadia needs a richer capture form, project and Milestone pickers, upload progress, background retry status, or a response inbox.

## Process iCloud Requests

On the Mac, point Arcadia at the same iCloud Drive folder:

```sh
pnpm arcadia ingress process \
  --workspace "$ARCADIA_WORKSPACE" \
  --source iCloudIdeas \
  --ingress-root "$HOME/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress" \
  --json
```

Add `--run-safe` only when deterministic safe Actions should run immediately. Without it, Arcadia plans work and preserves Decisions for human judgment.

For automation, run that command periodically with `launchd`. Periodic processing is intentionally separate from capture: the Share Sheet stays fast and reliable even when Arcadia or the Mac is unavailable.

## Thundertonk Practice Workflow

Arcadia ships an enabled `thundertonk-practice` Workflow definition at `config/defaults/workflows/thundertonk-practice.json`. It matches `.m4a` files whose names contain both `Thundertonk` and `practice`, runs the executable directly as this argv sequence (without shell interpolation), and allows up to four hours:

```text
/opt/homebrew/bin/rehearsal
argv[1] = run
argv[2] = <absolute recording path>
```

The Workflow reads `rehearsal`'s final `collected:` output line and publishes every MP3 in that directory. For the recording `Thundertonk practice 2026 July 16.m4a`, publication resolves to:

```text
~/Library/CloudStorage/GoogleDrive-wayoutwest@gmail.com/My Drive/
  Thundertonk PMA/Practices/2026/0716/
```

Published names are the exact existing basenames produced by `rehearsal collect`, for example `01 - 3m50s.mp3`. Arcadia SHA-256 verifies each copy. A repeated input hash reuses the completed Run, an identical destination file is skipped, and a same-name file with different content fails rather than being overwritten.

Inspect and validate the Workflow before running it:

```sh
pnpm arcadia workflow list --json
pnpm arcadia workflow show thundertonk-practice --json
pnpm arcadia workflow match \
  "$HOME/Music/Recordings/Thundertonk practice 2026 July 16.m4a" \
  --source iCloudIdeas --json
pnpm arcadia workflow validate thundertonk-practice --json
pnpm arcadia workflow run thundertonk-practice \
  "$HOME/Music/Recordings/Thundertonk practice 2026 July 16.m4a" \
  --dry-run --json
```

To process a recording placed in ingress, invoke the command periodically. Arcadia first records its size and modification time, then waits for both values to remain unchanged for at least 30 seconds before claiming it:

```sh
pnpm arcadia ingress process \
  --workspace "$ARCADIA_WORKSPACE" \
  --source iCloudIdeas \
  --ingress-root "$HOME/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress" \
  --run-safe --stable-seconds 30 --json
```

The Run manifest and raw stdout/stderr Logs are written below `artifacts/workflow-runs/<run-id>/`. The source recording, every published MP3, the Logs, and the Run manifest are recorded as Arcadia Artifacts. Inspect recent evidence with `arcadia workflow runs` and `arcadia workflow run-info show <run-id>`.

Google Drive Desktop must be running and the configured root must exist. macOS may require Full Disk Access for the Terminal or launch agent that runs Arcadia; Arcadia deliberately refuses to create a missing sync root because that could publish into an unsynchronized local lookalike folder.

### launchd

Use a periodic user agent rather than a separate daemon. Its `ProgramArguments` should call the repository's package manager without a shell, for example:

```xml
<key>StartInterval</key>
<integer>60</integer>
<key>ProgramArguments</key>
<array>
  <string>/opt/homebrew/bin/pnpm</string>
  <string>--dir</string>
  <string>/Users/pmark/Dev/MR/Arcadia/arcadia</string>
  <string>arcadia</string>
  <string>ingress</string>
  <string>process</string>
  <string>--workspace</string>
  <string>/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover</string>
  <string>--source</string>
  <string>iCloudIdeas</string>
  <string>--ingress-root</string>
  <string>/Users/pmark/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress</string>
  <string>--run-safe</string>
  <string>--json</string>
</array>
```

## Native App Follow-up

If Shortcut usage proves the flow, build one universal SwiftUI app with:

- an iOS/iPadOS Share Extension;
- a macOS Share Extension and Finder Sync/Quick Action only if the standard Share Extension is insufficient;
- an App Group for extension-to-app handoff;
- an iCloud container implementing the folder contract above;
- optional project, Milestone, note, and “run safe Actions” fields;
- a local outbox with retry state before iCloud publication.

Keep command execution on macOS inside Arcadia. Do not make the iOS app a general-purpose script executor.

## Next Action

Create and dogfood the **Send to Arcadia** Shortcut on one Mac and one iPhone. After several days of real captures, use the observed input types and failure cases to decide whether a signed native Share Extension is justified.

## Required Artifacts

- The request `.txt` file in `In/`.
- Any copied shared files in `Attachments/<capture-id>/`.
- Arcadia's response or error sidecar in `Done/` or `Failed/`.
- The resulting Arcadia Log and any Action, Decision, or Artifact records.

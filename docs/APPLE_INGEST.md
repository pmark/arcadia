# Apple Platform Ingest

## Milestone

Send text, clipboard contents, links, photos, and files from macOS, iPhone, and iPad into Arcadia with the system Share Sheet.

## Recommended Architecture

Use an Apple Shortcut as the Share Sheet surface and iCloud Drive as the transport. On the Mac, `scripts/apple/arcadia-ingest` packages the input. Arcadia's existing deterministic `ingress process` command consumes the request.

```text
Share Sheet or Finder Quick Action
  -> iCloud Drive/ArcadiaIngress/iCloudIdeas/In
  -> arcadia ingress process
  -> Action, Decision, Artifact, and Log flow
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

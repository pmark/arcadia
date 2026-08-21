# Demo materials

The operator drives these live. Two shapes of the same rehearsed material:

- **[`2026-08-21-demo-deck.html`](2026-08-21-demo-deck.html)** — eleven independent
  modules, each naming the problem it answers, the command, what appears, and why it
  lands. Pick as the conversation goes. This is the one to use.
- **[`2026-08-21-run-sheet.md`](2026-08-21-run-sheet.md)** — the earlier fixed
  three-beat, ten-minute script. Superseded by the deck, kept because the deck's
  "ten-minute version" path is exactly this sequence.

## The modules

Every timing is measured wall time against a byte copy of the live workspace on
2026-08-20, run back to back. No module makes a model call. Only `I` touches the
network.

| Card | Command | Time | Effect |
| --- | --- | --- | --- |
| A | `arcadia mission-control overview` | 2.61s | read-only |
| B | `arcadia portfolio` | 2.22s | read-only |
| C | `arcadia docket` | 3.19s | read-only |
| D | `arcadia docket --repo <ppn>` | 3.39s | read-only |
| E | `arcadia ingress process --source DemoNotes` | 1.32s | writes |
| F | `arcadia ask … --back-burner --surface-date` | 2.66s | writes |
| G | `arcadia back-burner list --fired yes` | 2.61s | read-only |
| H | `arcadia work done` then G | 4.15s | writes |
| I | `arcadia tidy` (offline: `--no-fetch --no-github`, 1.34s) | 4.49s | read-only |
| J | `arcadia go` | 1.10s | read-only |
| K | `arcadia back-burner promote` | 1.25s | writes |

## Setup and teardown

```sh
scripts/demo/seed-2026-08-21.sh          # Actions and Back Burner items
scripts/demo/seed-ingress-2026-08-21.sh  # stages the three notes for card E
scripts/demo/unseed-2026-08-21.sh --apply  # removes everything both created
```

The unseed previews without `--apply`.

## Why card E reads a local folder

The real ingress source is an iCloud Drive folder. A note that has not finished
downloading is a `.name.txt.icloud` dotfile placeholder, and the ingress scanner
filters every dotfile, so an undownloaded note is invisible while the service still
reports healthy with `Pending: 0`. `--ingress-root` points the same watcher at a local
folder that is always there. See `docs/demo/ingress-findings.md`.

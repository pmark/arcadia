# Scripts
Automation entry points.

- `smoke.ts` runs the non-interactive Phase 0 smoke path against `tmp/demo-workspace`.
- `example-daily-workflow.sh` is a commented shell script showing how to initialize a private workspace, create a project, capture classified work, update queues, track artifacts, write a mission log, and generate reports.
- `apple/arcadia-ingest` packages macOS clipboard text and shared files for Arcadia's iCloud-compatible local ingress flow. Use `--direct-files` for media that should match a configured deterministic Workflow. See `docs/APPLE_INGEST.md`.

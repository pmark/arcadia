# Rebuster To Arcadia Contract

Arcadia accommodates Rebuster Studio as a bridge. Rebuster owns durable creative and production state. Arcadia owns Project visibility, Actions, Decisions, activity visibility, and routing.

## Ownership Boundary

- Rebuster owns Rebus records, overlap analysis, specs, generated artifacts, creative status, and production workflow transitions.
- Arcadia stores only bridge configuration, external event snapshots, and Decisions that route Mark back to Rebuster.
- Arcadia must not create `Rebus`, `RebusArtifact`, `RebusRelationship`, or `RebusReview` tables.

## Bridge Configuration

Configure the bridge with:

```sh
arcadia rebuster configure --project <id> [--repo-path <path>] [--base-url <url>] [--dashboard-url <url>]
```

The bridge records the Arcadia Project, optional Rebuster repository path, optional base URL, optional dashboard URL, last health check, and last sync timestamp.

## Rebus Creation Trigger

Arcadia can trigger creation of a new Rebuster record from a strict structured spec:

```sh
arcadia rebuster create-rebus --spec <path>
arcadia rebuster create-rebus --spec-text "<strict spec text>"
```

The command validates the strict spec section order before calling Rebuster. Arcadia sends the spec to the configured Control Panel API when `base_url` is present:

```text
POST /api/rebuses/add
{ "text": "<strict spec text>", "force": false }
```

If no `base_url` is configured, Arcadia falls back to the local Rebuster CLI through the configured `repo_path`:

```sh
pnpm --dir <repo_path> exec tsx src/cli.ts add --spec <temp-spec-file>
```

Creation emits `rebuster.candidate_captured` in Arcadia and writes an external event snapshot. Rebuster remains the source of truth for the created `record.json` and all later workflow transitions.

## Event Payload

Rebuster can hand Arcadia a local JSON event with:

```json
{
  "eventType": "decision_required",
  "externalId": "rebuster-event-001",
  "rebusId": "rebus_001",
  "answer": "Toe Truck",
  "status": "spec_ready",
  "summary": "Strict spec is ready for creator approval.",
  "decisionRequired": true,
  "recommendation": "Open Rebuster Studio and approve or revise the spec.",
  "rebusterUrl": "http://localhost:3000/rebuses/rebus_001",
  "artifactRefs": [
    {
      "type": "spec",
      "title": "Strict Rebuster spec v1",
      "url": "http://localhost:3000/rebuses/rebus_001/specs/1"
    }
  ],
  "occurredAt": "2026-06-26T12:00:00.000Z"
}
```

Supported `eventType` values are:

- `candidate_captured`
- `overlap_ready`
- `decision_required`
- `spec_ready`
- `review_queued`
- `rejected`
- `archived`
- `published`

Ingest with:

```sh
arcadia rebuster ingest-event <json-file>
```

## Decision Routing

When `decisionRequired` is true, Arcadia creates a Decision that links back to `rebusterUrl`. Rebuster remains responsible for the actual creative workflow transition and audit trail.

Arcadia emits activity events as `rebuster.<eventType>` and exposes bridge state at:

- `snapshot.rebuster.connection`
- `snapshot.rebuster.status`
- `snapshot.rebuster.decisions`
- `snapshot.rebuster.recentEvents`

# Arcadia Adapter Contract

This contract defines the stable CLI ingress surface for daily Arcadia operation and thin adapters such as local scripts, Discord commands, shortcuts, and file ingress.

## Supported Ingress Commands

Daily workspace commands default to the current directory as the workspace. `--workspace <path>` remains supported for compatibility.

```text
arcadia ask "<intent>" [--workspace <path>] [--run-safe] [--json]
arcadia status [--workspace <path>] [--json]
arcadia review [--workspace <path>] [--json]
arcadia review show <id> [--workspace <path>] [--json]
arcadia review approve <id> [--workspace <path>] [--json]
arcadia review reject <id> [--workspace <path>] [--json]
arcadia review defer <id> [--workspace <path>] [--json]
```

Dogfood commands always use `.arcadia-workspace/` from the Arcadia repository.

```text
arcadia dogfood init [--json]
arcadia dogfood ask "<intent>" [--run-safe] [--json]
arcadia dogfood status [--json]
arcadia dogfood review [--json]
arcadia dogfood review show <id> [--json]
arcadia dogfood review approve <id> [--json]
arcadia dogfood review reject <id> [--json]
arcadia dogfood review defer <id> [--json]
```

## JSON Envelope

Successful commands return:

```json
{
  "ok": true,
  "command": "ask",
  "workspace": "/absolute/workspace/path",
  "data": {},
  "artifacts": [],
  "warnings": []
}
```

Failed commands return:

```json
{
  "ok": false,
  "command": "review.approve",
  "workspace": "/absolute/workspace/path",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Requires Review item was not found.",
    "details": {
      "id": "review_missing"
    }
  }
}
```

## Stable Data Shapes

`ask` data includes:

```json
{
  "ask": { "id": "ask_...", "status": "planned" },
  "result": { "status": "acted|queued|requires_review", "summary": "..." },
  "workItem": null,
  "plan": null,
  "run": null,
  "status": null,
  "review": null,
  "reviewItemId": "review_..."
}
```

`status` data includes:

```json
{
  "projectCount": 1,
  "activeProjectCount": 1,
  "queuedWorkCount": 0,
  "requiresReviewCount": 1,
  "autonomousCount": 0,
  "codexCount": 1,
  "blockedCount": 0,
  "reportPath": "/absolute/workspace/path/reports/status.md",
  "projects": []
}
```

`review` data includes only actionable Requires Review records. Every listed `id` is accepted by `review show`, `review approve`, `review reject`, and `review defer`.

```json
{
  "count": 1,
  "items": [
    {
      "id": "review_...",
      "workItemId": null,
      "project": "Arcadia",
      "goal": "Use Arcadia as the primary system for managing Arcadia development for 30 consecutive days.",
      "decisionNeeded": "Approve or reject this proposed Arcadia action: ...",
      "context": "CreateWork: ...",
      "recommendation": "Approve only if the project, goal, and action match your intent.",
      "options": ["approve", "reject", "defer"],
      "sourceInput": "original user request",
      "resultingAskRequestId": null
    }
  ]
}
```

`review approve` replays the original ask with explicit approval and preserves the resumed request id:

```json
{
  "item": { "id": "review_...", "resultingAskRequestId": "ask_..." },
  "result": { "status": "approved", "summary": "Work item created." },
  "approval": { "ask": { "id": "ask_..." } }
}
```

## Exit Codes

`0`: command completed successfully.

`1`: validation or runtime failure. With `--json`, the response uses the failure envelope above.

## Retry And Idempotency

`status`, `review`, and `review show` are read-only and safe to retry.

`dogfood init` is idempotent and may be retried.

`ask` creates a new auditable ask request and is not idempotent unless the caller deduplicates requests upstream.

`review approve`, `review reject`, and `review defer` are single-decision mutations. Retrying a completed approval or rejection returns a validation error. A deferred item remains actionable and can later be approved or rejected.

## Compatibility

The public term is `Requires Review`. Some database fields and legacy JSON compatibility fields may still use historical internal names, but human-facing output and documented ingress commands use `Requires Review`.

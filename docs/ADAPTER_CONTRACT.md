# Arcadia Adapter Contract

This contract defines the stable CLI ingress surface for daily Arcadia operation and thin adapters such as local scripts, Discord commands, shortcuts, and file ingress.

## Supported Ingress Commands

Daily workspace commands use `ARCADIA_WORKSPACE` when it is set and otherwise default to the current directory. `--workspace <path>` remains supported and takes precedence.

```text
arcadia init <workspace> [--profile arcadia] [--json]
arcadia ask "<intent>" [--workspace <path>] [--run-safe] [--json]
arcadia status [--workspace <path>] [--json]
arcadia review [--workspace <path>] [--json]
arcadia review show <id> [--workspace <path>] [--json]
arcadia review approve <id> [--workspace <path>] [--json]
arcadia review reject <id> [--workspace <path>] [--json]
arcadia review defer <id> [--workspace <path>] [--json]
```

Dogfood commands are compatibility shortcuts that always use `.arcadia-workspace/` from the Arcadia repository. They route through the same workspace model as the generic commands.

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

Generic `ask` project routing applies to dogfood shortcuts too: explicit project arguments and project references win, and a workspace with exactly one active project uses that project by default.

Dogfood shortcut JSON uses the invoked `dogfood.*` command name while preserving the delegated command payload shape.

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
    "message": "Decision was not found.",
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
  "result": { "status": "acted|queued|requires_review|captured", "summary": "..." },
  "workItem": null,
  "plan": null,
  "run": null,
  "status": null,
  "review": null,
  "reviewItemId": "review_...",
  "decisionId": "review_...",
  "backBurnerItemId": "bb_..."
}
```

When `result.status` is `captured`, adapters should treat the input as preserved in the Back Burner, not as an actionable Requires Review Decision. `reviewItemId` and `decisionId` will be `null`, and `backBurnerItemId` will identify the durable captured item.

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
      "decisionId": "review_...",
      "workItemId": null,
      "actionId": null,
      "project": "Arcadia",
      "goal": "Manage Arcadia development through the same workspace model used for every other project.",
      "outcome": "Manage Arcadia development through the same workspace model used for every other project.",
      "decisionNeeded": "Approve or reject this proposed Arcadia action: ...",
      "context": "CreateWork: ...",
      "recommendation": "Approve only if the project, outcome, and action match your intent.",
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
  "result": { "status": "approved", "summary": "Action created." },
  "approval": { "ask": { "id": "ask_..." } }
}
```

## Exit Codes

`0`: command completed successfully.

`1`: validation or runtime failure. With `--json`, the response uses the failure envelope above.

## Retry And Idempotency

`status`, `review`, and `review show` are read-only and safe to retry.

`init --profile arcadia` and `dogfood init` are idempotent and may be retried.

`ask` creates a new auditable ask request and is not idempotent unless the caller deduplicates requests upstream.

`review approve`, `review reject`, and `review defer` are single-decision mutations. Retrying a completed approval or rejection returns a validation error. A deferred item remains actionable and can later be approved or rejected.

## Compatibility

The public term is `Requires Review`. Some database fields and legacy JSON compatibility fields may still use historical internal names, but human-facing output and documented ingress commands use `Requires Review`.

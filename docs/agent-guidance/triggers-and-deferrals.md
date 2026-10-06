# Triggers and Deferrals: Reactivating Parked Actions

**When to read this:** Before deferring an Action, managing a deferred work item, or setting up a revocation trigger.

## What Triggers Do

Triggers are **reactivation conditions for deferred Actions**. When an Action is deferred (parked via an approved Decision), a trigger names the condition that will revive it. The continuation protocol states: when a trigger fires, it outranks the current Action and dispatch must address it.

Deferrals are not silence — they are **explicit, retrievable, and checked every dispatch cycle**.

## Two Ways to Declare Triggers

### 1. Document-Based (Prose)

Declared directly in managed documents using any of these patterns:

- `**Trigger:** <condition>`
- `*Trigger: <condition>`
- `Revives when <condition>` or `Reactivates when <condition>` (case-insensitive)
- Inside markdown tables with column headers like "Reactivate when", "Revives when", or "Trigger"

**Example from a Decision:**
```markdown
---
status: deferred
---

The Action stops being dispatched. **Trigger:** The operator begins the rehearsal with --provider opencode-cli.
```

**Status:** Reported as `unevaluable` by `pnpm arcadia triggers --repo`. Use these when the trigger condition is narrative (operator judgment, external event) and cannot be automatically checked.

### 2. Registry-Based (Machine-Checkable)

Declared in `.arcadia/triggers.json` with structured conditions. These fire automatically as soon as their condition is met.

**Location:** `.arcadia/triggers.json` (schema version `arcadia.triggers.v0`)

**Example:**
```json
{
  "schema": "arcadia.triggers.v0",
  "triggers": [
    {
      "id": "pr-1000-merged",
      "watches": "PR #1000 (milestone PR)",
      "condition": {
        "kind": "observed",
        "observed": true,
        "lookFor": "PR #1000 has merged."
      },
      "fires": { "plan": "bootstrap-managed-production-to-build-flight-deck", "action": "celebrate-pr-1000" }
    }
  ]
}
```

## Trigger Condition Types

### `observed` — Facts the operator or a script marks

```json
{
  "id": "client-asked",
  "condition": { 
    "kind": "observed", 
    "observed": true,
    "lookFor": "A client asks." 
  }
}
```

- `observed: true` → trigger fires immediately
- `observed: false` → trigger is waiting (and can be flipped to true later)
- Use this for external events, operator decisions, or conditions you'll check manually

### `count` — Counts matching records in repository JSON

```json
{
  "id": "two-live-sites",
  "condition": {
    "kind": "count",
    "file": "data/sites.json",
    "collection": "sites",
    "where": { "status": "live" },
    "atLeast": 2
  }
}
```

- Counts rows in a file or collection matching `where` criteria
- Fires if count ≥ `atLeast`
- File must be inside the repository (no escaping allowed)
- Useful for: row-count thresholds, feature flags, status gates

## Trigger States (from `arcadia triggers --repo`)

- **`fired`** → Condition is met. Dispatch must address it before continuing.
- **`waiting`** → Evaluated, but condition not met yet. Normal waiting state.
- **`unevaluable`** → Declared in prose (no command can check English) OR registry is malformed/incomplete.
- **`untriggered`** → Document marked `status: deferred` but names no reviving condition at all. This is a "rejection wearing a deferral's clothes."

## How to Defer an Action

**In the Decision that pauses it:**

```yaml
plan: my-plan
action: my-action
options:
  - label: Defer until condition X
    consequence: Action stops being dispatched. **Trigger:** <condition description>
    effect: defer
```

Then approve it:
```sh
pnpm arcadia decision approve <decision-id> --project <project> --answer "Defer until condition X"
```

## How to Revive a Deferred Action

When the trigger fires (either you manually flip `observed: true` or the `count` condition is met):

```sh
pnpm arcadia decision reverse <decision-id> --project <project>
```

This:
1. Un-parks the Action
2. Re-opens the Decision
3. Restores the Action to the queue for dispatch

## Real-World Examples from Arcadia

**Decision 0057 & 0061** — Deferred `prove-two-action-unattended-production` with trigger: "revives when the operator begins the live rehearsal on whichever configured provider has capacity (claude-code-cli, codex-cli today, opencode-cli when it returns)."

**Document-based trigger:** The trigger condition is described in prose in the Decision, reported as `unevaluable` by the CLI (because no code can check English).

**Registry-based trigger:** The same condition could be checked automatically if you tracked "operator started rehearsal" in a registry-based trigger.

## Key Implementation Files

- `src/docs/triggers.ts` — Core evaluation logic for both registry and document-based triggers
- `src/commands/triggers.ts` — CLI command implementation
- `tests/triggers.test.ts` — Comprehensive test suite showing all usage patterns
- `docs/managed-documents.md` — Deferral and revival protocol documentation

## Important Design Principles

1. **Triggers in managed documents outrank `current_action`** — When a trigger fires, work shifts to addressing it, not continuing the current Action.
2. **No deferral is silently ignored** — Even prose triggers unevaluable by code are reported.
3. **Containment** — Count conditions cannot reach outside the repository they govern.
4. **Repository-authoritative** — Triggers are read from checked-in documents, so they work identically in a fresh clone with no database.

## Checking Trigger Status

```sh
pnpm arcadia triggers --repo
```

Output shows every deferral and its trigger status. Use this to see what's waiting and what has fired.

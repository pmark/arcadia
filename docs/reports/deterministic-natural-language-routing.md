# Generic Entity-Attribute Update Routing Verification

Current milestone: Phase 3 natural-language intent routing.
Next action: Verify command-shaped entity-attribute updates route to deterministic Arcadia services before CaptureThought.
Work classification: autonomous.
Required artifacts: implementation, tests, this verification report.

Pipeline summary:

- `resolveIntake` recognizes simple update-shaped requests and emits `UpdateEntityAttribute`.
- Initial entity scope is `project`.
- The parser extracts `entityReference`, `attributeReference`, and `value`.
- A project attribute registry resolves aliases, validates values, assigns a safety level, and names the deterministic handler.
- `runAskCommand` executes successful project updates through a handler registry keyed by attribute.
- Unsupported projects, attributes, missing values, and invalid values create Requires Review and do not invoke Codex.

Registered project attributes:

- `goal`: aliases `goal`; handler `project.update.goal`; non-empty value required.
- `mission`: aliases `mission`; handler `project.update.mission`; non-empty value required.
- `status`: aliases `status`; handler `project.update.status`; value must be `active`, `paused`, `incubating`, or `completed`.
- `current_milestone`: aliases `current milestone`, `milestone`; handler `project.update.current_milestone`; non-empty value required.
- `next_action`: aliases `next action`; handler `project.update.next_action`; non-empty value required.

Manual verification commands:

```sh
pnpm arcadia init /tmp/arcadia-routing-check --profile arcadia
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia goal: Perform basic operations'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set goal for the Arcadia project to: Perform basic operations'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia’s goal to Perform basic operations'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set goal for the Arcadia project to "Perform basic operations"'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia goal:'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia priority to High'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia status to shipped'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Show project Arcadia'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set mission for Arcadia to Keep creative projects moving.'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia mission: Keep creative projects moving.'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia status: paused'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Update Arcadia current milestone to Deterministic natural-language routing.'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Update Arcadia current milestone: Deterministic natural-language routing.'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set next action for Arcadia to Run the deterministic routing smoke test.'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Set Arcadia next action: Run the deterministic routing smoke test.'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'List projects'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'List review items'
pnpm arcadia ask --workspace /tmp/arcadia-routing-check 'Improve the Rebuster candidate review flow.'
```

Expected output:

- Goal requests are interpreted as `UpdateEntityAttribute`, report `Project: Arcadia`, `Attribute: goal`, `Value: Perform basic operations`, `Result: Updated goal for Arcadia.`, and `Codex packets: 0`.
- `Set Arcadia goal:` is interpreted as `UpdateEntityAttribute` but creates Requires Review with `Requires Review: missing attribute value.` and does not execute an empty update.
- `Set Arcadia priority to High` is interpreted as `UpdateEntityAttribute` but creates Requires Review with `Requires Review: attribute ambiguous or missing.`.
- `Set Arcadia status to shipped` is interpreted as `UpdateEntityAttribute` but creates Requires Review with `Requires Review: invalid attribute value (...)`.
- Project read commands are interpreted as `ShowProject` or `ListProjects` and report `Result: Shown project Arcadia.` or `Result: Projects listed.`.
- Mission, status, current milestone, and next action updates report the resolved `Attribute`, extracted `Value`, `Result: Updated ... for Arcadia.`, and `Codex packets: 0`.
- `List review items` is interpreted as `ReviewRequired` and shows current Requires Review items without creating a new review item.
- The vague Rebuster request remains `CaptureThought`, creates a Requires Review item, and reports `Codex packets: 0`.

Automated verification:

```sh
pnpm exec tsc --noEmit
pnpm exec vitest run tests/phase3.test.ts
```

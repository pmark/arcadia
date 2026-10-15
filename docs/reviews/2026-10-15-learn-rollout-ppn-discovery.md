PASS — read-only discovery complete. HEAD: `97f1a6a59a2cd26e4641e0ac86eeb8cd11f24e10`.

Project scope is `project:private-practice-now`; active Action is `go-live-pilot-inquiry-path`. [PROJECT.md](/Users/pmark/.codex/worktrees/learn-rollout-ppn-20261015T220730606Z/platform/PROJECT.md:4)

First, search the durable Project lessons:

```sh
arcadia learn search "<distinctive fact terms>" --scope project:private-practice-now
```

Then retain both separately:

```sh
arcadia learn "Observed: <exact workflow fact>" --scope project:private-practice-now
arcadia learn "Inference: <tentative explanation>" --scope project:private-practice-now --provenance inference --confidence low --evidence "<source/observation/receipt>"
```

The first is an observation/high-confidence capture; the second explicitly labels the explanation as low-confidence inference. Exact retries deduplicate; changed wording remains separate. [AGENTS.md](/Users/pmark/.codex/worktrees/learn-rollout-ppn-20261015T220730606Z/platform/AGENTS.md:40) [arcadia-role skill](/Users/pmark/.codex/skills/arcadia-role/SKILL.md:44)

This creates durable evidence only—no Action, Decision, promotion, rollout, or authority. A capture would need normal write access to Arcadia’s configured workspace; it was deliberately not attempted in this read-only session. [learning.md](/Users/pmark/.codex/worktrees/learn-rollout-ppn-20261015T220730606Z/platform/docs/agent-guidance/learning.md:13)

Verified:
- Installed `arcadia` CLI exists and exposes `learn`/`learn search`.
- Registered QA role exists, is non-mutating, independent, and cannot delegate.
- Scoped search for the only supplied scenario terms (`workflow fact tentative explanation`) returned zero retained lessons.

Limitation: no concrete fact/explanation was supplied, so I could not search for an actual matching lesson. No entry point or installed tool was missing; no records or repository files were changed.

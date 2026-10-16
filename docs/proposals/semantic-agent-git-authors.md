---
arcadia: v1
type: proposal
project: arcadia
question: Should agent-authored Git commits use stable human-readable identities that encode coding platform and predominant model tier?
---

# Semantic agent Git authors

## Outcome

Agent-created Git commits should identify the coding-agent platform and predominant model tier without inheriting the operator's personal Git identity.

Use one deterministic mapping:

| Platform | Light | Standard | Heavy |
| --- | --- | --- | --- |
| Codex | Cody Swift | Cody Mason | Cody Atlas |
| Claude | Claudia Swift | Claudia Mason | Claudia Atlas |
| OpenCode | Owen Swift | Owen Mason | Owen Atlas |

Use matching local-only addresses such as `cody.mason@agents.arcadia.local`.

The semantics are intentionally memorable:

- Cody / Claudia / Owen = Codex / Claude / OpenCode
- Swift / Mason / Atlas = light / standard / heavy

## 80/20 implementation

At the shared Git commit boundary for governed coding work:

1. Read the coding platform actually responsible for implementation.
2. Read the model tier that predominantly performed substantive authoring.
3. Resolve the pair to the canonical identity above.
4. Use that identity as both Git author and committer for the agent-created commit.
5. Scope the identity to that commit/process only; never change the operator's global Git configuration.
6. Unsupported or missing platform/tier metadata must fail visibly rather than silently attributing work to the operator.

The coding agent does not choose its own identity.

## Predominant-tier rule

Authorship represents the platform and tier responsible for most substantive implementation work.

A heavier model that only reviews, critiques, plans, or briefly assists does not replace the author identity. For example, standard-tier Codex implementation reviewed by a heavy-tier Codex model remains **Cody Mason**.

This keeps Git history legible instead of turning it into a full orchestration log.

## Acceptance criteria

- All nine platform/tier combinations resolve deterministically.
- Agent-created commits show the expected name and local email in `git log`.
- Human-created commits remain unchanged.
- The operator's global Git identity remains unchanged.
- Identity resolution and Git identity isolation are covered by automated tests.
- Unsupported metadata never falls back silently to the operator's identity.

## Expected artifact

A small tested agent-identity mapping plus integration at the narrowest shared Git commit boundary.

## Defer

Do not expand this increment into:

- SQLite provenance changes
- commit trailers or execution IDs in commit messages
- reviewer identities
- avatars or personas
- configurable/custom names
- performance or reputation scoring
- model-cost accounting
- identity UI
- a generalized multi-agent organization system

These can be added only if actual use demonstrates a mission-control benefit.

## Planning note

Before implementation, inspect the current execution-to-commit path and identify the narrowest integration point shared by Codex, Claude, and OpenCode. Prefer one injection point over provider-specific implementations.

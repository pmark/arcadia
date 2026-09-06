---
name: arcadia-agent-ask
description: Draft, edit, validate, or preview an Arcadia Agent Ask. Use when the user asks to add or change governed Project work, create or edit agent-ask.yaml, submit an Agent Ask, amend a Plan or Action through Arcadia, or record a governed completion.
---

# Arcadia Agent Ask

<!-- ARCADIA_MANAGED_AGENT_ASK_SKILL -->

Treat an explicit request to plan, record, amend, or complete Arcadia-governed
work as authorization to draft or edit `agent-ask.yaml` in the current
repository. Do not ask the operator for permission to create, edit, replace,
or validate that repository-local input file.

## Workflow

1. Read the repository's `AGENTS.md` and the current Agent Ask contract when
   needed. Use `arcadia agent-ask contract` to resolve schema uncertainty.
2. Create or update `agent-ask.yaml` in the current repository with the
   smallest strict Agent Ask that expresses the user's requested result.
   Editing this input is ordinary workspace work, not a governance settlement.
3. Run `arcadia agent-ask preview --file agent-ask.yaml` autonomously. A
   preview can store a proposal receipt in Arcadia's local workspace, but it
   makes zero Project-document changes and creates no queue entry.
4. Report the proposal effects, refusals, and any operator decision it needs.
   Do not ask for permission merely to prepare the YAML or preview it.

## Boundaries

- Never hand-edit managed Project state, queue order, Action status, or
  Decision answers. Express the requested change through the Ask instead.
- A preview is never self-approving. Do not run `agent-ask settle --apply`,
  record notification delivery, or claim that governance changed unless the
  user explicitly requests the relevant settlement and Arcadia accepts it.
- Ask a focused question only when missing information would materially alter
  the Ask's intended effect. Otherwise make the smallest reasonable
  interpretation and let a Decision carry the unresolved judgment.

---
name: arcadia-agent-ask
description: Draft, edit, validate, or preview an Arcadia Agent Ask. Use when the user asks to add or change governed Project work, create or edit an Agent Ask file, submit an Agent Ask, amend a Plan or Action through Arcadia, or record a governed completion.
---

# Arcadia Agent Ask

<!-- ARCADIA_MANAGED_AGENT_ASK_SKILL -->

Treat an explicit request to plan, record, amend, or complete Arcadia-governed
work as authorization to draft or edit an Agent Ask file under `.arcadia/asks/`
in the current repository. Do not ask the operator for permission to create,
edit, replace, or validate that repository-local input file.

Never author or edit a root `agent-ask.yaml`. That path lives in the shared
base checkout: editing it there dirties the base and can block Arcadia Go's
fail-closed clean check for every worktree sharing this repository. A file
under `.arcadia/asks/` is disposable input, not managed state — see
"Boundaries" below — so isolating it costs nothing and avoids that collision
entirely.

## Workflow

1. Read the repository's `AGENTS.md` and the current Agent Ask contract when
   needed. Use `arcadia agent-ask contract` to resolve schema uncertainty.
2. Pick a `request_id` and compose the smallest strict Agent Ask that
   expresses the user's requested result — **write it as compact JSON, not
   hand-indented YAML**. JSON is valid YAML 1.2, so the parser accepts it
   as-is, and a model emits syntactically valid JSON far more reliably than
   whitespace-sensitive YAML block syntax. There is no format detection to get
   right: the same text works for `draft`, `preview`, and `settle`.
3. Run `arcadia agent-ask draft <json>` (or `--file <path>` if it's already on
   disk) autonomously. In one call this validates the Ask with zero Project
   database dependency, writes it to its canonical
   `.arcadia/asks/agent-ask-<request_id>.yaml` path — collision-checked so a
   different agent's `request_id` can never be clobbered — and, if a workspace
   is already resolvable here, previews it too. A validation failure reports
   the exact fix needed before anything touches disk. Do not hand-write the
   YAML file directly or hand-derive its path; `draft` is both cheaper (one
   round trip instead of write-then-preview) and safer (it cannot produce a
   malformed file or a wrong filename).
4. If `draft`'s output shows `workspaceStatus: not_available` (no local
   Arcadia workspace here — common in a bare cloud container), stop there:
   the committed file is itself the handoff, exactly like a `docs/proposals/`
   file, and whatever environment next has a workspace runs
   `arcadia agent-ask preview --file <path>` against it.
5. Report the proposal effects, refusals, and any operator decision it needs.
   Do not ask for permission merely to prepare or preview the Ask.

## Boundaries

- Never hand-edit managed Project state, queue order, Action status, or
  Decision answers. Express the requested change through the Ask instead.
- A preview is never self-approving. Do not run `agent-ask settle --apply`,
  record notification delivery, or claim that governance changed unless the
  user explicitly requests the relevant settlement and Arcadia accepts it.
- Ask a focused question only when missing information would materially alter
  the Ask's intended effect. Otherwise make the smallest reasonable
  interpretation and let a Decision carry the unresolved judgment.

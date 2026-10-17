# Arcadia chat titles and attention signals

Use chat titles to answer two questions at a glance: **Is this a chat I should speak to directly? What does it need next?** Keep one operator-facing coordinator per workstream. Background helpers report through that coordinator.

## Who to talk to

| Prefix | Meaning | Operator action |
| --- | --- | --- |
| No arrow | A direct contact for this workstream | Talk here for decisions and progress |
| `↳` at the very beginning | A helper assigned to a named parent coordinator | Let its coordinator collect the hand-back |

The arrow describes the reporting relationship. It does not claim native subagent lineage or governed enrollment. A separate independent reviewer can report through a coordinator while keeping its review independence. An old unconverted title is unclassified; confirm its owner rather than assuming it is a direct contact.

## What the chat needs

| State | Meaning | Title wording |
| --- | --- | --- |
| 🔵 | Working within its assignment | Name the current task |
| 🟣 | PR open and under review | Name the PR or review |
| 🟡 | Independent review cleared; required checks remain | `CI pending` |
| 🟠 | A person must answer, approve, or provide input | `approve pilot budget`, `choose wording` |
| 🔴 | Progress is blocked by an external dependency or failure | `blocked: host permission` |
| 🟢 | Assigned work completed with evidence | `merged #1416` |
| ⏸ | Deliberately parked or superseded as a contact | `former coordinator; use Lead trials` |

Use orange when a concrete operator answer is the next step. Use red when an external blocker remains and no operator answer can presently resolve it. Spell out the question or blockage; color alone is insufficient. A helper waiting for its parent uses orange with `parent input`, not an invitation for the operator to intervene. The parent surfaces any real operator decision in its own title and canonical record.

## Title format and examples

`[↳ ]<kind><state> <short workstream> · <role or task> · <specific need>`

Keep the arrow, kind and state first. Put a recognizable shared workstream name next so it survives sidebar truncation. Retain Arcadia's existing kind icons, Plan abbreviation and generated Action wording where supplied; shorten optional prose first. The generated kinds remain 🧭 planning, 🔍 review, 🔨 implementation and 🩹 repair. Coordinator chats lead with 🚦 in place of the kind glyph; it is a relationship marker (`--relation coordinator`), not a new kind. Coordination is a duty, not an additional registered role.

- `🚦🟠 Lead trials · approve pilot budget`
- `↳ 🧭🔵 Lead trials · planner`
- `↳ 🔍🟠 Lead trials · critic · parent input`
- `↳ 🔨🔴 Production · implementer · blocked: host permission`
- `🚦⏸ Lead trials · former coordinator`
- `🚦🟢 Production · merged #1416`

Compose titles with `arcadia session title --kind <kind> --state <state> [--relation coordinator|helper] --workstream <label> [--detail <role or need>]...`, which prints the exact title and reads no workspace. The parent sets each helper session's title itself with the host's session-title tool immediately after starting it, and repeats that title in the helper's brief, so the arrow never depends on the helper remembering it. A helper that retitles keeps the `↳` prefix.

Use a stable short workstream label across the parent and its helpers. Record the exact parent chat link or ID in the helper's brief or handoff; a shared label alone does not prove parentage.

## Keep the signals truthful

Update titles when responsibility or observed state changes. An idle flag, silence, or the end of a turn does not prove completion, pause, blockage or released ownership. Never mark a chat parked or former coordinator without an actual handoff or hold. A question title points to the existing Decision, Agent Ask, PR or handoff containing the full question, choices and consequences. Resolve the title when that record is resolved.

These are display conventions requested by the operator on October 15, 2026. They do not change claims, budgets, approval boundaries, model bindings, review independence or work authority. Use the generated title as the base: keep its kind, current state, Plan abbreviation and exact Action wording, then prepend the helper arrow or append the specific need. `arcadia session title` composes the full title, including the relationship marker and attention wording, from explicit inputs; it does not detect parentage. The coordinator supplies the relationship, and an agent still sets the title through the host's title tool. For a deliberately parked chat, use ⏸ in place of its state dot while preserving its kind and scope. Do not patch the harness.

The operator may still ask a helper a direct question. The arrow reduces routine relaying; it does not prohibit conversation.


## Retrieval and scope

Read this with [continuation](continuation.md) before choosing or updating a title. [Session roles and briefs](session-roles-and-briefs.md) govern actual assignments and independence. Apply the relationship marker only when the parent assignment is known. This document changes display guidance only; it creates no Role, Action, claim, spend allowance or approval.

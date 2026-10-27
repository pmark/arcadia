# Go workspace experience and prototype brief

Design proposal and agent handoff, 2026-10-27. Editorial owner: Clara, technical-writing specialization; author identity: Cody Mason. Rowan retains execution coordination. Intake: [Issue #1814](https://github.com/pmark/arcadia/issues/1814).

The operator requested: “Please make sure everything is committed and pushed to a pull request and then write a prompt that I can give to Claude 2.” No governed Action is claimed for this documentation request. This package preserves the discussion and UX advice; it does not activate a Plan, change agent authority, start production, implement a UI or publish a site.

## Purpose

Arcadia should be sufficient for directing development across Projects: understand a situation, shape work, launch an accepted increment, intervene repeatedly, inspect results and continue. Claude Code, Codex and OpenCode can perform suitable work behind Arcadia. Opening their native sessions is optional drill-down, not required operation.

Treat operator attention and focus as the scarce resource. Deliver useful reviewed changes while smoothing real friction through persistent learning and source fixes. Memory supplies continuity; code and tests make improvements dependable. Operator-assisted delivery is immediately valuable; strict unattended acceptance remains a separate claim requiring its own evidence.

Keep efficient planning in native agent conversations available initially. A future Arcadia planning conversation can develop the same records. An external Markdown plan needs explicit adoption into governed work; do not reinterpret arbitrary notes as executable authority. Avoid duplicate planning when the accepted result already has enough information.

## One environment, three persistent concepts

| Concept | Functions | Operator question |
| --- | --- | --- |
| Context | Scope, navigation, priorities, Journey and related capabilities | Where am I, and how does this fit? |
| Work | Feed, selected situation, plan, artifact, preview or decision | What matters, and what can I shape? |
| Direction | Recommended moves, contextual controls and explicit-target composer | What do I want to happen next? |

These concepts organize six functions, not six equally prominent panes:

1. **Scope and direction:** Portfolio, Project, Plan and Action context, with recorded priorities and explicit scope changes.
2. **Next move:** an explainable recommendation, its consequence and eligible alternatives; blocked options state why. Do not infer priority from unordered work or silently replace current work.
3. **Activity feed:** concise significant progress, deliveries, uncertainty and decisions. Group related events, suppress unchanged ceremony and distinguish preserved candidates, merged source and completed Actions.
4. **Journey overview:** destination, milestone, current position, completed/remaining Actions, obstacles, review gates and budget. Deeper history and receipts remain available.
5. **Contextual work area:** the crafting table for planning, conversation, copy comparison, artifact viewing, previews, diffs, decisions and revision. It changes with the selected object without discarding working context.
6. **Ask / direction composer:** persistent, explicitly targeted input. Navigation must not silently retarget a draft. Display whether input starts a new Ask, proposes a plan change or addresses existing work.

Desktop may show context beside the work area. Mobile should offer one focused work area, compact context trail and a reachable composer. Preserve a clear return to the feed. A new event never switches the operator to another task.

## Navigation and maps

Use Portfolio → Project → Plan → Action as predictable containment navigation. Domain, Mission, Outcome, Milestone, Decision, Artifact and Log remain canonical concepts and related records, not invented intermediate ownership levels. Capabilities/Topics and dependencies cross branches; work is not a pure tree.

The feed answers **what changed or needs me**. Journey answers **where we are going and what stands in the way**. The map answers **where this belongs and what it connects to**. They select the same stable objects in the same work area.

Offer a linked Markmap as an optional navigation lens, alongside an accessible outline. Start with the selected node, ancestors, immediate dependencies and affected Topics; expand on demand. Retain full-map exploration without opening a sprawling graph by default. Selection highlights the current context and follows the same draft-preservation rules as other navigation. Map links navigate only; they never execute work. See [navigation outline](navigation.md).

Reuse Living System's separation of durable meaning (Topics/relationships/views) from operational facts (Actions, Sessions, artifacts, history and freshness). A map is a derived view, never another authoritative task store. A tree projection must not hide cross-links or duplicate the identity of shared dependencies.

The information architecture should translate to a chatbot and future VR/AR/XR: stable objects, focused context, short choices, consequences, back/related navigation and explicit targets. Chat can render numbered menus; spatial interfaces can change placement and gestures. Do not build XR or force a spatial metaphor into the first prototype.

## Progressive disclosure and attention contract

- **Glance:** current scope, useful next move, significant changes and attention items.
- **Understand:** situation, evidence freshness, recommendation, uncertainty and available choices.
- **Act:** continue, redirect, revise, pause or request a scoped exception with its consequence visible before commitment.
- **Verify:** distinguish submitted, delivered, acknowledged, acted on and verified continuation; show what actually changed.
- **Audit:** exact source, review, validation, revisions, receipts, logs and native-session link when supported.

Material risk and uncertainty must not be buried in Audit. Use concise summaries with deeper evidence, not raw internal records as feed titles. No arbitrary one-correction cap: one intervention is only a demonstration minimum. Automatic repair budgets and repeated operator judgment are different concepts; do not erase consumed attempts or bypass existing gates.

New activity must not steal selection, scroll, keyboard focus or a draft. Changing context preserves the draft and names its original target. If a recommendation becomes stale during review, explain what changed and refresh the choice. Do not silently send stale instructions or resubmit an uncertain request.

Handle duplicate/contradictory input, already answered items, unavailable recipients, acknowledgment without progress, partial failure, stale evidence, empty states and manual code changes. Distinguish pause requested from paused. Preserve work and ownership through interruption; repeated launch input must not create another writer.

The operator can deliberately choose risky or destructive actions when applicable authority permits. Show the concrete effect, scope and available recovery. This desired UX creates no exception to host security or approval gates. Direct operator code edits are expected interventions: detect changes, reassess evidence and ask only where a material conflict remains.

## A typical operating day

Morning: inspect overnight deliveries and attention items, then set priorities across Projects. Discuss a new PPN copywriting feature, inspect examples and narrow scope. Accept an understandable plan and choose one Action or bounded continuation through eligible accepted work.

Go recommends work per Project or portfolio with reasons and alternatives. Preview the target, owner, result, agent and limits before launch. Provider selection follows capability, availability and cost; using all three providers is not a mandatory panel. Allow override where supported. Approval carries through its declared scope rather than being reasked at every mechanical step.

During the day, independent accepted work continues within granted boundaries. A local blocker does not stop unrelated work. Discord can draw attention to a concise situation with a link to the same controls. The operator responds, sees acknowledgment and observed continuation, and can intervene again. Native-session access remains optional.

Evening: inspect previews/results, select permitted overnight continuation and silence routine updates. Later catch-up explains actual outcomes, failures and uncertainty. None of this is a claim that all-day unattended operation is currently proved.

## Existing foundations and gaps

Evidence checked during the discussion; implementation claims are source observations, not verification of every installed path:

- [Workspace view](../../../apps/dashboard/components/workspace/workspace-view.tsx) navigates Project/Plan/Action context.
- [Workspace Ask](../../../apps/dashboard/components/workspace/workspace-ask.tsx) supports request identity, receipt inspection/recovery, related work and artifact viewing. Observed Action input is Project-scoped, not proof of native owner/acknowledgment/continuation binding. That narrow connection is separately proposed; this package does not authorize it.
- [Feed derivation](../../../apps/dashboard/lib/workspace-feed.ts) combines next steps, approvals and PRs and links to existing controls. [Feed view](../../../apps/dashboard/components/workspace/feed/feed-view.tsx) uses labelled fixture data for its embedded Journey panel. Do not label the whole feed fixture-backed or assume the embedded missions are live.
- The inspected live feed contained hundreds of attention items and an apparently stale merged PR entry. Causes were not established; prioritize relevance and visible freshness rather than asserting a diagnosed defect.
- [Living System contract](../../living-system-contract.md) and [demo](../../living-system-v1-demo.md) support Topics, relationships, views, reciprocal links, history, Markdown and Canvas. The demo documents Mindmap NextGen; exact Markmap integration in the workspace is unverified.
- [Shared session entry evidence](../unified-session-entry-2026-10-24.md) proves bounded fixture ownership and installed preparation/recovery, not the entire live intervention experience.
- [Native mail](../../agent-guidance/native-mail-checkpoints.md) is pull-only at explicit checkpoints: storage or exposure does not prove a model read or acted on input. Do not make immediate chat delivery a fictional capability.
- Discord source supports requests and review replies; no Go subcommand was established in the inspected registration. Existing browser-confirmed launch routes are not automatically Discord launch authority.

Native links should say Open in Codex/Claude only when the exact destination is verified. Codex desktop documents `codex://threads/<thread-id>`. Claude Remote Control documents session URLs/mobile access; a new-session desktop link does not establish reopening an existing session. Keep provider-specific capability/fallback handling explicit, and do not invent session IDs or enable remote control for a mockup.

## Prototype artifact and acceptance scenarios

Produce a standalone interactive HTML or React prototype from [the Claude prompt](claude-prompt.md). Shared fictional fixture state should drive feed, Journey, map and work area. No live API calls, credentials, actual launches, approvals or production writes. Label all simulation clearly.

**Primary PPN scenario:** open a copywriting attention item; compare proposed Hero/Recognition copy with fictional practitioner evidence; draft a change; follow a related capability/map link; return with draft and target preserved; send direction; separately observe simulated acknowledgment and resulting revision; inspect the comparison; approve/continue; intervene again. Arriving feed activity must not steal focus.

**Secondary scenarios:** adopt a plan discussed externally; create a new Project/feature proposal; choose next eligible work within PPN or across the portfolio; preview bounded continuation; pause/resume through explicit simulated states; inspect an artifact and return. These are proposed prototype flows, not real execution.

**Adversarial UX checks:** stale recommendation while its detail is open; duplicate send; uncertain submission/reload with no silent resubmit; answered approval still in an older feed snapshot; stopped recipient; contradictory instructions; external source change invalidating earlier evidence; partial source unavailable; fixture/live distinction; empty feed; keyboard and phone-width navigation. Show an honest next move for each rather than claiming success.

Prioritize one coherent PPN interaction over visual richness. Defer new orchestration, transport, registries, concurrency policy, live integrations, XR and generalized emergency controls. The mockup may illustrate future controls only with explicit simulated state and boundaries.

## UX advice and provenance

One bounded read-only UX advisory pass used native context `/root/session_mvp_advice`; actual model, effort and usage unavailable. It recommended Context/Work/Direction, contextual maps, continuity invariants, explicit delivery states and one shared interaction model across surfaces. Its material critique: six equally prominent areas recreate coordination burden; a tree hides shared dependencies while an unrestricted graph overwhelms. A polished map cannot compensate for unclear instruction recipients or outcomes.

Operator direction, the earlier session-MVP advice and subsequent clarifications were retained as evidence-only proposals and Learn records. This source package consolidates them; it does not settle them or create another execution ledger. Key retained references: `agentask_de02f29c69e1d18251`, `agentask_9878beca75ae868292`, `lesson_7e5220b97cec17c76821`, `lesson_f620b3d8724ff0241099`, `lesson_177b538816c460b31adf`. Original conversation: Clara chat `01a17b1e-a4d8-7a52-88fb-fbe7088d4a81`.

Use operator as the default user-facing role term; reviewer, approver, developer, product owner, user/practitioner and owner when that distinction adds meaning. Preserve human when the person-versus-agent distinction matters. Do not globally replace historical quotations, technical identifiers or canonical criteria.

## What is not done

No interactive mockup, map renderer or production integration is delivered here. Claude's next assignment is to build and evaluate the explicitly simulated prototype in its own authorized isolated candidate. Live implementation, Plan/Action changes, services, merges, deployment and publication retain their separate boundaries. Routine progress updates to Clara remain paused until the operator requests them.

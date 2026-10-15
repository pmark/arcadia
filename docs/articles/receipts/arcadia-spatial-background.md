# Design draft evidence for Arcadia spatial background

- Type: essay, design concept.
- Article: docs/articles/2026-10-14-arcadia-spatial-background.md.
- Source: the operator's request in this conversation to describe a lightweight SVG background with apparent depth, proposal-to-Action transitions, hierarchical zoom, and navigation establishing context; followed by the explicit destination `@docs/articles`.
- Status: requested prose captured; no implementation or publication claim.
- Publication eligibility: not assessed. This concept is not evidence of shipped work or a proven Milestone.

## Claims and limits

The article describes proposed behavior and design goals. Its examples are hypothetical interactions. SVG performance, accessibility, scope assembly, and integration require prototype evidence. No benchmark or live demonstration is claimed.

## Editorial check

The draft distinguishes a proposal from an accepted Action, deliberate selection from camera movement, containment from dependencies, and performance goals from measured results. It includes unfinished work and a revival trigger.

## Independent review

Not performed. This draft has not received publication review.

## Delivery handoff

Saved as a repository article draft at the operator's requested destination. Site and RSS publication have not occurred.

## Companion design specification

The operator clarified that this session produces two artifacts: the conversational article here, and the product design specification in docs/design/arcadia-conversational-workspace.md. The article now also captures the subsequent conversation about multimedia messaging, contextual views, the Mission Control sky, and a simpler identity. These remain proposed capabilities and design preferences.

The article includes the four-view proposed MVP concept at ../design/assets/arcadia-conversational-workspace/concept-04-mvp-four-views.png. Its fictional story illustrates intended capture, proposal review, draft review, and navigation; it does not establish shipped functionality.

The mobile concept and cross-device discussion were added after the operator requested an iPhone navigation view and expressed a VR/AR/XR portability ambition. The illustration is hypothetical and does not establish device support. Asset: assets/arcadia-conversational-workspace/concept-05-iphone-navigation.png.

The article now explains entity-based navigation with conversational continuity, reflecting the operator's explicit preference to minimize threads and keep history immediately accessible. Its history example describes intended behavior, not implemented retrieval functionality.

A source-backed Astra researcher investigation informed the smallest working experiment section. The 10–16-hour range is judgment under stated assumptions, not measured delivery. Live AI replies are deferred in that reduced proposal; notes/history are the real feature. See docs/design/arcadia-mvp-80-20-technical-analysis.md.

## Required real Ask experience

The operator clarified that the bottom input must genuinely integrate Arcadia Ask, its routines, related active work/processes and available artifacts. Brief Dot-like replies connecting the parts are essential, at least truthful summaries. This supersedes the notebook-only MVP recommendation. Root inspected both Ask HTTP routes, AskResponse at apps/dashboard/lib/types.ts:252 and AskTrailResponse at lib/arcadia-cli.ts:52. Existing summary/receipt/trail offer reuse; context routing, resource coverage, refresh and retry behavior remain unproven integration work. No implementation ran.

The sky source is now located and pinned; see docs/design/mission-control-sky-react-reuse.md. The article reflects the operator's requirement for verbatim renderer reuse with a React lifecycle adaptation. No implementation or live deployment parity is claimed.

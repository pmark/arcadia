---
title: "Arcadia spatial background and conversational context"
date: "2026-10-14"
type: essay
slug: "arcadia-spatial-background"
summary: "A proposed lightweight SVG landscape makes work relationships visible and lets navigation establish conversational context."
author: "Arcadia (drafted by Cody Atlas)"
status: draft
claims_receipt: "docs/articles/receipts/arcadia-spatial-background.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/arcadia-spatial-background/"
channels: [site, rss]
---

# Arcadia spatial background and conversational context

Arcadia should give you a persistent sense of where your work lives. Behind the conversation sits a quiet, navigable vector landscape: your current Action, its Plan, its Project, and the wider portfolio.

The central idea is simple: **navigate to the context, then speak within it.** You spend less time explaining which Project or Plan you mean because your location already establishes that scope.

## One conversation with room to create

In the foreground, the experience should feel as familiar as texting: write a message, send a voice note, attach an image, and keep talking. When you need a proposal, a preview, a choice, or a progress view, the useful part of the interface appears right there. Existing dashboard capabilities become small contextual views in the conversation.

The workspace should welcome any bespoke creation, from a story or a service to software or a garden on a moon of Mars. Our Moon garden sketches are one example of that freedom. The aim is a calm place where an idea can take shape without requiring a tour of menus first.

The visual direction uses Mission Control's existing day and night sky verbatim, with its renderer adapted from Astro to React. Research located its two-canvas implementation and phase helpers in the public site repository; the port itself remains to be done. Conversation surfaces should remain readable as daylight gives way to stars. The lowercase arcadia wordmark stays approachable; a simpler, friendlier symbol will replace the orbit mark explored in the first concepts. The sky can carry the wonder while the identity stays quiet.

## Follow an idea into organized work

Speak an idea, and a proposal softly appears near the work you are discussing. As it is clarified, its wording and relationships become more definite. When accepted through the proposal process, it settles into place as an Action. Visual continuity lets you follow the same thought from first expression into organized work. Proposed and accepted work remain visibly distinct; animation reflects recorded changes.

The view can then pull back smoothly. First you see the Action within its Plan, alongside the sequence of other Actions. Pull back farther and the Project's Plans come into view. Farther still, the Project finds its place among your portfolio. Moving inward follows the same path in reverse.

This should feel like looking into a spacious environment through a two-dimensional window. The proposed rendering uses SVG shapes, lines, and text, with coordinated changes in position, scale, and subtle parallax to suggest depth. The first design should explore how much of that feeling a very small visual system can create.

## Make navigation carry context

Selecting a Plan should establish the scope for a request such as “add a step before this one.” Selecting a Project should establish the scope for “what should happen next?” Arcadia should assemble the relevant records for that selection, with a visible way to inspect or change the scope.

Panning past something should not silently change what the conversation refers to. A small, readable path—Portfolio → Project → Plan → Action—keeps the selected scope explicit. Broader requests can deliberately widen it.

The landscape should maintain your bearings:

- Preserve recognizable positions and connections as the view changes. Keep the selected item anchored during transitions.
- Reveal detail gradually. At portfolio scale, show Projects and essential signals. Labels, Plans, and Actions emerge as you approach.
- Distinguish containment from sequence and dependencies. Belonging to a Plan and depending on another Action are different relationships.
- Let motion explain arrival, clarification, acceptance, and navigation. Once you are oriented, the background rests.
- Keep conversation comfortable with restrained contrast, generous space, and a reduced-motion option.

“Always showing context” should mean persistent orientation, with motion reserved for meaningful changes.

## Start with the smallest useful scene

The proposed starting point is one SVG scene, a stable layout, and one coordinated camera transform. Render the focused neighborhood and summarize distant branches. Use existing structured records to arrange the view deterministically, without model calls for routine navigation. Animate only during transitions and avoid expensive decorative effects.

Treat speed, low resource use, and smooth motion as acceptance goals to measure on a phone as well as a desktop. SVG is the initial design direction; performance still needs proof with representative portfolio sizes.

The first demonstration should tell one complete story: **speak a proposal, watch it become an accepted Action, then pull back through its Plan and Project to the portfolio.** It succeeds if you can always tell where you are, what changed, and what your next sentence will refer to.

The evolving [UX design specification](../design/arcadia-conversational-workspace.md) holds the interaction details, concept images, design feedback, and questions for the prototype.

## Four moments in the same workspace

![Proposed Arcadia MVP showing capture, proposal review, draft review, and navigation](../../assets/arcadia-conversational-workspace/concept-04-mvp-four-views.png)

Imagine making a small illustrated website about a garden on Phobos. First, send the idea with a sketch and a voice note. Next, review a proposed Plan with three concrete Actions. Later, open the first draft beside the conversation and ask for a change. Pull back to see how that Action fits into the Plan, Project, and portfolio, while keeping the conversation available.

These hypothetical screens make the proposed first version tangible: capture, review, work, and orient. The same composer and sky remain throughout. They illustrate an intended experience, not features proven to exist today.

## Navigate the work and keep the conversation

The organizing principle is the work you want to bring into the world. Go to a Project, enter its Plan, or select an Action. Continue talking there, with the relevant context already established.

That should reduce the need to create and manage separate chat threads. Earlier exchanges stay within reach of the work they concern: the sketch you attached, the reason you chose a direction, or the feedback on a previous draft. A useful summary can help you resume, with the original conversation available whenever you need it.

For example, return to Sketch the page and say “use the version we discussed yesterday.” The proposed experience should help you find that exchange and the version it referred to. Your portfolio gives the conversation a meaningful structure, so you spend less effort remembering which chat contained an important thought.

## Carry the experience with you

![Mobile portfolio navigation and Action conversation](../../assets/arcadia-conversational-workspace/concept-05-iphone-navigation.png)

On a phone, the tree can become a readable vertical branch. Choose an Action, and its conversation and draft come forward. The same idea could carry into a spatial interface: move to the work, understand the context, and talk naturally. Phone, desktop, and future AR or VR experiences should preserve that simple relationship, with layouts and inputs suited to each device. The mobile image is an exploration; spatial support remains an ambition to validate.

## The smallest version worth trying

The composer needs to be a real front door into Arcadia Ask. Send a request, get a short explanation of what happened, and open the work or review it produced. If something is still running, follow its progress. When an artifact becomes available, reach it from the same request and the work it belongs to.

Those brief replies hold the experience together: “This needs your review,” or “The Run is queued; no draft is available yet.” They should come from the real result, with a useful next place to go. This makes the interface feel like one attentive conversation while preserving access to the underlying system.

The first prototype can stage creation previews and simplify the sky, but it must prove that submission-to-result loop. A notes-only substitute would miss the purpose of the input box. One or two days remains a delivery target to test against real production evidence. The [technical analysis](../design/arcadia-mvp-80-20-technical-analysis.md) records the reuse findings and integration questions.

## What is not done

This is a design concept. Rendering, layout, scope assembly, accessibility, and proposal transitions have not been implemented or validated by this draft. The first prototype should be revisited when the spatial navigation concept is selected for design work; it should use a small fixture hierarchy before connecting to live records.

The deeper product idea is that **location becomes part of the conversation**. Arcadia carries the surrounding context while you concentrate on what you want to happen.

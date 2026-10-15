# Design evidence for Arcadia conversational workspace

- Specification: docs/design/arcadia-conversational-workspace.md.
- Source: the operator's requests and feedback in this session, beginning with the spatial hierarchy and continuing through conversational UI, concept generation, Mission Control sky integration, identity feedback, and the request for a final session design document.
- Destination: the operator clarified that the design specification belongs in docs/design and the companion article belongs in docs/articles.
- Assets: three generated concept images and the supplied logo reference, copied into docs/design/assets/arcadia-conversational-workspace/ so the document does not depend on temporary attachment paths.
- Generation: built-in image generation; images are illustrative raster concepts. The three source prompts are recorded in this conversation's tool calls.

## Claims and limits

Operator feedback establishes preferences, not implementation or publication authority. The specification labels designer proposals and open questions. It makes no implementation, benchmark, exact typeface, live application inspection, or deployment claim. The description of the existing animated background comes from the operator; the real background has not been inspected during this design work.

## Editorial check

The specification separates established direction from exploration, preserves the rejected orbit-symbol feedback, distinguishes proposed and accepted state, and includes responsive, accessibility, scope, and performance questions. Asset links are repository-relative.

## Independent review

Not performed. This is a working session draft, not a publication-ready or accepted implementation specification.

## Delivery handoff

Draft saved for continued design work. Publication and implementation remain unperformed.

## Four-view MVP concept

- Asset: assets/arcadia-conversational-workspace/concept-04-mvp-four-views.png.
- Generated with the built-in image tool using concept-03-mission-control-sky.png as the style reference. The full generation prompt is in this session's tool history.
- Fictional scenario: an illustrated Moon garden website, one Plan, three Actions. Four states demonstrate capture, proposal review, Action/artifact review, and scope navigation.
- Visual inspection: four coherent panels, consistent composer and twilight background, readable feature controls, lowercase wordmark without the rejected orbit symbol.
- Limits: generated mockup only; no functional, performance, accessibility, acceptance, or live background integration proof. The wordmark-only identity and MVP boundary are designer proposals pending feedback.
- Saved in the design document and referenced by the companion article.

## iPhone navigation concept

- Asset: ../../assets/arcadia-conversational-workspace/concept-05-iphone-navigation.png.
- Built-in image generation using the operator-supplied crop of the portfolio tree as reference. Prompt recorded in this session.
- Two hypothetical states: vertical branch navigation and Action conversation with a draft artifact.
- Operator feedback: approval of the four-view direction, request for mobile navigation, and ambition for VR/AR/XR continuity.
- Open issue: expanded branch styling and conversational scope must be distinguished more clearly. No mobile or spatial implementation or accessibility validation is claimed.

## Entity navigation and conversation continuity

The operator approved the mobile direction and stated: “Unified UX with flexible context navigation” and “Minimize conversation threads while keeping history immediately accessible.” They prefer navigating entities that structure desired outcomes over an endless list of chat sessions. The specification records that principle and proposes a compact History entry point, original-scope provenance, cross-entity references, search, draft preservation, and return-position restoration. Those detailed mechanics remain designer proposals requiring validation.

## Focused MVP estimate

The operator requested an aesthetic prototype plus one functional feature, with other features optionally simulated, organized for a mind map. The specification and arcadia-mvp-milestones.md propose 28–44 focused hours over three milestones. Limited local inspection confirmed the dashboard framework and Ask route, not scoped chat/history reuse or exact sky integration. The range is judgment with stated assumptions, a discovery checkpoint, and integration contingency; it is not benchmarked throughput or a delivery guarantee. No implementation was started.

## Astra technical scope reduction

Operator explicitly requested an Astra sub-agent with appropriate role. Native child /root/astra_mvp_research was launched with requested model gpt-6-astra, fork_turns none, registered researcher role, depth 1 and read-only ownership. The generated heavy-tier brief's configured model was gpt-6.1-sol; it was not represented as the child's requested runtime. No governed Session admission or production launch is claimed. Full source-backed findings are in arcadia-mvp-80-20-technical-analysis.md. Recommendation: 10–16 focused hours for contextual notes/history; real AI conversation is explicitly deferred. Root independently corroborated key source findings. No implementation tests ran in this analysis.

## Timing and parallelism correction

The operator challenged calibration against evolving always-on Arcadia production. Root inspected eight checked-in October 13–15 session records excluding this session; none had wall_min populated, and attempts ranged one to four. No runtime distribution or current production-readiness claim is supported. Current delivery map removes numeric estimates, distinguishes the operator's calendar target, identifies two technically separable coding lanes, and retains independent final-head validation. Earlier figures are historical judgments.

## Required real Ask experience

The operator clarified that the bottom input must genuinely integrate Arcadia Ask, its routines, related active work/processes and available artifacts. Brief Dot-like replies connecting the parts are essential, at least truthful summaries. This supersedes the notebook-only MVP recommendation. Root inspected both Ask HTTP routes, AskResponse at apps/dashboard/lib/types.ts:252 and AskTrailResponse at lib/arcadia-cli.ts:52. Existing summary/receipt/trail offer reuse; context routing, resource coverage, refresh and retry behavior remain unproven integration work. No implementation ran.

## Verbatim Mission Control sky reuse

Operator explicitly requested a read-only research agent to inspect the public site's repository and reuse its sky verbatim in React. Native researcher /root/mission_control_sky_research inspected the clean site repository at c0347d93c964e50779ebb44b16e690642d857ebd. The full source map and evidence are in mission-control-sky-react-reuse.md. Root separately verified the two canvases, phase/session initialization, fixed CSS, source SITE_URL and sanitized remote. This supersedes approximated CSS-sky proposals; no port or deployment was performed.

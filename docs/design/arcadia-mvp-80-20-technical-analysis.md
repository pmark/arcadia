# Arcadia MVP technical 80/20 analysis

Status: proposal, 15 October 2026 UTC. No implementation, production launch, or governed Plan change.

## Background source resolved

The operator requested reuse of the existing Mission Control sky verbatim. A separate read-only researcher located it in pmark/mission-control-site at c0347d93c964e50779ebb44b16e690642d857ebd. It is two dependency-free Canvas 2D layers plus TypeScript phase helpers. Preserve its drawing and constants and adapt only lifecycle/refs/theme/CSS integration to React. Earlier CSS recreation recommendations below are superseded; the prior negative dashboard search did not inspect the separate site repository. See [sky reuse handoff](mission-control-sky-react-reuse.md).

## Product clarification superseding the notebook proposal

The operator requires a real Arcadia Ask composer with integrated responses, immediate access to related processes/work/available Artifacts, and brief assistant replies tying the experience together. The notebook-only scope below is therefore superseded as the MVP recommendation. Its estimate does not cover the required feature.

The earlier finding that Ask is an effectful intake path remains valid. It means integrate its real semantics faithfully, not avoid Ask altogether. Existing POST /api/ask returns summary and structured references; GET /api/ask/show exposes a read-only trail. Root inspected lib/types.ts:252 and lib/arcadia-cli.ts:52, plus both route files. The first implementation can render receipt-derived short replies without introducing a second generative service.

Remaining discovery: a supported selected-entity context/routing contract (the HTTP input inspected exposes only request and requestId), coverage of work/Run/Decision/Artifact references, request correlation and retry semantics, status refresh, and reopenable entity-linked history. Those paths need acceptance proof. Future artifacts cannot be shown as existing; expose their process while pending.

See the revised specification and delivery map. Prior estimates and notebook design are retained below as historical reasoning, not current scope or a production forecast.

## Timing correction after operator feedback

The operator challenged estimates based on human working-day intuition and asked about continuous production and parallel work. The 10–16-hour figures below are retained as the historical researcher's judgment, **not calibrated measurements or a current production forecast**. They should not establish a delivery ceiling or force product scope cuts. The source-backed technical reuse findings remain useful.

A bounded check of checked-in session rows dated October 13–15 (excluding this design session) found eight records and zero populated `wall_min` values. Attempt counts ranged from one to four. This is not enough to estimate comparable UI work, and older rehearsal or incident durations must not be projected onto today's system. No live production status check was performed for this timing correction; the older readiness document is not presented as current readiness proof.

Technically parallelize two lanes after a small contract: visual shell/navigation, and context/persistence helpers plus focused state tests. Assign disjoint files, use separate authorized candidates if production admits simultaneous coding, and give integration one owner. QA-case preparation can overlap; acceptance and independent current-head review must verify the integrated result. Do not expand native delegation or production concurrency policy merely to realize this schedule.

Under the operator's continuous-production assumption, forecast the critical path: contract + max(two implementation lanes) + integration + final checks/review/repair + actual waits. If only one implementation lane is admitted, the coding branches add instead. Always-on operation removes off-hours gaps; it does not make dependent stages parallel. Two equal branches can at most halve their own elapsed portion; overall speedup is lower. No measured parallel fraction is available.

Keep one or two calendar days as a target. Instrument existing receipts with packet-ready, launch, first-diff, PR, checks-complete, review-complete and usable-preview times; separate active runtime, queue/approval waits and retries. Reforecast after the first complete representative package, then calibrate against several comparable UI/storage completions. Percentile promises require enough comparable observations.

The [updated delivery map](arcadia-mvp-milestones.md) is the current presentation. Live AI replies remain a proposed deferral based on the missing safe chat seam, not a demonstrated inability of modern coding agents to implement them quickly.

## Original research recommendation

Build a polished **contextual notebook** in the existing dashboard in **10–16 focused coding-agent hours**, roughly one or two working days. One real feature: select work, write a note, navigate elsewhere, and recover the note and unsent draft from that entity's history after refresh.

This explicitly reduces the earlier 28–44-hour proposal: **live model-grounded conversation is deferred**. Assistant replies, proposal cards, artifact previews, and execution states are visibly staged. A saved note says “Saved in this browser”; it does not imply an Ask was submitted, a model replied, or work started. If real generative conversation is required in this first increment, the researcher does not support the two-day ceiling from the inspected code.

Research: explicitly operator-requested Astra native sub-agent, requested model `gpt-6-astra`, registered role `researcher`, depth 1, task `/root/astra_mvp_research`. Read-only investigation, no children, edits, model-service calls, tests, service operations, or production launches. Root integrates the evidence. The CLI-generated role brief resolved its configured default to `gpt-6.1-sol`; the actual native launch explicitly requested Astra under operator direction. These are distinct records. Baseline: `7bbfbed074505adc22513e7b7944cfa3974a4019`; design drafts are additional uncommitted inputs.

## Source-backed technical findings

| Existing primitive | Source | Consequence |
| --- | --- | --- |
| Next.js/React dashboard with Tailwind, Lucide and Markdown | apps/dashboard/package.json:7 | Add one route; reuse packages and conventions rather than build another app |
| Mobile viewport and safe-area setup | apps/dashboard/app/layout.tsx:15 | Reuse device foundations; validate the keyboard and actual phone layout |
| Responsive shell | apps/dashboard/components/mobile-shell.tsx:6 | Reuse layout conventions, but its opaque surface is unsuitable for the sky concept |
| Light application palette; dark styling scoped to Production | apps/dashboard/app/globals.css:25 and :37 | No reusable sky/day-night implementation was identified in bounded dashboard inspection; exact Mission Control background source remains unresolved |
| Project/Plan and Action readers | apps/dashboard/lib/plans-server.ts:39 and :61 | Existing later live-data seam; avoid workspace dependencies for the fixture prototype |
| Action/Plan types | apps/dashboard/lib/plans-types.ts:29 and :75 | Use stable Project/Plan/Action IDs, not display titles, for note ownership |
| Encoded Plan navigation | apps/dashboard/components/plans-list.tsx:40 | Existing navigation patterns, not an implemented context-chat tree |
| Ask endpoint accepts text and request ID | apps/dashboard/app/api/ask/route.ts:7 | No contextual chat/history contract is exposed here |
| Ask delegates to intake with `--run-safe` | apps/dashboard/lib/arcadia-cli.ts:1104; src/commands/ask.ts:145 | Intake can report acted, queued, or requires-review; do not wire a demo composer to this path as if it were harmless chat |
| Job history and Ask trail | apps/dashboard/components/intelligence/recent-history.tsx:13; apps/dashboard/lib/arcadia-cli.ts:1119 | Neither supplies the proposed entity conversation store |

Root separately verified the Ask adapter, outcome type, dashboard palette, viewport and Project reader. No live application inspection or functional test is claimed. A bounded negative search is not proof that the sky cannot exist elsewhere; its reuse remains an open input.

## Smallest complete implementation

Proposed paths, subject to implementation discovery:

- `apps/dashboard/app/workspace-preview/page.tsx`: client view with fixture navigation, selected scope, composer and history.
- `apps/dashboard/app/workspace-preview/workspace-preview.module.css`: isolated sky palettes, sparse stars, readable surfaces, restrained motion and reduced-motion treatment.
- `apps/dashboard/lib/workspace-preview.ts`: small fixture hierarchy, state and versioned persistence helpers.
- One focused behavioral test file, plus the existing browser-test arrangement if available; no new test framework solely for this prototype.

Use two fictional Projects, one Plan each and a few Actions. Keep one selection rule: selecting an entity changes conversational scope immediately. Use a readable nested navigation list on phone and the same list beside the notebook on desktop; a graph layout engine and complex interactive ARIA tree are unnecessary.

Persist per-entity notes, drafts and selection in a small versioned browser-local storage namespace. This is personal prototype state, not governed Project truth. Confirm successful storage before claiming a note is saved. Preserve the draft and show a recoverable error on failure. Malformed stored data must not be silently overwritten. Scope one active tab; cross-tab and cross-device collaboration are outside this slice. Browser-local storage does not promise backup or survival of clearing site data.

Use CSS gradients, sparse stars and three time palettes, with a preview control to inspect them. Use system/existing typography. New dependencies, graph physics, WebGL, a backend, a database migration, a chat API and exact font/logo work are unnecessary. Exact reuse of the operator-described sky is outside the estimate until its source is located.

## Three delivery checkpoints

These are proposed groupings for presentation, not newly created governed Milestones or Actions.

| Checkpoint | Done when | Focused time |
| --- | --- | --- |
| 1. Feel right | Isolated route shows readable hierarchy, scope, composer and quiet sky at phone and desktop sizes; no overflow; keyboard and reduced-motion treatment work; no production API calls | 3–4h |
| 2. Make one thing real | Notes and unsent drafts survive A → B → A and reload; B remains separate; duplicate activation creates one note; persistence failures retain text and never report success; History reopens prior notes | 4–6h |
| 3. Prove the experience | Check actual iPhone keyboard/safe areas, desktop keyboard, larger text, three sky palettes and storage failures; refine demonstrated usability defects; document staged content, route and reachability; update START_HERE.md for the added flow | 3–6h |

Total **10–16 hours** assumes an available coding agent familiar with the dashboard, usable dependencies, prompt visual feedback, and physical iPhone access. Includes focused checks, independent PR review and a modest repair allowance. Required CI gates remain mandatory; material failures, findings or device-access delays invalidate the upper bound. These are estimates, not measured agent throughput.

## Proposed production handoff

Potential sequential Action IDs are `workspace-preview-shell`, `workspace-context-notebook`, and `workspace-preview-acceptance`, each agent-owned and session-sized, with the next depending on the prior. Next verbs must clearly say build, implement or prototype so dispatch does not mistake coding work for a new planning cycle. Each packet needs its exact criteria above, file boundary, required checks and Artifacts: candidate PR, focused evidence, screenshots and executable operator QA instructions. The acceptance packet must make concrete repairs and supply evidence, not merely assert that another agent's work passed.

Keep one development writer at a time and use the existing production harness and preservation/PR path. These may alternatively be internal checkpoints of one bounded Action to avoid unnecessary launch and review overhead; choose that through the governed planning path, not by editing pointers. Do not change production infrastructure to deliver this UI.

Check commands are proposals, not reported successes: run focused behavioral tests in the repository's existing arrangement, required lint/type/build and current-head CI checks, dashboard build, and indexed fast-rehearsal/report requirements. Tests should exercise scope ownership, refresh restoration, duplicate activation and failure retention. Independent review stays mandatory.

The existing current Action is unrelated: `launch-failure-keeps-cause`, in docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md:12. This proposal does not move it. Production startability is not certified: launch, provider/capacity, authorized placement, current-head review, CI and any required operator gates must be revalidated at dispatch. **One or two days means focused engineering effort after start, not an unattended elapsed-time promise.** Deployment and shared-service changes are separate boundaries.

## Acceptance demo

Open `/workspace-preview`. Select Moon garden → First website → Sketch the page. Save “Keep the opening quiet,” then start another draft. Visit Field Notes and save a different note. Return to Sketch the page and reopen History. The saved note and unsent draft remain, with no Field Notes content. Refresh and recover the same context. Demonstrate storage failure without losing the draft. Repeat navigation with the iPhone keyboard open and show day, twilight and night.

This proves a usable contextual workspace with persistent browser-local notes. It does not prove AI reasoning, canonical intake, execution or synchronized devices.

## Scope guard and revival triggers

At the end of checkpoint 1, stop widening scope. If time slips, retain gradients, static stars, the three palettes and a simple history list; drop decorative motion and extra staged cards. Never cut truthful save state, scope isolation or required review.

| Deferred | Revival trigger |
| --- | --- |
| Live generative conversation | Real replies become the selected next functional requirement, and a bounded context/history service contract and approved model route are identified |
| Live portfolio reads | Fixture journey is accepted and actual Project usefulness is the next question |
| Server history and synchronization | The operator needs the same notes across devices |
| Exact background reuse | Its real source and reuse path are located |
| Attachments, advanced search, creation or execution | A selected user journey specifically requires that capability |
| VR/AR/XR implementation | A target device and concrete interaction need are selected after phone/desktop validation |

## Evidence limits and instructions

The researcher loaded the role skill, Constitution, Project/current Action, context policy/index, operator-directed work, principles, learning, simplification, session guidance, repository Orientation/QA sections, relevant Notes To Self and design drafts. It reported 84,064 bytes of source-file sizes for twelve guidance inputs; that measures files, not model-context consumption. Some broad outputs were truncated; findings rely on separately retrieved bounded sections. Root loaded .agents/skills/arcadia-role/SKILL.md, .agents/skills/arcadia-guardrail/SKILL.md, docs/agent-guidance/session-roles-and-briefs.md, standard-harness.md, code-simplification.md, principles.md and relevant repository/readiness/notes sections. No code implementation or acceptance validation ran during this analysis.

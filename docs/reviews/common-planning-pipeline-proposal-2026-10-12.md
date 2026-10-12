# Common Plan creation pipeline — governed proposal

Request: `plan-common-planning-pipeline-20261012`
Proposal: `agentask_ffaf3b007126955ede`
Settlement preview: `9b038f85d4983082bad5e3a63527344eeb5cdf9786f332ddb48d24c8e8e931e7`

Status: pending proposal. The operator instructed: “Keep the proposal pending for now, but let's get it checked in with a pull request.” This document and its companion Agent Ask preserve a proposal; neither accepts, activates nor implements the proposed work.

Operator requested governed work on 2026-10-12 after the pipeline audit. Aligns with PROJECT.md: clarified, routed, executable work with minimal operator attention; deterministic mechanics before models, truthful evidence and hard approval boundaries. This is a new inactive draft proposal, not activation, reprioritization or implementation. Reuse existing Ask routing, packet approval, Agent Ask settlement, role guidance and PR 1307 acceptance validation where available; do not duplicate their owning Actions. Vital few: common contract, one prompt source and shared validation first, then adapters and replay proof. Each Action is one bounded implementation Session plus scoped independent review; deterministic rendering/validation/replays invoke zero models; live inference uses existing approved policy and finite repair budgets rather than a new spend mechanism. Defer a generic workflow DSL, new planning database, vendor-specific prompt copies and automatic broad backlog import until a concrete second unmet use case and an approved Decision justify them. Any approval, activation, legacy promotion or model-spend policy change requires a separate explicit Decision before that effect is implemented. Current production-hardening Plan and queue remain unchanged. Earlier precise-criteria amendments remain pending; this proposal does not accept or supersede them.

## Proposed Actions

### define-common-planning-contract

Define a versioned planning contract for confirmed intent, proposed Actions and governed Plan output. Recommended role: implementer, standard tier, size M; policy changes require an operator Decision.

Why: One explicit contract prevents divergent plan shapes and catches cheap errors before model spend.
Dependencies: none

Acceptance criteria:

- A checked-in typed contract distinguishes raw capture, alignment pending, confirmed Outcome and Milestone, proposed planning Artifact, inactive managed Plan and separately activated Plan; fixtures identify the current stage without invoking a model.
- Contract validation rejects missing or empty criteria, subjective placeholder conditions, duplicate Action ids, unknown dependencies and dependency cycles with the Action and field named; valid fixtures preserve Action order, required Artifact, responsibility, next verb and evidence method.
- The design Artifact lists every current Plan writer and planning entry point, their authority and backward compatibility obligations; it identifies the minimum common boundary and maps existing role and Ask work to its owning Action rather than creating duplicate work.
- Every proposed change to approval, activation, legacy promotion or model-spend authority records an explicit open Decision and blocks the affected implementation until the Decision is answered; the common schema itself grants no authority.

### centralize-planner-instructions

Implement one deterministic planner instruction renderer and document the actual Plan creation pipeline. Recommended role: implementer, standard tier, size M; no new execution authority.

Why: A single prompt source makes procedure corrections reach every planner without repeated manual editing.
Dependencies: define-common-planning-contract

Acceptance criteria:

- One checked-in planning instruction source supplies alignment and architecture instructions to runtime packets and repository planner guidance; changing one fixture requirement updates both rendered outputs without editing a second prompt copy.
- The renderer includes the contract version and source hash in its output; repeated rendering of the same inputs produces byte-identical instructions and invokes zero models.
- docs/planning-process.md names every supported entry point, proposal and Artifact meanings, alignment evidence, validation, acceptance, inactive draft creation, separate activation and per-Action execution, with executable tool references and current exceptions.
- START_HERE.md and indexed guidance link to the common procedure; a deterministic drift check rejects an outdated generated prompt or broken instruction reference. Planner role requirements reuse teach-planners-divide-and-conquer-roles rather than independently changing its policy.

### share-governed-plan-construction

Implement shared Plan construction and validation for Agent Ask creation, amendments and bootstrap translation. Recommended role: implementer, standard tier, size M; existing settlement authority only.

Why: Shared construction removes bypasses while preserving the existing governance boundaries.
Dependencies: define-common-planning-contract

Acceptance criteria:

- Agent Ask Plan creation and amendments use the shared Action validator and Plan construction boundary; valid input preserves acceptance strings and dependency order, including literal dollar sequences, with round-trip fixtures.
- Bootstrap translation uses the same document validation boundary and labels its initial planning or clarification Action as such; it refuses to fabricate confirmed product requirements or overwrite an existing managed Plan.
- Fixtures for invalid criteria, missing dependencies, cycles and inconsistent pointers reject before any managed document or queue write; failure leaves the original files and operational projection unchanged.
- Creation produces an inactive draft with no current-Action or queue movement; amendment keeps all omitted fields unchanged. Existing fingerprints, independent approval, receipt identity and publication requirements remain enforced.

### route-requests-through-common-planning

Connect Ask-driven planning and repository planner sessions to the common alignment and architecture contract. Recommended role: implementer, standard tier, size M; preserve packet and model approvals.

Why: Different capture surfaces must converge on the same contract without adding unnecessary interviews.
Dependencies: centralize-planner-instructions, share-governed-plan-construction

Acceptance criteria:

- For the same confirmed input, Ask packet preparation and the repository planner renderer include the same contract version, required Action fields and approval boundaries; fixtures assert equivalent contract output without live model calls.
- An input lacking required Outcome, Milestone or unresolved judgment evidence produces one named clarification or Decision requirement rather than a silently assumed product Plan; already confirmed input reuses its recorded evidence and does not repeat settled questions.
- Requests that return an answer, deterministic report or Back Burner capture retain their existing route and do not acquire a planning interview; routing fixtures cover each of those cases alongside new-Project and existing-Project planning.
- Planning packet approval authorizes only the exact bounded read-only Run. A stale packet hash or changed source revision refuses launch, and drafting instructions alone starts no Run or model call. Existing Ask capture and trail identifiers remain attached.

### unify-planning-acceptance-and-promotion

Reconcile accepted planning Artifacts and Project preparation promotion with the common governed Plan pipeline. Recommended role: implementer, standard tier, size M; migration or authority changes wait for a Decision.

Why: Planning acceptance should preserve the reviewed work and use explicit activation rather than a hidden special writer.
Dependencies: route-requests-through-common-planning

Acceptance criteria:

- A valid structured planning Artifact converts to an exact previewable Plan proposal through the shared validator and writer; the preview names every created or amended Action and preserves the Artifact, capture, contract version and source revision as provenance.
- Project preparation and ordinary planning acceptance expose the same validation and governed conversion contract; a fixture proves ordered proposed Actions are preserved in the proposal rather than silently discarded or inferred from prose headings.
- No new Plan becomes active or launches implementation solely because a planning Artifact was produced or accepted. Any change from existing automatic one-Action promotion is implemented only under the explicit Decision identified by define-common-planning-contract.
- Replay of an accepted revision returns its existing receipt and creates zero duplicate Actions or packets; changed Artifact content, stale approval and interrupted document writes refuse or recover through the existing receipt path with original pointers preserved.

### prove-common-planning-pipeline

Prove the common Plan creation pipeline with deterministic route and refusal replays plus remote operator QA. Recommended role: implementer, standard tier, size M; independent review before delivery.

Why: Route proofs make consistent planning an enforced behavior rather than a documentation promise.
Dependencies: unify-planning-acceptance-and-promotion

Acceptance criteria:

- A checked-in replay matrix covers Ask planning, a repository planner proposal, Project preparation, Agent Ask creation and amendment, bootstrap translation, and accepted-Artifact conversion. Each path asserts the same versioned contract and its declared authority boundary.
- Negative replays cover vague criteria, missing alignment evidence, duplicate ids, unknown and cyclic dependencies, stale approvals, changed Artifacts, replayed request ids and interrupted writes; each reports the named refusal and verifies no unauthorized pointer, queue or Run changes.
- The deterministic matrix invokes zero live models and zero external services. Its documented CI command exits 0 for all valid cases and nonzero when a fixture bypasses the common validator or a generated instruction has drifted.
- PR evidence records the exact commands and exit results, one receipt chain from capture to proposal to approved draft to separately activated Action in disposable fixtures, and executable phone-reachable operator QA. Independent review of the current head has no unresolved blocking findings and all required checks pass.

## Preservation and evidence

Live Agent Ask contract loaded; registered proposal and exact settlement preview received. Targeted existing-Plan search found related Ask and planner-role work and the scope explicitly reuses it. Initial sandbox workspace receipt write was denied; the unchanged preview succeeded through ordinary host approval. Auto-discovery reported the pre-existing differently serialized precise-criteria-active temporary input; the new proposal itself registered successfully and that unrelated request was not settled.

Instruction sources: AGENTS.md; CONSTITUTION.md; PROJECT.md; active Plan current Action; .arcadia context policies; docs/agent-guidance/index.json; docs/planning-process.md; docs/managed-documents.md; docs/agent-guidance/agent-asks.md; docs/agent-guidance/arcadia-repository.md; docs/agent-guidance/learning.md; docs/agent-guidance/principles.md; docs/agent-guidance/proposals.md; docs/notes-to-self.md; /Users/pmark/.codex/skills/arcadia-agent-ask/SKILL.md.

The companion input was produced by `arcadia agent-ask draft` from the originally registered JSON and replayed proposal `agentask_ffaf3b007126955ede`. The request id and proposed scope are unchanged. The earlier settlement fingerprint is a historical preview, not authorization and not a reusable approval; any future acceptance requires a fresh preview. Merge of this preservation PR alone is not proposal acceptance or Plan activation.

The requested preservation branch starts from main and carries only the Agent Ask input and this review Artifact. Work monitoring found no matching edits in another candidate. Initial CLI execution in the new worktree could not resolve `tsx`; using the existing main runtime with an explicit isolated `--dir` completed the same draft operation without installing dependencies or modifying main.

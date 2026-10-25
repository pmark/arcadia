---
arcadia: v1
type: plan
slug: unify-interactive-and-unattended-coordination-with-safe-concurrent-actions
project: arcadia
status: draft
milestone: Unify interactive and unattended coordination with safe concurrent Actions
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-25
actions:
  - id: prove-shared-enrollment-at-concurrency-one
    title: Prove interactive continuation and unattended execution use the same host enrollment and ownership contract at concurrency one.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-shared-enrollment-concurrency-one-20261024; no further action.
    expected_artifact: Evidence satisfying Agent Ask prove-shared-enrollment-at-concurrency-one
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-unified-first-action-20261024
    acceptance_criteria:
      - ENTRY — A focused integration test races interactive and unattended requests for the same Action and proves exactly one owner; exact replay returns only that requester's original receipt.
      - ENTRY — Tests cover interruption and restart without ownership transfer from silence, stable claim-generation fencing, and truthful refusal when a native runtime is not supervisable.
      - Existing questions remain read-only; go reports Action, owner, execution route, gates and receipt without silently activating production or widening scope. Record source versus installed-host proof separately; use fixtures until separately authorized live proof.
      - Implement the proof in tests/unified-session-entry.test.ts using the existing host enrollment/admission path with fake process/provider effects and disposable fixtures; pnpm exec vitest run tests/unified-session-entry.test.ts passes, with pnpm lint and pnpm exec tsc --noEmit passing. No live provider launch, native adoption, production activation or concurrency increase is performed.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1733"]
  - id: preview-safe-concurrent-action-selection
    title: Implement a read-only preview selecting additional dependency-ready, authorized Actions in existing priority order with conservative conflict explanations.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a read-only preview selecting additional dependency-ready, authorized Actions in existing priority order with conservative conflict explanations.
    expected_artifact: Evidence satisfying Agent Ask preview-safe-concurrent-action-selection
    clarification: clarified
    confidence: high
    source: Agent Ask unified-coordination-concurrency-followup-20261024-v2
    acceptance_criteria:
      - SELECT — Tests show a claimed current Action does not move the primary pointer; additional candidates are selected only from existing named readiness and approved scope in existing priority order.
      - SELECT — The preview distinguishes same-Action read-only consultation, single-writer implementation help and separate Action admission; unknown conflict scope remains exclusive.
      - Rowan is accountable for actively identifying safe parallel opportunities and coordinating eligible work; host controls enforce admission. Divide-and-conquer planning guidance requires session-sized observable Actions, real dependencies and shared-resource/write boundaries; preview creates no claim, admission or new queue.
    depends_on: [prove-shared-enrollment-at-concurrency-one]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1728"]
  - id: prove-atomic-scoped-concurrent-admission
    title: Prove atomic scoped admission for two independent Actions using existing claims, reservations and concurrency gates in disposable fixtures.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove atomic scoped admission for two independent Actions using existing claims, reservations and concurrency gates in disposable fixtures.
    expected_artifact: Evidence satisfying Agent Ask prove-atomic-scoped-concurrent-admission
    clarification: clarified
    confidence: high
    source: Agent Ask unified-coordination-concurrency-followup-20261024-v2
    acceptance_criteria:
      - ADMIT — Tests admit two authorized disjoint Actions in isolated candidates within existing limits; competing requests for the same Action produce exactly one development owner.
      - ADMIT — Tests reject same-file, shared-service/schema/generated-output and unknown-scope conflicts; stale scope revisions or policy epochs cannot commit an admission.
      - Replace repository-wide exclusion only behind a separately approved conflict/concurrency policy and completed existing proof gates; preserve fail-closed production behavior before that approval. Record the required Decision and no live activation.
    depends_on: [preview-safe-concurrent-action-selection]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1728"]
  - id: prove-safe-concurrent-settlement-and-integration
    title: Prove concurrent Action completions serialize governed settlement and base integration without lost updates or stale acceptance.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove concurrent Action completions serialize governed settlement and base integration without lost updates or stale acceptance.
    expected_artifact: Evidence satisfying Agent Ask prove-safe-concurrent-settlement-and-integration
    clarification: clarified
    confidence: high
    source: Agent Ask unified-coordination-concurrency-followup-20261024-v2
    acceptance_criteria:
      - SETTLE — Interleaved completion tests preserve both Actions and evidence, refuse stale generation/revision writes, and keep one primary current_action with no competing Plan pointer.
      - SETTLE — Base integration is serialized; landing one candidate requires applicable revalidation of the other and independent review remains bound to its current head.
      - Interrupted settlement/integration retries preserve receipts and recover without duplicate writes, dropped follow-up Actions or borrowed ownership; prove in fixtures before separately authorized live concurrency.
    depends_on: [prove-atomic-scoped-concurrent-admission]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1728"]
  - id: prove-one-supported-native-supervision-adapter
    title: Prove one host-observable native runtime adapter through the existing supervision contract, preserving the managed-worker fallback.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove one host-observable native runtime adapter through the existing supervision contract, preserving the managed-worker fallback.
    expected_artifact: Evidence satisfying Agent Ask prove-one-supported-native-supervision-adapter
    clarification: clarified
    confidence: high
    source: Agent Ask unified-coordination-concurrency-followup-20261024-v2
    acceptance_criteria:
      - NATIVE — Select one actually available runtime and prove stable Session identity, observed model/effort or explicit unavailable evidence, liveness, terminal outcome and recovery through the existing adapter interface.
      - NATIVE — Tests cover app closure, host restart, duplicate attachment and unsupported runtime refusal without fabricating a managed Session or transferring custody.
      - Keep identities and consultation semantics equal across native and managed routes; Antigravity and other unproved runtimes remain unsupported. Cross-project rollout is deferred until the operator requests it after this repository's contract and provider proof are accepted.
    depends_on: [prove-shared-enrollment-at-concurrency-one]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1728"]
questions: []
decisions: []
recommended_model: standard
recommended_reasoning_effort: medium
---

# Unify interactive and unattended coordination with safe concurrent Actions

Created as an inactive draft from accepted Agent Ask unified-coordination-concurrency-followup-20261024-v2; creation changed no pointer. Current activation is recorded in frontmatter.

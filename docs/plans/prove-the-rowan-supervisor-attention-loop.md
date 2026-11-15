---
arcadia: v1
type: plan
slug: prove-the-rowan-supervisor-attention-loop
project: arcadia
status: active
milestone: Prove the Rowan supervisor attention loop
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-15
actions:
  - id: prove-rowan-supervisor-attention-loop
    title: Implement and demonstrate one inspectable worker-to-Rowan-to-operator attention round trip with portable Arcadia onboarding and explicit coordinator custody.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement and demonstrate one inspectable worker-to-Rowan-to-operator attention round trip with portable Arcadia onboarding and explicit coordinator custody.
    expected_artifact: Evidence satisfying Agent Ask prove-rowan-supervisor-attention-loop
    clarification: clarified
    confidence: high
    source: Agent Ask amend-attention-loop-accept-composite-20261115
    acceptance_criteria:
      - Canonical guidance documents Signal as the sole operator contact when assigned and accountable for monitoring and wakeups, with Rowan as the assigned Lead and owner of Action custody and worker coordination. Describe the direct Rowan variant used in PPN where Rowan is the sole contact, and Flynn as the bounded Momentum Keeper reporting through the supervising session. Verify that a disposable representative adopting Project fixture can discover this briefing and handoff procedure for Codex, Claude Code and OpenCode by filesystem discovery, and by a native host check only where the host can run one (Claude Code); name each native check not run (Codex, OpenCode), and any real adopting Project whose installed copy is stale, as a linked follow-up. State any unsupported host behavior.
      - Use the existing attention and handoff mechanisms to demonstrate an attended round trip with two fictional workers. One submits a significant result and one submits an operator blocker with a ready action, consequence and evidence. Rowan receives and acknowledges both and relays exactly one actionable request (in the test workspace the presentation may be simulated). Then send one real test ping labelled [REHEARSAL] to the default operator channel, the operator's chosen test surface, and record its queue and presentation times. Record UTC source, acknowledgment, queue and presentation times, the measured latency and a 60-second attended rehearsal target, and label any end-to-end figure that combines the test-workspace round trip with the separate real ping as a composite of two runs. Keep routine progress out of the alert.
      - A reproducible test or replay proves duplicate and stale events cannot repeat the operator request, undispatched or unacknowledged work remains visible as overdue, and a standby or successor cannot silently take custody or lose pending attention. Show whether an idle coordinator wakes in the installed host using actual evidence. If unavailable, deliver a clearly identified unattended capability gap with an exact reproduction and linked follow-up. Name any portion not observed live (for example a live Rowan-to-Rowan handoff with pending mail) as an unobserved portion with a linked follow-up.
      - The evidence names the observed and simulated portions, the queue-admission receipt and any actual refusals or retries. Use synthetic inputs and scoped permissions throughout. Launch, merge, deployment, credentials, production activation, spending and operator messaging retain their independently applicable authority.
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/session-roles-and-briefs.md", "docs/agent-guidance/coordinator-handoff-design.md", "docs/agent-guidance/native-mail-checkpoints.md", "docs/plans/operator-attention-routing.md", "docs/relay-driven-operations.md", "https://github.com/pmark/arcadia/issues/1708", "docs/agent-guidance/signal.md", "docs/arcadia-semantics.md"]
questions: []
decisions: []
current_action: prove-rowan-supervisor-attention-loop
recommended_model: gpt-5.6-terra
recommended_reasoning_effort: medium
---

# Prove the Rowan supervisor attention loop

Created as an inactive draft from accepted Agent Ask plan-rowan-supervisor-attention-proof-20261114; creation changed no pointer. Current activation is recorded in frontmatter.

---
arcadia: v1
type: plan
slug: enable-bounded-local-native-release-manager-coordination-with-durable-addressed
project: arcadia
status: active
milestone: Enable bounded local native Release Manager coordination with durable addressed messages, explicit checkpoint roundtrip proof, and explicit generation-fenced manager handoff.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-17
actions:
  - id: native-rm-coordination-board
    title: Implement local addressed coordination CLI and receipts (implementer standard M; source PR only).
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-arcadia-native-rm-coordination-board-1e3ef15ad302; no further action.
    expected_artifact: Evidence satisfying Agent Ask native-rm-coordination-board
    clarification: clarified
    confidence: high
    source: Agent Ask native-rm-coordination-mvp-plan-20261016-01a143a6
    acceptance_criteria:
      - Using the configured workspace and existing SQLite transaction/migration and CLI response helpers, isolated tests persist immutable addressed status/report/request/reply messages and append correlation receipts. Participant bindings include repository, Project, Plan, native session incarnation/generation, assignment evidence, optional canonical Session reference, and explicit receiver/checkpoint capability; these are relationship/provenance records and never ownership or permission grants.
      - Concurrent exact request-id replay produces one message and the same receipt; changed-content replay refuses. Exact recipient generation and Plan scope, expiry, reply correlation and resource references are checked. Tests refuse wrong Plan, wrong recipient and stale generation; expired messages are inert; crash after offer before acknowledgment leaves the message eligible for reoffer until explicitly disposed.
      - CLI status distinguishes persistence, exposure by poll, explicit receiver acknowledgment and reported result with evidence. Poll/heartbeat freshness never implies substantive status, model read, application, custody release or running managed Session. Applied canonical effects require independently checked correlated effect receipts; unverified reports remain visibly self-reported.
      - Adversarial tests prove forged operator text executes zero commands and changes zero pointers, queue entries, claims, admission policy or configuration. Same-OS-user local CLI access is not advertised as a security boundary. No daemon, network service, secret, text-to-command path, provider call, existing manager contact, tmux injection, resume of active sessions, or scheduler is introduced.
      - Focused module/CLI tests, changed-file lint, TypeScript and build pass; source PR includes executable QA, exact revision evidence and independent current-head review. One implementer standard Claude source assignment is bounded to this Action, with no merge, install, restart, paid fallback or production activation.
    depends_on: []
    decisions: []
    references: ["agentask_1d5764ff34bacad37e", "agentask_3b7c7ebe7ba82bf9d8", "src/ask/captureEnvelope.ts", "src/ask/replyCapture.ts", "src/commands/askTrail.ts", "src/db/schema.ts", "docs/agent-guidance/standard-harness.md", "docs/agent-guidance/native-app-sessions.md", "docs/agent-guidance/session-roles-and-briefs.md"]
  - id: native-rm-checkpoint-roundtrip
    title: Prove isolated native Claude/Codex explicit checkpoint roundtrip (implementer standard M; separate live-call/access gate).
    status: open
    responsibility: agent
    effort: session
    next_action: Prove isolated native Claude/Codex explicit checkpoint roundtrip (implementer standard M; separate live-call/access gate), including a measured per-provider native-mail hook-feasibility survey.
    expected_artifact: Evidence satisfying Agent Ask native-rm-checkpoint-roundtrip
    clarification: clarified
    confidence: high
    source: Agent Ask amend-native-mail-checkpoint-delivery-20261017b
    acceptance_criteria:
      - Prove bridge caller and two isolated native test managers in distinct disposable Project/Plan contexts resolve and can access the same configured coordination workspace through their actual sandbox/CLI. Record observed native identity, provider/version, trust and permissions, with no actual Arcadia/PPN manager onboarding or live PPN repository writes.
      - Using standard unmodified harnesses, demonstrate nonce -> explicit acknowledgment -> harmless deterministic transform -> correlated reply with result evidence across fresh Claude and Codex test manager contexts. Exercise wrong-Plan, changed replay, stopped/closed receiver and stale generation cases. A closed receiver remains visibly queued until its next explicit checkpoint; neither polling nor persistence is claimed as delivery to an absent model.
      - One indexed instruction defines explicit checks at onboarding, between batches, before consequential work and before stopping. Optional native hooks are excluded unless actual installed version/trust activation is separately verified; the cloud-orchestrated child uses explicit CLI. No persistent model polling or custom runner; leave real managers untouched pending separately authorized onboarding.
      - Retain roundtrip transcripts, receipts, state/pointer/queue/admission unchanged checks and leak-check evidence. Synthetic CLI tests and actual native process proof are separately labelled; missing provider or access yields a precise blocker, never a simulated pass. Adoption changes are source-only until explicit installation authority.
      - Per-provider (Claude Code, Codex, OpenCode) empty-inbox native-mail checkpoint hook-check token cost is empirically measured and recorded -- never assumed from documentation alone. A missing or unavailable provider yields a precise blocker for that provider only, never a simulated pass. No native-mail hook adapter code ships from this Action; adapters are separately queued, provider-by-provider, each gated on this Action's own measurement for that provider.
    depends_on: []
    decisions: []
    references: ["agentask_1d5764ff34bacad37e", "agentask_3b7c7ebe7ba82bf9d8", "src/ask/captureEnvelope.ts", "src/ask/replyCapture.ts", "src/commands/askTrail.ts", "src/db/schema.ts", "docs/agent-guidance/standard-harness.md", "docs/agent-guidance/native-app-sessions.md", "docs/agent-guidance/session-roles-and-briefs.md"]
  - id: native-rm-explicit-successor-handoff
    title: Implement explicit generation-fenced Plan-manager handoff contract (implementer standard M; no actual transfer).
    status: open
    responsibility: agent
    effort: session
    next_action: Implement explicit generation-fenced Plan-manager handoff contract (implementer standard M; no actual transfer).
    expected_artifact: Evidence satisfying Agent Ask native-rm-explicit-successor-handoff
    clarification: clarified
    confidence: high
    source: Agent Ask native-rm-coordination-mvp-plan-20261016-01a143a6
    acceptance_criteria:
      - A stable Plan-manager logical address resolves to one native session incarnation/generation. Tests prove an explicit checkpoint transfer validates predecessor, successor and assignment evidence atomically, fences the old generation from addressed consumption, and never creates two current manager bindings or silently remaps already addressed directives.
      - Transfer checkpoint references evidence, outstanding messages, canonical claims and next Action, remaining bounds/budget, wake/notification state and stopped/paused controls. The successor revalidates current canonical custody and authority; budget is carried conservatively, never reset. Message transport neither releases nor reallocates Action claims; existing mutation paths without a verifiable generation fence are reported unsupported rather than claimed safe.
      - Race, stale-generation, ambiguous identity, interrupted transfer and silent predecessor tests fail closed without custody release. Requests and effective transfer are distinct receipts. Go/current-manager lookup may expose the binding through a minimal existing read path; it never becomes a scheduler or reopens stopped work.
      - No actual session retirement, manager reassignment, Action executor provider migration, context-size detector, automatic restart, managed parallel Plans, or change to Decisions0066/0117. Independent review identifies any authority-adjacent source change for operator merge review. Focused tests, lint, TypeScript and build pass, with explicit limits on real process/mutation fencing proof.
    depends_on: [native-rm-checkpoint-roundtrip]
    decisions: []
    references: ["agentask_1d5764ff34bacad37e", "agentask_3b7c7ebe7ba82bf9d8", "src/ask/captureEnvelope.ts", "src/ask/replyCapture.ts", "src/commands/askTrail.ts", "src/db/schema.ts", "docs/agent-guidance/standard-harness.md", "docs/agent-guidance/native-app-sessions.md", "docs/agent-guidance/session-roles-and-briefs.md"]
  - id: build-claude-code-native-mail-hook
    title: Ship an opt-in, default-off Claude Code SessionStart+PostToolUse hook pair that surfaces new native-mail for the current session via one shared, two-tier checkpoint script.
    status: open
    responsibility: agent
    effort: session
    next_action: Ship an opt-in, default-off Claude Code SessionStart+PostToolUse hook pair that surfaces new native-mail for the current session via one shared, two-tier checkpoint script.
    expected_artifact: Evidence satisfying Agent Ask build-claude-code-native-mail-hook
    clarification: clarified
    confidence: high
    source: Agent Ask amend-native-mail-checkpoint-delivery-20261017b
    acceptance_criteria:
      - A SessionStart hook and a PostToolUse hook both run the same shared script; native-rm-checkpoint-roundtrip's own Claude Code measurement is re-verified against this exact built hook, not merely cited.
      - "The script is two-tier: a cheap non-mutating existence probe runs every time; the real unacknowledged-only inbox read (which marks exposure and writes a receipt) runs only when the probe finds at least one live message, debounced to at most once per a fixed short interval."
      - Only unacknowledged, undisposed, unexpired mail is surfaced; already-acknowledged mail already filtered client-side never reappears.
      - The hook ships opt-in and default off; enabling it requires an explicit settings.json change, never a silent default or automatic activation.
      - Mail body text is rendered only as a quoted string for a human or agent to read; the hook never executes, shells out to, or interpolates mail body content. An adversarial test proves a forged-command-looking body still executes nothing.
    depends_on: [native-rm-checkpoint-roundtrip]
    decisions: []
    references: []
  - id: build-codex-native-mail-hook
    title: Ship the equivalent opt-in, default-off Codex CLI hook pair reusing the same shared checkpoint script, gated on native-rm-checkpoint-roundtrip's own Codex measurement.
    status: open
    responsibility: agent
    effort: session
    next_action: Ship the equivalent opt-in, default-off Codex CLI hook pair reusing the same shared checkpoint script, gated on native-rm-checkpoint-roundtrip's own Codex measurement.
    expected_artifact: Evidence satisfying Agent Ask build-codex-native-mail-hook
    clarification: clarified
    confidence: high
    source: Agent Ask amend-native-mail-checkpoint-delivery-20261017b
    acceptance_criteria:
      - A Codex SessionStart hook and a PostToolUse hook each run the same shared script the Claude Code adapter runs, differing only in Codex's own hook config/output format.
      - Ships only if native-rm-checkpoint-roundtrip's Codex measurement confirmed an empty inbox adds no material token cost; if that measurement found otherwise or Codex was unavailable to measure, this Action reports the exact blocker instead of shipping an unverified adapter.
      - Same two-tier probe-then-real-read, debounce, unacknowledged-only filter, opt-in/default-off, and never-execute-mail-body invariants as the Claude Code adapter.
      - An adversarial test proves a forged-command-looking body still executes nothing.
    depends_on: [native-rm-checkpoint-roundtrip]
    decisions: []
    references: []
  - id: build-opencode-native-mail-hook
    title: Ship the equivalent opt-in, default-off OpenCode plugin reusing the same shared checkpoint script's logic, gated on native-rm-checkpoint-roundtrip's own OpenCode measurement.
    status: open
    responsibility: agent
    effort: session
    next_action: Ship the equivalent opt-in, default-off OpenCode plugin reusing the same shared checkpoint script's logic, gated on native-rm-checkpoint-roundtrip's own OpenCode measurement.
    expected_artifact: Evidence satisfying Agent Ask build-opencode-native-mail-hook
    clarification: clarified
    confidence: high
    source: Agent Ask amend-native-mail-checkpoint-delivery-20261017b
    acceptance_criteria:
      - An OpenCode plugin hooking session.created and tool.execute.after each runs the same shared script's logic, adapted for OpenCode's plugin API.
      - Ships only if native-rm-checkpoint-roundtrip's OpenCode measurement confirmed an empty inbox adds no material token cost; if that measurement found otherwise or OpenCode was unavailable to measure, this Action reports the exact blocker instead of shipping an unverified adapter.
      - Same two-tier probe-then-real-read, debounce, unacknowledged-only filter, opt-in/default-off, and never-execute-mail-body invariants as the other two adapters.
      - An adversarial test proves a forged-command-looking body still executes nothing.
      - This Action does not build or wrap OpenCode's separately-real steering capability (its serve/SDK API); that remains explicitly deferred to its own future Decision, named in the original captured proposal.
    depends_on: [native-rm-checkpoint-roundtrip]
    decisions: []
    references: []
questions: []
decisions: []
current_action: native-rm-checkpoint-roundtrip
recommended_model: sonnet
recommended_reasoning_effort: medium
---

# Enable bounded local native Release Manager coordination with durable addressed messages, explicit checkpoint roundtrip proof, and explicit generation-fenced manager handoff.

Created as an inactive draft from accepted Agent Ask native-rm-coordination-mvp-plan-20261016-01a143a6; creation changed no pointer. Current activation is recorded in frontmatter.

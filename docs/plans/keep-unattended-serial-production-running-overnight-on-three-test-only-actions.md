---
arcadia: v1
type: plan
slug: keep-unattended-serial-production-running-overnight-on-three-test-only-actions
project: arcadia
status: active
milestone: Keep unattended serial production running overnight on three test-only Actions that pin untested behaviour.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-06
actions:
  - id: pin-guidance-project-budget-exceeded
    title: "Pin that the guidance audit reports Project instructions exceeding their 24 KiB budget, with a test covering the case named in Issue #1886."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin that the guidance audit reports Project instructions exceeding their 24 KiB budget, with a test covering the case named in Issue #1886."
    expected_artifact: Evidence satisfying Agent Ask pin-guidance-project-budget-exceeded
    clarification: clarified
    confidence: high
    source: Agent Ask amend-overnight-plan-execution-build-20261106b
    why: "No test asserts the Project instructions budget message, so deleting that check in inspectGuidanceDelivery passes every test today."
    acceptance_criteria:
      - tests/agent-guidance.test.ts gains a test that adopts a repository, adds a nested AGENTS.md of about 20 KiB, audits with that nested directory as cwd and empty global guidance, and asserts problems contain Project instructions exceed.
      - The same test asserts the problems do not contain Combined guidance exceeds or Root instructions exceed, and that auditing from the repository root reports none of the three.
      - Every other test in that file passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only tests/agent-guidance.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1886"]
  - id: pin-guidance-blank-override-falls-through
    title: "Pin that a whitespace-only AGENTS.override.md is skipped and the guidance audit reads AGENTS.md instead, with a test covering the edge case named in Issue #1886."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin that a whitespace-only AGENTS.override.md is skipped and the guidance audit reads AGENTS.md instead, with a test covering the edge case named in Issue #1886."
    expected_artifact: Evidence satisfying Agent Ask pin-guidance-blank-override-falls-through
    clarification: clarified
    confidence: high
    source: Agent Ask amend-overnight-plan-execution-build-20261106b
    why: "The audit's fall-through for a blank override is untested, so changing first() to select by existence would mislabel the bootstrap and pass every test."
    acceptance_criteria:
      - tests/agent-guidance.test.ts gains a test that adopts a repository, writes an AGENTS.override.md containing only whitespace, and asserts the audit's last source path is AGENTS.md, not AGENTS.override.md.
      - The same test asserts the audit reports no problems.
      - Every other test in that file passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only tests/agent-guidance.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: [pin-guidance-project-budget-exceeded]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1886"]
  - id: pin-safety-lines-order-and-limit
    title: "Pin how the work monitor's attention lines order, filter and cut working copies with a test on a hand-built snapshot, recording today's behaviour named in Issue #2011."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin how the work monitor's attention lines order, filter and cut working copies with a test on a hand-built snapshot, recording today's behaviour named in Issue #2011."
    expected_artifact: Evidence satisfying Agent Ask pin-safety-lines-order-and-limit
    clarification: clarified
    confidence: high
    source: Agent Ask amend-overnight-plan-execution-build-20261106b
    why: "Only the first line of a real scan is asserted today, so the risk order, the landed and in-PR filter and the limit cut can change unnoticed."
    acceptance_criteria:
      - tests/work-monitor.test.ts gains a test in which formatWorkingCopySafetyLines receives a snapshot of hand-built working copies in the unsaved, local_only, pushed, in_pr and landed states across two Projects, and returns unsaved lines before local_only before pushed, with ties ordered by Project name.
      - The same test asserts that landed copies and in_pr copies whose delivery is not blocked produce no line, that a repository error line comes first, and that a limit of 2 returns exactly two lines.
      - Every other test in that file passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only tests/work-monitor.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2011"]
questions: []
decisions: []
current_action: pin-guidance-project-budget-exceeded
recommended_model: standard
recommended_reasoning_effort: medium
---

# Keep unattended serial production running overnight on three test-only Actions that pin untested behaviour.

Created as an inactive draft from accepted Agent Ask plan-overnight-test-only-serial-20261106; creation changed no pointer. Current activation is recorded in frontmatter.

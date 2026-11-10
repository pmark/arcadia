---
arcadia: v1
type: plan
slug: carry-out-decision-0214-answer-a-unattended-production-s-worker-may-merge-src
project: arcadia
status: draft
milestone: "Carry out Decision 0214 answer A: unattended production's worker may merge src/** candidate changes that touch no authority boundary, after an audit proves the authority classifier covers every gate-enforcing source module."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-10
actions:
  - id: implement-a-classifier-coverage-audit
    title: "Implement a classifier-coverage audit: a test that enumerates every src module defining or enforcing an approval, spend, review or merge gate and asserts classifyAuthorityPaths classifies it, extending the classifier for any module it misses."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Implement a classifier-coverage audit: a test that enumerates every src module defining or enforcing an approval, spend, review or merge gate and asserts classifyAuthorityPaths classifies it, extending the classifier for any module it misses."
    expected_artifact: Evidence satisfying Agent Ask implement-a-classifier-coverage-audit
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-0214a-worker-src-merge-20261110
    why: "Option A makes the path classifier the only source guard, so a gate-enforcing module outside it would merge unattended."
    acceptance_criteria:
      - tests/authority-classifier-coverage.test.ts exists and asserts classifyAuthorityPaths returns at least one boundary for each listed gate-enforcing src module, including src/intelligence/config/defaults.ts, src/execution/ and src/qa/ modules that enforce review proof.
      - Every module the audit lists is classified on the PR head, and the PR body names each module added to the classifier and why.
    depends_on: []
    decisions: []
    references: []
  - id: implement-decision-0214-a-in-src
    title: "Implement Decision 0214 A in src/production/workerMerge.ts: isWorkerMergeSafePath accepts a src/** path that classifyAuthorityPaths does not classify, keeping every existing proof gate."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Implement Decision 0214 A in src/production/workerMerge.ts: isWorkerMergeSafePath accepts a src/** path that classifyAuthorityPaths does not classify, keeping every existing proof gate."
    expected_artifact: Evidence satisfying Agent Ask implement-decision-0214-a-in-src
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-0214a-worker-src-merge-20261110
    why: "This is the merge route the operator chose, so ordinary code Actions can merge unattended."
    acceptance_criteria:
      - A test shows an unclassified src/** path is worker-merge-safe and a classified src path is still refused as authority_adjacent.
      - "Tests show the existing gates are unchanged: exact-head review and QA, green required checks, CLEAN merge state and the mergeThroughPullRequest grant still each refuse when missing."
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
---

# Carry out Decision 0214 answer A: unattended production's worker may merge src/** candidate changes that touch no authority boundary, after an audit proves the authority classifier covers every gate-enforcing source module.

Created as an inactive draft from accepted Agent Ask plan-decision-0214a-worker-src-merge-20261110; creation changed no pointer. Current activation is recorded in frontmatter.

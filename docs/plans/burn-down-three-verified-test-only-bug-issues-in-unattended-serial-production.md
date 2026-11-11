---
arcadia: v1
type: plan
slug: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
project: arcadia
status: draft
milestone: Burn down three verified test-only bug Issues in unattended serial production.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-11
actions:
  - id: write-tmux-long-command-argv-atomically
    title: "Make the fake provider scripts in tests/system-tmux-long-command.test.ts write their argv JSON atomically, so the polling reader never parses a partly written file, fixing Issue #2314."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the fake provider scripts in tests/system-tmux-long-command.test.ts write their argv JSON atomically, so the polling reader never parses a partly written file, fixing Issue #2314."
    expected_artifact: Evidence satisfying Agent Ask write-tmux-long-command-argv-atomically
    clarification: clarified
    confidence: high
    source: Agent Ask plan-test-flake-burn-down-20261111
    why: "Both fake providers writeFileSync the 64 KiB argv file straight to the path the test polls, so a load-slowed write is read half-written and the test flakes."
    acceptance_criteria:
      - In tests/system-tmux-long-command.test.ts, both fake provider scripts write the argv JSON to a temporary sibling path and then renameSync it to the path the test polls, and no fake provider writes that polled path directly.
      - The test's exact 64 KiB argument-length assertion is kept unchanged, and every test in tests/system-tmux-long-command.test.ts passes.
      - Apart from the settlement records Arcadia writes, the change touches only tests/system-tmux-long-command.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2314"]
  - id: strip-claude-login-tokens-from-logged-out-fixtures
    title: "Make the logged-out Claude cases in tests/headless-provider-operator-script.test.ts ignore login tokens inherited from the parent environment, fixing Issue #1327."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the logged-out Claude cases in tests/headless-provider-operator-script.test.ts ignore login tokens inherited from the parent environment, fixing Issue #1327."
    expected_artifact: Evidence satisfying Agent Ask strip-claude-login-tokens-from-logged-out-fixtures
    clarification: clarified
    confidence: high
    source: Agent Ask plan-test-flake-burn-down-20261111
    why: "Helpers spread process.env into the logged-out fixtures, so a CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY on the test host makes Claude look signed in and the logged-out cases fail."
    acceptance_criteria:
      - In tests/headless-provider-operator-script.test.ts, every logged-out Claude case runs with an environment that omits CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY even when the parent process has them set.
      - A regression test in tests/headless-provider-operator-script.test.ts sets CLAUDE_CODE_OAUTH_TOKEN in the parent environment and asserts the logged-out case still skips or refuses Claude; it fails before the fix and passes after, and restores the parent environment afterwards.
      - Every other test in tests/headless-provider-operator-script.test.ts passes unchanged, and apart from the settlement records Arcadia writes, the change touches only tests/headless-provider-operator-script.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1327"]
  - id: pick-dashboard-live-smoke-port-from-the-os
    title: "Make tests/dashboard-live.test.ts use a port the operating system reported free instead of a random one, so its smoke server no longer collides with EADDRINUSE, fixing Issue #2504."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make tests/dashboard-live.test.ts use a port the operating system reported free instead of a random one, so its smoke server no longer collides with EADDRINUSE, fixing Issue #2504."
    expected_artifact: Evidence satisfying Agent Ask pick-dashboard-live-smoke-port-from-the-os
    clarification: clarified
    confidence: high
    source: Agent Ask amend-dashboard-live-port-retry-20261111
    why: "The smoke port is 40000 plus a random offset, so another test in the same CI shard can hold it and the file fails with EADDRINUSE about once a morning."
    acceptance_criteria:
      - tests/dashboard-live.test.ts no longer computes its smoke port from Math.random; it obtains each port by listening on port 0, reading the assigned port and closing that listener before passing the port to the dashboard script and stand-in server.
      - In every test except the collision cases that deliberately reuse an occupied port, a bind that fails with EADDRINUSE obtains a fresh OS-assigned port and retries, at most three attempts in all, before the test fails; the deliberate collision cases still use the occupied port unchanged.
      - Every test in tests/dashboard-live.test.ts passes, including those collision cases.
      - Apart from the settlement records Arcadia writes, the change touches only tests/dashboard-live.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2504"]
questions: []
decisions: []
---

# Burn down three verified test-only bug Issues in unattended serial production.

Created as an inactive draft from accepted Agent Ask plan-test-flake-burn-down-20261111; creation changed no pointer. Current activation is recorded in frontmatter.

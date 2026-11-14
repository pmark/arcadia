---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-10-plan-of-three-verified-small-reliability-fixes-with
project: arcadia
status: draft
milestone: Draft an inactive batch 10 Plan of three verified small reliability fixes with failing-first tests (service restart main-checkout guard, Tailnet press-path probe, tidy test determinism)
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-14
actions:
  - id: refuse-service-restart-from-linked-worktree
    title: Make scripts/services.sh refuse restart and stop from a linked git worktree, so a non-main checkout cannot replace the live launchd label set.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make scripts/services.sh refuse restart and stop from a linked git worktree, so a non-main checkout cannot replace the live launchd label set.
    expected_artifact: Evidence satisfying Agent Ask refuse-service-restart-from-linked-worktree
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-10-20261114
    why: "Authority path (scripts/*.sh executor). services.sh derives REPO from its own location and the impl hashes that path into com.arcadia.local.<cksum>.* labels, so a worktree run swaps the live jobs (Issue 2632)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: scripts/services.sh line 18 sets REPO from its own directory with no git-worktree check before restart or stop (lines 25 to 62 guard only experiment workspaces and Darwin); scripts/restart-services-impl.sh line 236 computes REPO_KEY as cksum of REPO and line 262 builds com.arcadia.local.<REPO_KEY>.<service>, so any checkout path gets its own label set and restart unloads the live one; scripts/release.sh never installs or loads a LaunchAgent (its header and install-plan only print), so it needs no change."
      - A failing-first test in tests/services-script.test.ts (or a new tests/services-main-checkout-guard.test.ts) builds a temp git repo with a linked worktree via git worktree add, copies scripts/services.sh and scripts/lib into both, puts a fake launchctl and a fake pnpm that append their argv to a calls file first on PATH, sets ARCADIA_RESTART_SCRIPT to a stub implementation, and shows that before the change restart from the worktree copy reaches the stub; after the change it exits 3 with a message naming the worktree and the main checkout, never calls the stub or launchctl, and the same run from the main copy still reaches the stub.
      - The guard lives in scripts/services.sh (optionally a new scripts/lib/main-checkout-guard.sh), applies only to restart and stop, never to status, decides a linked worktree by git rev-parse --git-dir differing from --git-common-dir, proceeds with a warning when git cannot decide, and accepts an explicit ARCADIA_ALLOW_NONMAIN_CHECKOUT=<reason> override that prints the reason; the existing tests in tests/services-script.test.ts that run the real services.sh restart set that override so they still pass inside a worktree.
      - scripts/restart-services-impl.sh is not edited, so ARCADIA_RESTART_IMPL_SHA256 pins and PR 2627 are untouched; the Session states in the PR description that the guard sits in the adapter for that reason, and names the follow-ups left open on Issue 2632 (an operator/host cleanup of the orphaned com.arcadia.local.1299658567 launchd jobs, reporting a stale label set that exits non-zero in liveness or status, and a documented orphan cleanup).
      - pnpm vitest run tests/services-script.test.ts --testTimeout 150000 passes (plus the new test file if one is added), and only scripts/services.sh, scripts/lib/main-checkout-guard.sh and the test files change; the Session records the authority-path edit (scripts/*.sh executor) in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2632", "https://github.com/pmark/arcadia/pull/2627", "scripts/services.sh", "scripts/restart-services-impl.sh", "tests/services-script.test.ts"]
  - id: probe-tailnet-press-path-read-only
    title: Add a read-only press-path probe that reaches the real Host/Origin check through the Tailnet URL and reports accept or refuse without pressing anything.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Add a read-only press-path probe that reaches the real Host/Origin check through the Tailnet URL and reports accept or refuse without pressing anything.
    expected_artifact: Evidence satisfying Agent Ask probe-tailnet-press-path-read-only
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-10-20261114
    why: "Authority path (apps/*, src/operatorActions). Preflight never exercises the operator's Tailnet press path, so nothing proves tailscale serve preserves Host so isOperatorBrowserPress accepts a press (Issue 2633, Decision 0173)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: apps/dashboard/app/api/operator-script/route.ts line 283 calls isOperatorBrowserPress (src/operatorActions/startRunDayGrant.ts line 242, accepts only when Origin and Host are both present, agree and are non-loopback) only after loadDescriptor succeeds for a real day-grant card, so no POST can reach that check without launching the card; the route's GET (line 245 area) never evaluates Origin or Host; scripts/start-run.sh preflight (P0 to P2) makes no HTTP request to the dashboard; and the executor is hash-pinned by each descriptor (executorSha256), so the probe must not be added to start-run.sh."
      - "A failing-first test in a new apps/dashboard/app/api/operator-script/press-path/route.test.ts calls the new GET with Origin http://arcadia-1.example.ts.net:3020 and Host arcadia-1.example.ts.net:3020 and expects accepted true; with Host 127.0.0.1:3020 (a serve that rewrote Host) expects accepted false and reason naming the loopback host; with no Origin expects accepted false; and shows the handler starts no process and writes no file; the test fails before the route exists."
      - A failing-first test in a new tests/press-path-probe.test.ts injects a fake fetch into a pure probePressPath({ url, fetch }) in a new src/operatorActions/pressPathProbe.ts, which sends one GET with Origin set to the URL's own origin and reports accept, refuse (with the host the server saw) or unreachable, never sends a POST, and never throws on a network error; a thin scripts/press-path-probe.sh runs it with pnpm -s tsx and prints one line plus a non-zero exit on refuse.
      - The new GET route reuses isOperatorBrowserPress unchanged and changes no existing route behaviour; the POST handler, start-run.sh and every descriptor pin are not edited, and wiring the probe into a START card's preflight is left as a follow-up needing a new reviewed executor pin.
      - pnpm vitest run apps/dashboard/app/api/operator-script/press-path/route.test.ts tests/press-path-probe.test.ts apps/dashboard/app/api/operator-script/durable-receipt.test.ts --testTimeout 120000 passes, and only the new route, the new src/operatorActions/pressPathProbe.ts, scripts/press-path-probe.sh and the new test files change; the Session records the authority-path edit (apps/* and src/operatorActions) in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2633", "src/operatorActions/startRunDayGrant.ts", "apps/dashboard/app/api/operator-script/route.ts", "apps/dashboard/lib/originGuard.ts"]
  - id: make-tidy-detached-worktree-test-hermetic
    title: Make the tidy detached-worktree unmerged-count test deterministic by injecting the live-process scan and reporting the protecting reason on failure.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make the tidy detached-worktree unmerged-count test deterministic by injecting the live-process scan and reporting the protecting reason on failure.
    expected_artifact: Evidence satisfying Agent Ask make-tidy-detached-worktree-test-hermetic
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-10-20261114
    why: "Authority path (src/commands/*). Tidy reads a real lsof cwd scan of the host, so an unrelated live process can turn this fixture's verdict from unmerged to protected (Issue 2631)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: the test at tests/tidy-command.test.ts line 335 calls runTidyCommand({ repo: root }) with no injection; src/commands/tidy.ts line 258 reads liveProcessCwds() (src/git/worktrees.ts line 629, a real spawnSync of lsof -d cwd -Fn with a 2000 ms timeout) and assessWorktreeLiveness (line 571) returns protected at line 510 when any process cwd lies inside the worktree; a detached worktree has a null branch so the reflog grace path does not apply; the failure 'expected protected to be unmerged' therefore needs a live cwd inside the fixture, a lock or a protections row, and the log cannot say which. State plainly in the PR that this cause is inferred from code, not reproduced."
      - A failing-first test in tests/tidy-command.test.ts injects a live-cwd set containing the detached fixture path through the new option and shows the verdict is protected with reason 'A running process has this worktree (or a directory inside it) as its current directory.'; it fails before the option exists.
      - "RunTidyOptions gains an optional liveProcessCwds?: () => Set<string> | null that defaults to the real liveProcessCwds, is used at both read sites (lines 258 and 307), is not exposed by the CLI, and changes no default behaviour; the detached-worktree test and its unreadable-head neighbour pass () => new Set() and the unmerged-count assertions include entry.reason in their failure message so a future flake names its cause."
      - pnpm vitest run tests/tidy-command.test.ts --testTimeout 150000 passes, and only src/commands/tidy.ts and tests/tidy-command.test.ts change; the Session records the authority-path edit (src/commands/*) in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2631", "src/commands/tidy.ts", "src/git/worktrees.ts", "tests/tidy-command.test.ts"]
questions: []
decisions: []
---

# Draft an inactive batch 10 Plan of three verified small reliability fixes with failing-first tests (service restart main-checkout guard, Tailnet press-path probe, tidy test determinism)

Created as an inactive draft from accepted Agent Ask ellis-batch-10-20261114; creation changed no pointer. Current activation is recorded in frontmatter.

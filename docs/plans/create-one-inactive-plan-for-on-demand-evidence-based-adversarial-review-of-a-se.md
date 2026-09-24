---
arcadia: v1
type: plan
slug: create-one-inactive-plan-for-on-demand-evidence-based-adversarial-review-of-a-se
project: arcadia
status: draft
milestone: Every Arcadia coding-agent handoff gets an independent pre-PR code review from a fresh OpenCode session, falling back to the next configured provider, with findings fixed or declined within three rounds and a receipt pinned to the reviewed commit, while CodeRabbit remains the merge gate.
token_impact: medium
token_budget: Deterministic management plus six bounded coding-agent sessions after activation; each review run is one bounded reviewer call, reused only while its review packet (head, base, rubric content digest) is unchanged.
updated: 2026-09-24
actions:
  - id: define-independent-review-contract
    title: Define the read-only review request, evidence packet, verdict, finding, and recommended-next-move contract for selected Arcadia objects.
    status: open
    responsibility: agent
    effort: session
    next_action: "Define the independent review contract in code: one pinned target (local commits first), a named rubric, a read-only evidence packet, a done/fix/cap verdict with findings and exactly one recommended next move, reviewer provenance, and a receipt bound to the reviewed head and base SHAs; move arcadia qa pr's seven criteria into a pr-qa rubric under that contract without changing its behavior."
    expected_artifact: Evidence satisfying Agent Ask define-independent-review-contract
    clarification: clarified
    confidence: high
    source: Agent Ask independent-review-actions-2026-09-24
    acceptance_criteria:
      - A typed contract module with a validator defines target, rubric id, evidence packet, verdict (done, fix, or cap), findings, one recommended next move, reviewer provenance, and a receipt pinned to head and base SHAs; unit tests cover a valid receipt and each refusal.
      - "Rubrics are data selected by id: arcadia qa pr loads its seven existing criteria as the pr-qa rubric and its existing tests pass unchanged."
      - A code-review rubric exists for pre-PR review and omits the PR-only criteria (operator QA plan, PR evidence), with the reason recorded beside it.
      - The contract states that a reviewer cannot alter repository, governance, execution, or external state, and names the deferred rubric roles (performance, SEO/AEO, UX) with the trigger that adds each.
    depends_on: []
    decisions: []
    references: ["src/qa/prReview.ts", "src/commands/qa.ts"]
  - id: review-packet-for-local-commits
    title: "Add a read-only arcadia qa packet that prints the deterministic, self-contained evidence packet for the current worktree's commits against its base: repository, branch, head SHA, merge-base SHA, touched files, full patch, selected rubric, and the read-only boundary, spending no model tokens."
    status: open
    responsibility: agent
    effort: session
    next_action: "Add a read-only arcadia qa packet that prints the deterministic, self-contained evidence packet for the current worktree's commits against its base: repository, branch, head SHA, merge-base SHA, touched files, full patch, selected rubric, and the read-only boundary, spending no model tokens."
    expected_artifact: Evidence satisfying Agent Ask review-packet-for-local-commits
    clarification: clarified
    confidence: high
    source: Agent Ask independent-review-actions-2026-09-24
    acceptance_criteria:
      - arcadia qa packet --json in a clean worktree prints a packet whose head and merge-base SHAs match git rev-parse HEAD and git merge-base HEAD with the base branch.
      - Two runs on the same commits produce byte-identical output.
      - It refuses a dirty worktree or a detached HEAD with a named reason, because a review must be pinned to a commit.
      - A test proves a run leaves the repository and the workspace database unchanged.
    depends_on: [define-independent-review-contract]
    decisions: []
    references: ["src/commands/qa.ts", "src/qa/prReview.ts"]
  - id: run-opencode-as-read-only-reviewer
    title: "Let OpenCode serve as a reviewer: run it in a fresh session under a read-only permission profile with the packet and rubric, and parse its output into a validated verdict, proven by a sandbox preflight like arcadia qa pr's and refused rather than trusted when read-only cannot be proven."
    status: open
    responsibility: agent
    effort: session
    next_action: "Let OpenCode serve as a reviewer: run it in a fresh session under a read-only permission profile with the packet and rubric, and parse its output into a validated verdict, proven by a sandbox preflight like arcadia qa pr's and refused rather than trusted when read-only cannot be proven."
    expected_artifact: Evidence satisfying Agent Ask run-opencode-as-read-only-reviewer
    clarification: clarified
    confidence: high
    source: Agent Ask independent-review-actions-2026-09-24
    acceptance_criteria:
      - A preflight proves the OpenCode reviewer cannot write to the repository and records that proof in the receipt; a failed preflight refuses the reviewer with a named reason instead of running it.
      - Each review starts a new OpenCode session with no prior conversation context.
      - Reviewer output that does not validate against the verdict schema becomes an explicit reviewer-failure verdict, never a pass.
      - Tests with a stubbed OpenCode command cover a valid verdict, malformed output, and a failed preflight.
    depends_on: [define-independent-review-contract]
    decisions: []
    references: ["src/codingAgents/providerAdapters.ts", "src/codingAgents/adapters.ts", "src/qa/prReview.ts", "docs/model-selection.md"]
  - id: select-review-provider-with-fallback
    title: Select the reviewer through the provider adapters with a configured review default of OpenCode, falling back to the next available read-only-capable provider in cost order when the default is unavailable or signed out, and record which provider and model reviewed.
    status: open
    responsibility: agent
    effort: session
    next_action: Select the reviewer through the provider adapters with a configured review default of OpenCode, falling back to the next available read-only-capable provider in cost order when the default is unavailable or signed out, and record which provider and model reviewed.
    expected_artifact: Evidence satisfying Agent Ask select-review-provider-with-fallback
    clarification: clarified
    confidence: high
    source: Agent Ask independent-review-actions-2026-09-24
    acceptance_criteria:
      - With no configuration change, reviewer selection picks OpenCode when it is available.
      - When OpenCode is unavailable or signed out, selection picks the next available read-only-capable provider by costRank, and the receipt's provenance names it.
      - When no read-only-capable provider is available, selection fails with a named reason instead of silently skipping review.
      - The review default is configurable in the workspace provider-adapter configuration and documented in docs/model-selection.md.
    depends_on: [run-opencode-as-read-only-reviewer]
    decisions: []
    references: ["src/codingAgents/providerAdapters.ts", "src/codingAgents/availability.ts", "docs/model-selection.md"]
  - id: request-pre-pr-code-review
    title: Add arcadia qa code-review, which packets the current worktree's commits, runs the selected reviewer against the code-review rubric, persists a receipt pinned to the reviewed head, and returns done, fix, or cap in the same shape as arcadia pr code-review, counting fix rounds per branch.
    status: open
    responsibility: agent
    effort: session
    next_action: Add arcadia qa code-review, which packets the current worktree's commits, runs the selected reviewer against the code-review rubric, persists a receipt pinned to the reviewed packet, and returns done, fix, or cap in the same shape as arcadia pr code-review, counting fix rounds per branch.
    expected_artifact: Evidence satisfying Agent Ask request-pre-pr-code-review
    clarification: clarified
    confidence: high
    source: Agent Ask independent-review-rubric-digest-2026-09-24
    acceptance_criteria:
      - arcadia qa code-review --json returns done, fix with findings, or cap after three fix rounds on the same branch, using the verdict fields arcadia pr code-review returns.
      - Re-running reuses the persisted receipt only when head SHA, base SHA, rubric id, and rubric content digest all match the current packet; any difference runs a new review.
      - The receipt records head and base SHAs, rubric id and content digest, reviewer provider, model and session, and every finding.
      - A deterministic test drives all three verdicts end to end with a stubbed reviewer, and tests prove that neither a moved base at an unchanged head nor an edited rubric under an unchanged id reuses the receipt.
    depends_on: [review-packet-for-local-commits, select-review-provider-with-fallback]
    decisions: []
    references: ["src/stewardship/codeRabbitReview.ts", "src/commands/prCodeReview.ts", "src/commands/qa.ts"]
  - id: run-pre-pr-review-at-handoff
    title: "Make pre-PR review part of every coding-agent handoff: define the loop in the shared agent context before push, add its receipt to the PR template, document the command in START_HERE.md, and dogfood it on one real Arcadia pull request."
    status: open
    responsibility: agent
    effort: session
    next_action: "Make pre-PR review part of every coding-agent handoff: define the loop in the shared agent context before push, add its receipt to the PR template, document the command in START_HERE.md, and dogfood it on one real Arcadia pull request."
    expected_artifact: Evidence satisfying Agent Ask run-pre-pr-review-at-handoff
    clarification: clarified
    confidence: high
    source: Agent Ask independent-review-actions-2026-09-24
    acceptance_criteria:
      - docs/agents-context.md defines the pre-PR review loop (run arcadia qa code-review, fix or decline findings, stop at done or cap) before push and PR creation, and AGENTS.md carries it after pnpm arcadia project setup-context --repo . runs.
      - At cap, remaining findings are listed in the PR body and significant ones are filed as Issues; the PR still opens and CodeRabbit remains the merge gate.
      - The PR template has a pre-PR review section that links the receipt and names the reviewer provider.
      - START_HERE.md documents arcadia qa code-review.
      - One merged Arcadia pull request carries a pre-PR review receipt produced by this loop.
    depends_on: [request-pre-pr-code-review]
    decisions: []
    references: ["docs/agents-context.md", "AGENTS.md", ".github/pull_request_template.md", "START_HERE.md"]
questions: []
decisions: []
---

# Create one inactive plan for on-demand, evidence-based adversarial review of a selected PR, Action, Artifact, or plan.

Created from accepted Agent Ask independent-review-contract-plan-2026-09-05. This draft is not active and changes no pointer.

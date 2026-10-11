---
arcadia: v1
type: plan
slug: let-the-operator-change-what-production-queues-from-the-production-project
project: arcadia
status: draft
milestone: "Let the operator change what production queues from the /production Project cards: which Projects are included, their order, and each Project's Plan, as light preferences that stay flexible until a Session starts and is locked in with a receipt."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-11
actions:
  - id: record-production-project-preferences
    title: A governed preference record holds the included Projects, their order (or shares, per Decision 0115) and each Project's chosen Plan, and the operator can change it while production is on.
    status: open
    responsibility: agent
    effort: session
    next_action: A governed preference record holds the included Projects, their order (or shares, per Decision 0115) and each Project's chosen Plan, and the operator can change it while production is on.
    expected_artifact: Evidence satisfying Agent Ask record-production-project-preferences
    clarification: clarified
    confidence: high
    source: Agent Ask production-queue-controls-plan-2026-10-11
    acceptance_criteria:
      - A Decision amending 0048 and 0054 is answered by the operator before this Action starts, stating that production admission follows the Project preference record and queue positions order Actions only within a Plan.
      - A CLI command previews and applies a change to the preference record (include or exclude a Project, move it, set its Plan, and set shares if Decision 0115 chose shares), with a revision check and a receipt, and refuses a Project or Plan the production scope does not admit.
      - A change while production is on takes effect at the next admission without Off and a reviewed On, never changes a Session already running, and is refused unless it comes from the operator under the presence proof of Decision 0110.
      - Tests cover preview/apply, the revision conflict, the scope refusal and the operator-only refusal.
    depends_on: []
    decisions: []
    references: ["docs/proposals/production-console.md", "docs/proposals/portfolio-parallel-execution.md", "docs/decisions/0115-decide-whether-production-shares-session-capacity-across-included-projects-by.md", "docs/decisions/0116-decide-what-production-runs-when-a-project-s-active-plan-waits-on-the-operator.md", "docs/decisions/0054-should-plan-and-action-priority-live-only-in-the-queue.md", "docs/decisions/0110-decide-what-proves-a-reserve-release-or-reserve-lowering-came-from-the-operator-and.md"]
  - id: admit-from-project-preferences
    title: The tick picks the next Action from the preference record at admission and locks it in with a receipt that says why.
    status: open
    responsibility: agent
    effort: session
    next_action: The tick picks the next Action from the preference record at admission and locks it in with a receipt that says why.
    expected_artifact: Evidence satisfying Agent Ask admit-from-project-preferences
    clarification: clarified
    confidence: high
    source: Agent Ask production-queue-controls-plan-2026-10-11
    acceptance_criteria:
      - At each admission the tick walks included Projects in preference order (or by share, per Decision 0115), takes the chosen Plan's next ready Action, and skips a Project whose active Plan waits on the operator as Decision 0116 answered, recording one skip reason per skipped Project.
      - Each admission writes a lock-in receipt naming the Project, Plan, Action, provider and every skip reason above it; nothing is locked before admission.
      - With one Session the result equals stack-skip-when-blocked; with more Sessions the same rule fills each free slot, one Session per repository, with no other change.
      - Tests cover order, skip reasons, the receipt and two slots.
    depends_on: [record-production-project-preferences]
    decisions: []
    references: ["docs/proposals/production-console.md", "docs/proposals/portfolio-parallel-execution.md", "docs/decisions/0115-decide-whether-production-shares-session-capacity-across-included-projects-by.md", "docs/decisions/0116-decide-what-production-runs-when-a-project-s-active-plan-waits-on-the-operator.md", "docs/decisions/0054-should-plan-and-action-priority-live-only-in-the-queue.md"]
  - id: production-card-queue-controls
    title: The /production Project cards let the operator include or stop a Project, move it to the top and run a different Plan, each stating its consequence.
    status: open
    responsibility: agent
    effort: session
    next_action: The /production Project cards let the operator include or stop a Project, move it to the top and run a different Plan, each stating its consequence.
    expected_artifact: Evidence satisfying Agent Ask production-card-queue-controls
    clarification: clarified
    confidence: high
    source: Agent Ask production-queue-controls-plan-2026-10-11
    acceptance_criteria:
      - Each card offers Include or Stop running, Move to top with an Undo toast, and Run this Plan instead for each other active Plan; each previews through the preference record and states its consequence before applying, as in docs/proposals/production-console.md.
      - Controls are shown only to the operator path the record accepts, and a refusal shows Arcadia's own reason.
      - An e2e test at 375px changes the order and a Plan, sees the preference revision advance, and finds no horizontal overflow.
    depends_on: [record-production-project-preferences]
    decisions: []
    references: ["docs/proposals/production-console.md", "docs/proposals/portfolio-parallel-execution.md", "docs/decisions/0115-decide-whether-production-shares-session-capacity-across-included-projects-by.md", "docs/decisions/0116-decide-what-production-runs-when-a-project-s-active-plan-waits-on-the-operator.md", "docs/decisions/0054-should-plan-and-action-priority-live-only-in-the-queue.md", "apps/dashboard/components/production-console.tsx"]
  - id: show-skip-reasons-and-lock-in-on-cards
    title: Each Project card shows why it is not running and when its current Action was locked in.
    status: open
    responsibility: agent
    effort: session
    next_action: Each Project card shows why it is not running and when its current Action was locked in.
    expected_artifact: Evidence satisfying Agent Ask show-skip-reasons-and-lock-in-on-cards
    clarification: clarified
    confidence: high
    source: Agent Ask production-queue-controls-plan-2026-10-11
    acceptance_criteria:
      - A card that is not running shows the latest tick skip reason for its Project, and a card with a live Session shows 'Locked in <time>' from its lock-in receipt.
      - Predictions show 'Would pick now · as of <time>' and dim when older than two minutes.
      - Unit tests cover each state.
    depends_on: [admit-from-project-preferences]
    decisions: []
    references: ["docs/proposals/production-console.md", "docs/proposals/portfolio-parallel-execution.md", "docs/decisions/0115-decide-whether-production-shares-session-capacity-across-included-projects-by.md", "docs/decisions/0116-decide-what-production-runs-when-a-project-s-active-plan-waits-on-the-operator.md", "docs/decisions/0054-should-plan-and-action-priority-live-only-in-the-queue.md", "apps/dashboard/lib/production-console.ts"]
questions: []
decisions: []
---

# Let the operator change what production queues from the /production Project cards: which Projects are included, their order, and each Project's Plan, as light preferences that stay flexible until a Session starts and is locked in with a receipt.

Created as an inactive draft from accepted Agent Ask production-queue-controls-plan-2026-10-11; creation changed no pointer. Current activation is recorded in frontmatter.

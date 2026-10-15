---
arcadia: v1
type: plan
slug: reduce-lead-friction-through-ten-bounded-session-trials
project: arcadia
status: draft
milestone: Reduce Lead friction through ten bounded session trials
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-15
actions:
  - id: prepare-lead-trial-baseline
    title: "Verify the Lead trial guide and baseline evidence, and prepare an explicit finite allowance for the pilot without launching a Session. Recommended role: planner, standard tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    status: open
    responsibility: agent
    effort: session
    next_action: "Verify the Lead trial guide and baseline evidence, and prepare an explicit finite allowance for the pilot without launching a Session. Recommended role: planner, standard tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    expected_artifact: Evidence satisfying Agent Ask prepare-lead-trial-baseline
    clarification: clarified
    confidence: high
    source: Agent Ask plan-lead-session-trial-learning-20261015-r2
    why: "Reuse existing roles, session ledgers, friction records and the standard harness; make the next test easier before spending on it."
    acceptance_criteria:
      - The checked-in docs/lead-session-trials/README.md is one supporting entry point linking existing authoritative procedures, the baseline evidence and existing ledger/friction formats; it creates no competing work pointer, permission policy, role or runner.
      - "The baseline cites PR #1418 and its final reviewed head, Issue #1419 and available broker evidence, distinguishing original install receipts from fresh state observations and marking unavailable receipts explicitly; it separates native delegation from managed enrollment, operator decisions from supervisor interventions and host operations, verified remedies from hypotheses, and unavailable metrics from zero."
      - A previewed Agent Ask prepares the pilot's explicit aggregate provider-usage ceiling, reserve, per-trial wall limit, permitted model escalations, maximum attempts/review rounds and stop condition for operator approval; no trial begins while required allowance or authority is unavailable. Proposed maximum is 30 active work minutes per trial excluding CI wait, plus a named finite CI deadline; this is a proposal, not spend authorization.
      - The proposed full ten-trial exposure is classified large/staged, separately from this planning/documentation work. The current plan writer hardcodes medium and a generic budget; preserve that as an explicit writer limitation, not an approved estimate, and resolve the metadata/allowance through an existing governed path before any trial activation. Unsupported new Ask fields are not added.
    depends_on: []
    decisions: []
    references: ["docs/lead-session-trials/README.md", "docs/reports/frictions/20261015-luna-lead-trial-recovery.md", "docs/agent-guidance/session-roles-and-briefs.md", "docs/agent-guidance/pull-requests.md", "docs/agent-guidance/agent-asks.md", "docs/reports/lead-session-trials/20261015-baseline-receipts.json"]
  - id: run-lead-trial-01
    title: "Run bounded Lead trial 1 on one authorized small documentation task and preserve reviewed delivery evidence and its next-trial lesson. Recommended role: Lead, light tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    status: open
    responsibility: agent
    effort: session
    next_action: "Run bounded Lead trial 1 on one authorized small documentation task and preserve reviewed delivery evidence and its next-trial lesson. Recommended role: Lead, light tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    expected_artifact: Evidence satisfying Agent Ask run-lead-trial-01
    clarification: clarified
    confidence: high
    source: Agent Ask plan-lead-session-trial-learning-20261015-r2
    why: "Learn from useful real work, one Action and one fresh light-tier Lead at a time; do not manufacture busywork to fill a quota."
    acceptance_criteria:
      - "Before trial 1, the saved brief records one useful authorized deliverable and its governing Action or direct instruction, guide/source revision, acceptance, sole writer, model/effort, parent/supervisor and finite remaining allowance. No launch occurs if the scope, prior gate, usage evidence or permission cannot be established. Expected proof: the independent reviewer checks the saved brief for every named field and records a launch refusal if any required field or permission is missing."
      - "A fresh Luna or Haiku Lead uses the existing harness and supported role briefs; only depth-zero Lead requests authorized depth-one help, with one writer. The three delivery gates are evidenced separately: useful bounded artifact, preserved branch/PR, and independent current-head review plus all required checks and clean merge before any authorized PR merge. A gate refusal is recorded as a valid outcome, never bypassed to satisfy trial completion."
      - The record links exact session/agent and revision identities, PR/check/review or refusal receipts, operator decisions, supervisor interventions, host operations, permission requests, unchanged failed attempts, delegated no-diff handbacks, wall time separated from CI wait, and runtime-reported usage or unavailable. Use existing ledger and friction files, no second work-state database.
      - An independent read-only assessment verifies the outcome and one stated friction hypothesis against the evidence. Before any successor trial, verified prevention advice is merged into its owning guide or canonical procedure through the required review path; unverified causes remain labelled and source defects are deduplicated into Issues/Agent Asks. No measured improvement is claimed without a comparable baseline and no authority/safety regression.
      - If a genuine approval boundary, denied host request, exhausted allowance, repeated unchanged refusal or first empty delegate handback occurs, follow the indexed bounded recovery/stop route. Do not replace a stopped agent to reset allowance, start the successor automatically, schedule a watcher, or activate production. Capture the exact next permitted move; completion/next Action uses existing governed writer.
    depends_on: [prepare-lead-trial-baseline]
    decisions: []
    references: ["docs/lead-session-trials/README.md", "docs/reports/frictions/20261015-luna-lead-trial-recovery.md", "docs/agent-guidance/session-roles-and-briefs.md", "docs/agent-guidance/pull-requests.md", "docs/agent-guidance/agent-asks.md", "docs/reports/lead-session-trials/20261015-baseline-receipts.json"]
  - id: run-lead-trial-02
    title: "Run bounded Lead trial 2 on one authorized comparable documentation task and preserve reviewed delivery evidence and its next-trial lesson. Recommended role: Lead, light tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    status: open
    responsibility: agent
    effort: session
    next_action: "Run bounded Lead trial 2 on one authorized comparable documentation task and preserve reviewed delivery evidence and its next-trial lesson. Recommended role: Lead, light tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    expected_artifact: Evidence satisfying Agent Ask run-lead-trial-02
    clarification: clarified
    confidence: high
    source: Agent Ask plan-lead-session-trial-learning-20261015-r2
    why: "Learn from useful real work, one Action and one fresh light-tier Lead at a time; do not manufacture busywork to fill a quota."
    acceptance_criteria:
      - "Before trial 2, the saved brief records one useful authorized deliverable and its governing Action or direct instruction, guide/source revision, acceptance, sole writer, model/effort, parent/supervisor and finite remaining allowance. No launch occurs if the scope, prior gate, usage evidence or permission cannot be established. Expected proof: the independent reviewer checks the saved brief for every named field and records a launch refusal if any required field or permission is missing."
      - "A fresh Luna or Haiku Lead uses the existing harness and supported role briefs; only depth-zero Lead requests authorized depth-one help, with one writer. The three delivery gates are evidenced separately: useful bounded artifact, preserved branch/PR, and independent current-head review plus all required checks and clean merge before any authorized PR merge. A gate refusal is recorded as a valid outcome, never bypassed to satisfy trial completion."
      - The record links exact session/agent and revision identities, PR/check/review or refusal receipts, operator decisions, supervisor interventions, host operations, permission requests, unchanged failed attempts, delegated no-diff handbacks, wall time separated from CI wait, and runtime-reported usage or unavailable. Use existing ledger and friction files, no second work-state database.
      - An independent read-only assessment verifies the outcome and one stated friction hypothesis against the evidence. Before any successor trial, verified prevention advice is merged into its owning guide or canonical procedure through the required review path; unverified causes remain labelled and source defects are deduplicated into Issues/Agent Asks. No measured improvement is claimed without a comparable baseline and no authority/safety regression.
      - If a genuine approval boundary, denied host request, exhausted allowance, repeated unchanged refusal or first empty delegate handback occurs, follow the indexed bounded recovery/stop route. Do not replace a stopped agent to reset allowance, start the successor automatically, schedule a watcher, or activate production. Capture the exact next permitted move; completion/next Action uses existing governed writer.
    depends_on: [run-lead-trial-01]
    decisions: []
    references: ["docs/lead-session-trials/README.md", "docs/reports/frictions/20261015-luna-lead-trial-recovery.md", "docs/agent-guidance/session-roles-and-briefs.md", "docs/agent-guidance/pull-requests.md", "docs/agent-guidance/agent-asks.md", "docs/reports/lead-session-trials/20261015-baseline-receipts.json"]
  - id: assess-first-two-lead-trials
    title: "Independently compare the first two trials and propose whether to continue, narrow or stop the remaining trial series. Recommended role: plan-critic, standard tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    status: open
    responsibility: agent
    effort: session
    next_action: "Independently compare the first two trials and propose whether to continue, narrow or stop the remaining trial series. Recommended role: plan-critic, standard tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    expected_artifact: Evidence satisfying Agent Ask assess-first-two-lead-trials
    clarification: clarified
    confidence: high
    source: Agent Ask plan-lead-session-trial-learning-20261015-r2
    why: "A short pilot should prove whether the documentation reduces repeated friction before committing to eight more sessions."
    acceptance_criteria:
      - A read-only critic compares both trial records against the recorded baseline and matched task scopes, naming which interventions disappeared, persisted or increased; missing usage/time data and confounding task/CI differences are explicit.
      - The checkpoint records continue, narrow or stop as a governed proposal with evidence and remaining finite allowance. Continuation is not inferred from silence; any new scope/spend/authority awaits the appropriate operator decision.
      - The remaining eight trials stay sequential and select only useful already-authorized work; advanced operational or managed-production proof is excluded unless separately authorized by the existing production Plan. Ten is a cap, not a success quota.
      - If continuing, submit a governed Plan amendment adding the next justified one-Session trial (up to trial 10 total) and rewiring the consolidation dependency before further dispatch; do not pre-authorize eight additional launches. If stopping after the pilot, consolidation remains reachable without marking any unattempted trial complete.
    depends_on: [run-lead-trial-02]
    decisions: []
    references: ["docs/lead-session-trials/README.md", "docs/reports/frictions/20261015-luna-lead-trial-recovery.md", "docs/agent-guidance/session-roles-and-briefs.md", "docs/agent-guidance/pull-requests.md", "docs/agent-guidance/agent-asks.md", "docs/reports/lead-session-trials/20261015-baseline-receipts.json"]
  - id: consolidate-lead-trial-findings
    title: "Publish the bounded trial series assessment and promote only verified lessons into their canonical homes. Recommended role: planner, standard tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    status: open
    responsibility: agent
    effort: session
    next_action: "Publish the bounded trial series assessment and promote only verified lessons into their canonical homes. Recommended role: planner, standard tier; size: one Session; operator gate: explicit allowance and scope before any launch, otherwise proposal only."
    expected_artifact: Evidence satisfying Agent Ask consolidate-lead-trial-findings
    clarification: clarified
    confidence: high
    source: Agent Ask plan-lead-session-trial-learning-20261015-r2
    why: "Retain useful learning, remove duplicated advice, and expose the actual readiness gap rather than claiming autonomy from native teamwork."
    acceptance_criteria:
      - Consolidate only after the pilot checkpoint or a recorded earlier stop, with no live trial or competing writer. On an earlier stop, submit a governed amendment to make this Action reachable while retaining unattempted Actions as unfinished or deferred, never falsely complete. Further trial amendments preserve a reachable consolidation path.
      - The assessment accounts for every attempted trial up to the ten-trial cap, including early stops, with evidence links and explicit comparable-task limits; it reports changes in operator/supervisor/host interventions, repeated failures, review defects, wall time and reported usage without invented totals.
      - Verified lessons are incorporated in existing canonical instructions or Notes To Self under its capacity/expiry rules; the trial guide remains a curated index and the existing ledger/friction records remain evidence. Superseded advice is removed from the trial guide rather than copied into another permanent memory store.
      - The report separately states supervised native-team delivery, host operations, managed Session admission and end-to-end unattended production evidence. It names unresolved defects and revival triggers, and submits a next-step Agent Ask without activating a new Plan, new automation or production.
    depends_on: [assess-first-two-lead-trials]
    decisions: []
    references: ["docs/lead-session-trials/README.md", "docs/reports/frictions/20261015-luna-lead-trial-recovery.md", "docs/agent-guidance/session-roles-and-briefs.md", "docs/agent-guidance/pull-requests.md", "docs/agent-guidance/agent-asks.md", "docs/reports/lead-session-trials/20261015-baseline-receipts.json"]
questions: []
decisions: []
---

# Reduce Lead friction through ten bounded session trials

Created as an inactive draft from accepted Agent Ask plan-lead-session-trial-learning-20261015-r2; creation changed no pointer. Current activation is recorded in frontmatter.

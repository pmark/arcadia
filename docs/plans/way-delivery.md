---
arcadia: v1
type: plan
slug: way-delivery
project: arcadia
status: active
milestone: Every adopting project receives Way changes and can ask for Way capabilities without anyone writing Arcadia twice
token_impact: medium
token_budget: "Regeneration, drift comparison, and pull-request mechanics are deterministic and belong in code, not a model. Reserve model use for one implementation session per Action and a single review pass. A propagation run that calls a model per repository is the failure mode this budget exists to prevent."
recommended_model: claude-sonnet-5
updated: 2026-09-04
current_action: rename-codex-responsibility-to-agent
actions:
  - id: seed-the-work-pointer-when-a-repository-is-adopted
    title: Write PROJECT.md and a first plan when a repository is adopted
    status: done
    responsibility: codex
    effort: session
    next_action: Seed the work pointer chain from the Project record `setup-context` already resolves, and offer the same adoption from the Project page where the refusal is read.
    expected_artifact: An adopted repository that resolves to a real Action or to one operator question, instead of to "No PROJECT.md declaring slug ... was found"
    clarification: clarified
    confidence: high
    source: Operator adopted martianrover-com2, ran `project setup-context`, and the Project page still refused for a missing PROJECT.md, 2026-08-20.
    acceptance_criteria:
      - Adopting a registered repository writes a PROJECT.md and a first plan, and `arcadia next` resolves an Action from them.
      - Neither document is ever overwritten when the repository already has one.
      - A repository no Project claims is adopted without a PROJECT.md, and says why.
      - The Project page offers the same adoption where the refusal is displayed.
    depends_on: []
    references:
      - src/projects/controlDocuments.ts
      - src/projects/contextSetup.ts
      - apps/dashboard/app/projects/[id]/page.tsx
    result: >-
      Adoption wrote every governance file and stopped one document short of
      working: `setup-context` never wrote a `PROJECT.md`, so every adopted
      repository resolved to the same refusal with no command that would
      produce one -- while the Actions it needed sat in the database the whole
      time. `seedControlDocuments` writes that translation. The Actions are
      copied faithfully; the one adjustment is on the Action being pointed at,
      which the schema requires to declare `clarified` with acceptance criteria
      or `question_open` with a question. Rather than invent criteria it
      derives at most one, and only from `expected_artifact` -- something that
      either exists or does not -- and where even that is absent the Action is
      emitted as the open question it already was. The pointer is set only when
      one Action is unambiguous (a sole `in_progress`, else a sole startable
      one); anything more ambiguous is left unset, and the resulting blocker
      names every candidate id. `--repo` now resolves the Project registered at
      that path, so it and a project identifier no longer adopt the same
      repository differently, and it still works with no workspace at all.
      Verified live on martianrover-com2: the Project page went from "No
      PROJECT.md declaring slug martian-rover was found" to "Ready to prepare --
      Implement the next code change" without leaving the page. 8 new tests in
      tests/project-control-documents.test.ts; full suite 883 passing.
  - id: open-way-sync-pull-requests
    title: Propagate Way changes to every project as a pull request, never as a merge
    status: open
    responsibility: requires_review
    effort: session
    next_action: Implement tiered propagation — regenerate each adopting repository's mechanical tier, open one pull request per repository, and auto-merge only the mechanical tier within the guardrails Decision 0024 sets.
    expected_artifact: A command that regenerates managed regions in each adopting repository and opens one pull request per repository, auto-merging only the mechanical tier
    clarification: clarified
    confidence: medium
    source: Operator asked whether Way updates should reach projects automatically, 2026-08-16; answered by Decision 0024 on 2026-08-17. Rehomed here from arcadia-way-propagation on 2026-08-17, which had reached its milestone while this Action was still blocked.
    acceptance_criteria:
      - A mechanical-tier change propagates to every adopting repository as one pull request per repository and merges without review.
      - A governing-tier change opens a pull request and never merges automatically, including when a run would touch both tiers.
      - A run that would produce byte-identical files opens nothing.
      - Nothing outside the managed marker region is ever written, and no push targets a default branch directly.
      - A repository whose `adoption.json` declines automatic upgrades is skipped and reported.
    decisions: ["0024"]
    depends_on: []
    references:
      - docs/agents-context.md
      - src/projects/contextSetup.ts
      - docs/decisions/0024-way-propagation-tiers-and-push-authority.md
  - id: accept-upstream-proposals
    title: Let a project ask for a Way capability instead of building one
    status: done
    responsibility: codex
    effort: session
    next_action: "Ingest `type: proposal` documents as pending operator requests, surface unresolved ones in `arcadia portfolio` under 'Waiting on you', and add the request path to the shared AGENTS.md region."
    expected_artifact: A proposal filed in an adopting repository that reaches the operator through docs sync and portfolio without any new channel, plus the AGENTS.md rule that tells agents to file rather than implement
    clarification: clarified
    confidence: high
    source: Decision 0025. PPN's 781-line scripts/arcadia.mjs is what a missing escalation path produces.
    acceptance_criteria:
      - "A `type: proposal` document committed in an adopting repository is ingested by `docs sync` as a pending request rather than an unhandled narrative record."
      - Unresolved proposals appear in `arcadia portfolio` under 'Waiting on you' with their project and question.
      - A proposal records the Decision that answered it, and stops appearing once answered.
      - The shared AGENTS.md region states that an agent files a proposal and continues without the capability, and never implements Arcadia machinery locally.
      - Filing requires no network access, credentials, or reachable Arcadia, so it works from a cloud container.
    decisions: ["0025"]
    depends_on: []
    references:
      - src/docs/sync.ts
      - src/docs/discover.ts
      - src/commands/portfolio.ts
      - docs/decisions/0025-upstream-way-change-requests.md
    result: >-
      `proposal` is a first-class parsed document: only the question is
      load-bearing (frontmatter or first `#` heading), the slug falls back to
      the filename, and the project to whoever owns the repository. `docs
      sync` ingests each one as a review item under the `WayProposal` intent
      -- reusing the operator's existing answer table rather than opening a
      second queue -- and `arcadia portfolio` lists unresolved proposals under
      "Waiting on you", counted separately from Decisions so they do not
      inflate that count. A proposal that names `decision: "NNNN"` is closed
      and stops appearing. The shared AGENTS.md region ("Asking for a
      capability the Way does not have") states the file-a-proposal rule so it
      reaches every adopting repository through propagation. Filing is a
      committed Markdown file: no network access, credentials, or reachable
      Arcadia workspace required. Verified via `tests/upstream-proposals.test.ts`
      (8/8 passing) and the full suite (1,199 passing, 7 skipped, 3 files
      failing on a pre-existing dashboard workspace-link error and an
      unrelated Obsidian-memory assertion -- both present before this session
      and untouched by it).
  - id: evaluate-document-triggers
    title: Evaluate the deferrals Arcadia's own documents already declare
    status: done
    responsibility: codex
    effort: session
    next_action: "Add an `arcadia triggers` noun that reads a repository's declared deferral conditions and reports which have fired, evaluating them repo-locally with no workspace, the way `resolveDispatch` does."
    expected_artifact: A read-only `arcadia triggers` command reporting fired, waiting, and watch states for every deferral declared in a repository's governed documents
    clarification: clarified
    confidence: high
    source: Decision 0028, promoting PPN's implementation. Nine Arcadia documents declare deferrals with reviving conditions and nothing can evaluate one of them.
    acceptance_criteria:
      - Every deferral this repository declares is either evaluated or explicitly reported as unevaluable, with no deferral silently ignored.
      - A fired condition is reported as fired, and the continuation protocol's rule that a firing trigger outranks `current_action` has something to read.
      - The command is a noun - it reports and never writes.
      - It runs with no workspace and no database, so it works in a fresh clone or a container.
    decisions: ["0028"]
    depends_on: []
    references:
      - docs/decisions/0028-ppn-capability-reconciliation.md
      - src/docs/dispatch.ts
  - id: adopt-operator-task-ledger
    title: Record work only the operator can do, separately from decisions awaiting review
    status: done
    responsibility: codex
    effort: session
    next_action: "Adopt PPN's operator task ledger - append-only entries citing an action or decision, stating why an agent cannot act, with agent evidence separated from operator-only closure."
    expected_artifact: An operator task ledger with raise, read, close, and decline paths, where closure is operator-only and an agent may attach evidence without closing
    clarification: clarified
    confidence: medium
    source: Decision 0028, promoting PPN's ADR 0025 implementation ratified there 2026-08-14.
    acceptance_criteria:
      - An agent can raise an entry and attach evidence, and cannot close one.
      - Every entry cites an action, decision, or blocker already in project control and states why an agent cannot do it.
      - Entries are distinguishable from Decisions awaiting review, which `attention` already covers, and from Back Burner items awaiting a surfacing condition.
      - Open entries surface to the operator without being hunted for.
    decisions: ["0028"]
    depends_on: []
    references:
      - docs/decisions/0028-ppn-capability-reconciliation.md
      - src/commands/attention.ts
    result: >-
      `.arcadia/operator-tasks.jsonl` is an append-only, repo-local ledger --
      no workspace, no database, the same shape as `resolveDispatch` and
      `evaluateTriggers` -- deliberately, since an agent raising a task is
      often reporting exactly the kind of environment gap (no reachable
      workspace, no credential) that would make a database-backed ledger
      unusable at the moment it is needed most. `arcadia operator-task raise`
      requires an origin already in project control (an Action id from
      `docs/plans/*.md` or a Decision id from `docs/decisions/`) and a
      `--because` explaining why only the operator can act; `evidence`
      attaches an agent's non-binding note without closing anything; `close`
      and `decline` are terminal and refuse without an explicit `--operator`
      flag, the same loud-escape-hatch shape as `--allow-blocking` elsewhere,
      since this CLI holds no credentials to enforce it harder. `docket`
      reports the open count so entries surface without a separate hunt.
      Proposal 0002's third origin kind, a "recorded blocker," is deferred
      exactly as the PPN reference implementation deferred it -- Arcadia
      declares no such record type, and every real task cites an Action or a
      Decision. 13 new tests in tests/operator-task-ledger.test.ts, plus the
      full suite (1,225 passing, 7 skipped; one pre-existing, unrelated
      Obsidian-memory failure untouched by this change) and a clean
      typecheck.
  - id: propagate-agent-ask-contract
    title: Document the Agent Ask contract inside the propagated AGENTS.md region so every adopting project receives it and `arcadia way` reports it stale when it drifts.
    status: done
    responsibility: codex
    effort: session
    next_action: Document the Agent Ask contract inside the propagated AGENTS.md region so every adopting project receives it and `arcadia way` reports it stale when it drifts.
    expected_artifact: Evidence satisfying Agent Ask propagate-agent-ask-contract
    clarification: clarified
    confidence: high
    source: Agent Ask document-agent-ask-for-adopters-2026-09-02b
    acceptance_criteria:
      - docs/agents-context.md carries an Agent Ask section stating what the facility is for, the exact command an agent runs from its own repository without knowing Arcadia's workspace path, and the rule that a proposal is never self-approving.
      - Every intent in AGENT_ASK_INTENTS appears in one table with what it changes and whether it opens a Decision; the table is complete against the constant rather than a prose subset.
      - Three worked examples cover the distinct envelope shapes — one simple single-intent Ask, one multi-Action bundle, and one target_ref amendment — instead of one example per intent.
      - Running `arcadia project setup-context --all` writes the new section into every adopting repository, and `arcadia way` then reports each adopting AGENTS.md region as matching rather than stale.
      - Private Practice Now's AGENTS.md contains the section after that run, verified by reading the file rather than by inferring it from a command's exit status.
    depends_on: []
    decisions: []
    references: [docs/agents-context.md, src/projects/contextSetup.ts, src/projects/wayDrift.ts, src/ask/agentAsk.ts, START_HERE.md]
  - id: report-agent-ask-contract
    title: Add a read-only `arcadia agent-ask contract` noun that prints the live envelope schema, every supported intent, and the validation rules, so an agent can query the contract instead of trusting a possibly stale file.
    status: done
    responsibility: codex
    effort: session
    next_action: Add a read-only `arcadia agent-ask contract` noun that prints the live envelope schema, every supported intent, and the validation rules, so an agent can query the contract instead of trusting a possibly stale file.
    expected_artifact: Evidence satisfying Agent Ask report-agent-ask-contract
    clarification: clarified
    confidence: high
    source: Agent Ask document-agent-ask-for-adopters-2026-09-02b
    acceptance_criteria:
      - The command derives intents from AGENT_ASK_INTENTS and accepted fields from STRICT_FIELDS and STRICT_ACTION_FIELDS, so it cannot describe an intent or field the parser does not accept.
      - "It is a noun: it reports and never writes, makes zero model calls, and needs no Project, workspace, or database, so it answers from a fresh clone."
      - Output includes the requested_authority values, the explicit Action id rules, and the statement that agent text never grants approval.
      - It emits Arcadia's standard JSON envelope with --json, and a focused test asserts the printed intent list equals AGENT_ASK_INTENTS so the two cannot drift.
    depends_on: []
    decisions: []
    references: [docs/agents-context.md, src/projects/contextSetup.ts, src/projects/wayDrift.ts, src/ask/agentAsk.ts, START_HERE.md, src/cli.ts]
  - id: carry-decision-options
    title: A Decision can state the choices it is between, each with its consequence, and mark one as recommended - and an agent filing a Decision supplies them rather than leaving the operator to infer them from prose.
    status: open
    responsibility: codex
    effort: session
    next_action: A Decision can state the choices it is between, each with its consequence, and mark one as recommended - and an agent filing a Decision supplies them rather than leaving the operator to infer them from prose.
    expected_artifact: Evidence satisfying Agent Ask carry-decision-options
    clarification: clarified
    confidence: high
    source: Agent Ask decisions-should-offer-choices-2026-09-03
    acceptance_criteria:
      - A Decision document carries an ordered `options` list, each entry with a short label, the consequence of choosing it, and whether it is the recommendation.
      - The rendered Decision shows those options as a list a person can answer by picking one, without reading the rationale first.
      - Agent Ask's `decision` intent accepts `options`, and `agent-ask contract` reports the field and its shape so an agent learns it from the contract.
      - A `decision` Ask filed without options is still accepted, so this never becomes a reason a finding cannot be reported.
      - "`arcadia decision approve` accepts an option's label as the answer and records which option was chosen."
    depends_on: []
    decisions: []
    references: [src/docs/types.ts, src/ask/agentAsk.ts, src/commands/decision.ts]
  - id: stop-dumping-rationale-into-recommendation
    title: A Decision's recommendation field holds a recommendation, and the filing Ask's rationale lands where a reader expects to find reasoning.
    status: open
    responsibility: codex
    effort: session
    next_action: A Decision's recommendation field holds a recommendation, and the filing Ask's rationale lands where a reader expects to find reasoning.
    expected_artifact: Evidence satisfying Agent Ask stop-dumping-rationale-into-recommendation
    clarification: clarified
    confidence: high
    source: Agent Ask decisions-should-offer-choices-2026-09-03
    acceptance_criteria:
      - An Ask's `rationale` is written into the Decision's body, not into `recommendation`.
      - "`recommendation` holds only the recommended course of action, and is empty when the Ask recommends none."
      - A test asserts a multi-paragraph rationale does not appear in `recommendation`.
    depends_on: []
    decisions: []
    references: [src/ask/settlement.ts, docs/decisions/0044-decide-whether-agent-ask-should-gain-a-capability-to-correct-or-amend-an-existin.md]
  - id: rename-codex-responsibility-to-agent
    title: "Rename the \"codex\" value of WorkClassification to \"agent\" in src/domain/constants.ts (WORK_CLASSIFICATIONS and WORK_CLASSIFICATION_LABELS), update every reference in AGENTS.md, the agent-ask CLI (validation, help text, `agent-ask contract` output), and other docs under docs/ that name \"codex\" as a responsibility value, and rewrite every Plan document under docs/plans/ in this repository whose Action frontmatter reads `responsibility: codex` to `responsibility: agent`. Add a compatibility read path so a Plan document (in this repository or an adopting project) that still has `responsibility: codex` is accepted and normalized to `agent` rather than rejected, since Arcadia Way changes reach adopting projects on their own schedule, not instantaneously."
    status: open
    responsibility: codex
    effort: session
    next_action: "Rename the \"codex\" value of WorkClassification to \"agent\" in src/domain/constants.ts (WORK_CLASSIFICATIONS and WORK_CLASSIFICATION_LABELS), update every reference in AGENTS.md, the agent-ask CLI (validation, help text, `agent-ask contract` output), and other docs under docs/ that name \"codex\" as a responsibility value, and rewrite every Plan document under docs/plans/ in this repository whose Action frontmatter reads `responsibility: codex` to `responsibility: agent`. Add a compatibility read path so a Plan document (in this repository or an adopting project) that still has `responsibility: codex` is accepted and normalized to `agent` rather than rejected, since Arcadia Way changes reach adopting projects on their own schedule, not instantaneously."
    expected_artifact: Evidence satisfying Agent Ask rename-codex-responsibility-to-agent
    clarification: clarified
    confidence: high
    source: Agent Ask rename-codex-responsibility-to-agent-2026-09-04
    acceptance_criteria:
      - WORK_CLASSIFICATIONS in src/domain/constants.ts contains "agent", not "codex", and WORK_CLASSIFICATION_LABELS maps agent to "Agent".
      - Every place in AGENTS.md, docs/, and the agent-ask CLI (validation messages, help text, arcadia agent-ask contract output) that names codex as a responsibility value now names agent instead.
      - Every Plan document under docs/plans/ in this repository with responsibility codex (as an Action's responsibility field) is rewritten to responsibility agent.
      - Reading a Plan document that still has responsibility codex (this repository mid-migration, or an adopting project that has not yet received the Way change) is accepted and normalized to agent, not rejected.
      - A test covers both the new literal value and the legacy-value read/normalization path.
    depends_on: []
    decisions: []
    references: []
  - id: go-fetches-and-fast-forwards-base-from-remote
    title: Before preparing the next worktree, arcadia go fetches the base branch's remote and fast-forwards local base onto it when it is a clean ancestor, failing closed on divergence.
    status: open
    responsibility: agent
    effort: session
    next_action: Before preparing the next worktree, arcadia go fetches the base branch's remote and fast-forwards local base onto it when it is a clean ancestor, failing closed on divergence.
    expected_artifact: Evidence satisfying Agent Ask go-fetches-and-fast-forwards-base-from-remote
    clarification: clarified
    confidence: high
    source: Agent Ask go-fetches-remote-base-before-worktree-2026-09-04
    acceptance_criteria:
      - Before computing the next worktree, arcadia go runs a remote fetch for the base branch's tracked remote (skipping cleanly, with a reported reason, when the repository has no remote configured).
      - When the local base branch is a clean fast-forward candidate onto the fetched remote ref, arcadia go fast-forwards it before proceeding, and this shows in the JSON result.
      - When the local base branch has diverged from the fetched remote ref (unmergeable without rebase/merge), arcadia go refuses with a clear message rather than silently proceeding on stale or diverged state, per the existing fail-closed safety contract in docs/agent-continuation-protocol.md and the arcadia-go skill.
      - A test covers each path — no remote configured, clean fast-forward applied, and divergence refused.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: ["0024", "0025", "0028"]
---

# Way delivery

## Why this plan exists

`arcadia-way-propagation` reached its milestone — staleness is visible rather
than silent, and `arcadia way` reports it. But two things it never covered are
now the whole problem:

**Nothing delivers.** `arcadia way` reports that a project is stale; no command
makes it current. Way changes still reach projects by hand, which works at
three repositories and is exactly what breaks as adoption grows.

**Nothing receives.** A project that needs a Way capability has no way to ask
for one. Private Practice Now's `scripts/arcadia.mjs` — 781 lines including a
second implementation of the managed-document parser — is what that absence
produces. It was not misbehaviour; it was the only move available.

Those are the two directions of one pipe, which is why they belong in one plan
rather than being scattered.

## What this plan does not cover

Distributing Arcadia's **code** to projects, so a container can orient itself
without an Arcadia checkout. That is the packaging question deferred on
`arcadia-way-propagation` behind its own trigger, and it is a distribution
decision rather than a delivery mechanism. This plan makes policy and requests
flow; it does not make `src/docs/*` installable.

The consequence is worth stating plainly: after this plan, PPN's shim can be
*trimmed* — its docket, and eventually its triggers and demo, become requests
rather than local code — but it cannot be *deleted*, because the project still
has no way to import Arcadia.

## Why it is `draft`

Arcadia's `active_plan` is `demo-first-delivery`, and this plan does not
displace it. Nothing here dispatches until the operator moves the pointer.

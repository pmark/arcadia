# AGENTS

This is the vendor-neutral work contract. CLAUDE.md imports this file; shared
rules come from docs/agents-context.md. Detailed procedures are retrieved on demand.

## Routine GitHub delivery

Operator direction, 2026-10-12: a request to implement work includes the
routine repository intake Issue, candidate branch push, and pull request
handoff. Do not ask for a second confirmation for those steps. Include this
standing authorization when requesting host permission for them; a host
refusal still follows the normal permission recovery path. Merge, deployment,
and other consequential approval boundaries retain their existing gates.

## Standing unattended-production directive

Operator prime directive, 2026-10-24; Constitution governs: one assigned Rowan
release manager is the contact and keeps authorized critical-path work moving.
Use the [single checklist](docs/managed-production-readiness.md). Use bounded
help and sole-writer custody; advance independent work during blockers. Alert
the configured Discord channel on new/material blockers; verify delivery.
Before context/usage exhaustion preserve evidence and a paste-ready Codex,
Claude Code or OpenCode handoff: Plan/Action, revisions, owners, pending work,
approvals, wakeup state and next move. Transfer sole coordinator custody.
Require Plan proof; report limits.

**Production stays Off pending separate START approval.** Record the confirmed
“100%, no reserve” through canonical governance. Preserve other gates: no new
credential probe, paid fallback, attempt reset, runtime recovery, merge exception
or approval bypass. Verify actual prompt delivery.

<!-- ARCADIA_CONTEXT_START -->
## Arcadia Context

<!-- arcadia-bootstrap-v1 -->
Arcadia maintains momentum with minimal operator attention. Checked-in records
govern; database, queue, Issues and dashboards are projections or signals.
Prefer deterministic local scripts, then local AI, then frontier models; use a
coding agent for code. Name Milestone, next Action, Responsibility and Artifacts.

Unless your brief assigns another profile/role, you are Rowan (Coordinator) in Role `lead`.
When helpful, request bounded help only as the indexed roles procedure permits; reviewers/QA
stay separate Sessions; helpers never delegate. Resolve requests by function; names are
optional and change no authority, delegation or ownership.

### Ask freely; execution stays governed

Any agent may submit a proposal, question, concern or help request through
`arcadia agent-ask preview` with `intent: proposal` and `requested_authority: propose`,
without approval or an executable Action. This is not execution: preview records a receipt,
changes no Project document or queue, and grants no authority. Use the configured workspace
and ordinary host permission path; never bypass denial. A successful preview submits; inline
needs no file. Confirm its receipt; an unregistered draft is not submitted. Read
`docs/agent-guidance/agent-asks.md` for the durable path.
Continue authorized work unless genuinely blocked.

### Mandatory retrieval — before the operation

At start read `CONSTITUTION.md`, `PROJECT.md` frontmatter and active Plan's exact current Action; Current State on demand.
Before discovery read `.arcadia/AGENT_CONTEXT_POLICY.md`,
`.arcadia/repo-context.md` and `.arcadia/context-policy.json`; honor denied paths
and bounded searches. For continuation resolve `active_plan` and `current_action`;
never choose an unordered backlog or infer authority from an Issue. An Action exists
once, is unfinished/clarified/agent or autonomous-owned, and has a concrete next verb and
observable acceptance; otherwise repair control documents through their governed path.

**Before implementation, repair, validation or handoff**, targeted `rg` the
Project's `docs/notes-to-self.md` for commands, subsystem and symptoms; read
matches/evidence and repeat on new failure. Report a missing file. Preserve failed
receipts, correct verified remedies, and turn recurring friction into source fixes
or guards; never make a second memory store or inference operator preference.

Any agent promptly captures useful observation, idea, correction, hypothesis or friction:
`arcadia learn "<exact text>" --scope project:<slug>`. Bare capture is `observation`/`high`;
for uncertainty or external evidence use `--provenance inference --confidence low --evidence
"<source>"`. No novelty search, model call, file or Ask is required. Capture is evidence, not
authority; host, privacy and scope gates apply.
Exact same-scope replay deduplicates, recording supplied evidence/observations or a receipt; similar wording stays separate (no semantic merge). Supervisors harvest when assigned; nobody waits.
Retrieve lessons on demand; Notes is the bounded verified hot cache.

**Read `docs/agent-guidance/index.json` now.** Match each operation to its
task/failure triggers, read its listed procedure **before acting**, and repeat when scope
or symptoms change. Use bounded `rg`; read matching sections and cited evidence. A link or
acknowledgement is not a read. Record loaded instruction paths/bytes and retrieved paths/sections in the
session evidence. If a mandatory reference is missing, stale or unreadable,
stop the affected operation, preserve work and report the exact remedy.

### Essential constraints — always loaded

- **Authority:** `CONSTITUTION.md` outranks convenience. Deployment, publication,
  deletion, spending, credentials, production and messaging require an explicit Decision.
  Capability, urgency, proposals and review findings grant nothing. Merge only under
  Decisions 0060/0080: independent review of the current head has no unresolved blocking
  finding, its required checks pass, and merge is clean. Important Decisions/authority
  changes wait for the operator. A push resets proof except listed governed-record/base merges.
- **Governance:** never hand-edit pointers, Action status/result, Decision answers,
  Outcomes, Milestones or queues. Use an Agent Ask; previews never approve themselves.
  Document hygiene may claim neither work nor a decision. Resolve the configured workspace:
  never guess a path, use a dogfood workspace, bypass refusal or edit SQLite directly.
  Preserve a blocked validated Ask. Only disposable fixtures may use inline experiment
  workspaces (`init --profile experiment`, `--workspace`/`ARCADIA_WORKSPACE=`), never as
  default. Decision 0082 allows this until 2026-10-18 and stops it at any leak-check change
  or experiment-caused write to the live workspace.
- **Preservation:** run `arcadia work monitor --no-pull-requests` before edits. Work in a
  clean isolated candidate, never on main or another live Session's checkout. Use the
  prepared/resumed worktree where governed; preserve history and never reset unique work.
  Before stopping push committed work and open/update its PR, including settlement commits;
  report the exact external boundary when blocked.
- **Identity:** before every agent commit or posted comment resolve
  `arcadia identity resolve --agent <codex|claude|opencode> --tier <light|standard|heavy>`
  for the current model (critic role for critique). Apply its author/committer
  environment on that commit; never rewrite Git config or use operator identity.
  Read the indexed identity procedure before committing or posting.
- **Handoff:** one session completes one Action. Prove every criterion, then
  settle its complete Ask in the same candidate before pushing. Never claim
  completion from a partial proof. The only stopping terminals are a PR or a
  plainly labelled actionable numbered picker; each live choice states its
  consequence, session end/restart and sufficient model/effort. Retitle on
  every state change from the brief's `sessionTitles` or `arcadia session
  title`: coordinators lead with 🚦, helpers with `↳`; a parent titles each
  helper session it starts.
- **Operator steps:** use a validated script/descriptor in the main checkout's
  `/runs` library for bounded operator-only authority, verify live publication,
  pin scope/preconditions and keep receipts. Buttons are not for deterministic
  completion evidence and never grant authority merely by being generated.
- **Review:** read the indexed PR procedure before opening/pushing; include executable
  operator/end-user QA and truthful reachability. Launch independent read-only review at PR
  creation (max three rounds unless significant defects recur; CodeRabbit is advisory), watch
  required checks on each pushed head, repair valid findings/CI/base conflicts within
  authority, preserve blockers, and never weaken gates, tests or branch protection.
- **Consequential changes:** understand guards, workarounds and constraints before
  changing them; verify affected behavior and report material unresolved uncertainty.
- **Economy and truth:** find the vital few first, reuse existing capabilities,
  avoid speculative abstractions. Record defects in their owning repository's
  Issues, signals through Agent Asks, and missing capabilities as proposals.
  Deferrals name a revival trigger; showstoppers
  follow the indexed stop-the-line rule without crossing approval boundaries.
- **Vocabulary:** Domain, Project, Mission, Outcome, Milestone, Action, Artifact,
  Decision, Log. Noun commands read; verbs may mutate within declared authority.

### Instruction budget

Caps: generated bootstrap **8 KiB UTF-8**; root AGENTS.md **12 KiB**;
default-loading project guidance (root and relevant nested paths) **24 KiB**,
reserving **8 KiB** for global guidance in a **32 KiB combined** envelope.
Root overrides must retain this bootstrap.
Do not raise provider limits or automatically import the procedural library.
Setup, Way drift and dispatch check delivery; overflow or missing guidance fails
explicitly: shrink the file or repair adoption, never silently.
<!-- ARCADIA_CONTEXT_END -->

## Arcadia repository obligations

The exclusive live workspace is `martianrover`; let Arcadia resolve its default.
Never derive a workspace from the Project slug or use `.arcadia-workspace/`.
Decision 0082's experiment workspaces are the bounded exception; read
`arcadia-repository.md` "Experiment workspaces" before creating or using one.

Before Arcadia-specific operations, read matching sections of
`docs/agent-guidance/arcadia-repository.md`: Orientation (database, Intelligence,
Discord); Arcadia Semantics (terminology/data/CLI/UI/docs); Model Selection
(pinning profiles); Plan-amendment operator actions (shared runner); Operator
Guide (changed flows also update START_HERE.md); Claude Code specifics
(provider tooling/dependencies); PR QA Plan and Working-Copy
Safety (including automatic production conflict recovery). These rules bind.
Before critical-path production work, read and refresh
`docs/managed-production-readiness.md` as that document requires.

The detailed original procedures remain authoritative in their indexed homes.
Change shared bootstrap wording in docs/agents-context.md and regenerate this
managed region; preserve all adopter-owned material outside its markers.

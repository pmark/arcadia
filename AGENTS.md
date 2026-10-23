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

<!-- ARCADIA_CONTEXT_START -->
## Arcadia Context

<!-- arcadia-bootstrap-v1 -->
Arcadia maintains momentum with minimal operator attention. Checked-in records
govern; database, queue, Issues and dashboards are projections or signals.
Prefer deterministic local scripts, then local AI, then frontier models; use a
coding agent for code. Name Milestone, next Action, Responsibility and Artifacts.

### Ask freely; execution stays governed

Any agent may submit an honest proposal, question, concern or help request through
`arcadia agent-ask preview` with `intent: proposal` and `requested_authority: propose`,
without approval or an executable Action. This is not execution: preview records a receipt,
changes no Project document or queue, and grants no authority. Use the configured workspace
and ordinary host permission path; never bypass denial. A successful preview submits; inline
needs no file. Confirm its receipt; an unregistered draft is not submitted. Read
`docs/agent-guidance/agent-asks.md` for the durable path.
Continue authorized work unless the request exposes a genuine blocker.

### Mandatory retrieval — before the operation

At start read `CONSTITUTION.md`, `PROJECT.md` and the active Plan's exact current Action.
Before broad discovery read `.arcadia/AGENT_CONTEXT_POLICY.md`,
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
authority: no Action, Decision, promotion or rollout; host, privacy and scope gates apply.
Exact same-scope replay deduplicates and records supplied evidence/observations (otherwise a
receipt); similar wording stays separate (no semantic merge). Supervisors harvest when assigned; nobody waits.
Retrieve lessons on demand; Notes is the bounded verified hot cache.

**Read `docs/agent-guidance/index.json` now.** It names task/failure triggers,
exact authoritative paths and when each read is required. Match your next
operation, read its listed procedure **before acting**, and repeat when scope
or symptoms change. Use bounded `rg`, then read matching sections and cited
evidence. Read only relevant procedures; a link or acknowledgement is not a
read. Record loaded instruction paths/bytes and retrieved paths/sections in the
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
- **Economy and truth:** find the vital few first, reuse existing capabilities,
  avoid speculative abstractions. Record defects in their owning repository's
  Issues, signals through Agent Asks, and missing capabilities as proposals.
  Never lose discovered work. Deferrals name a revival trigger; showstoppers
  follow the indexed stop-the-line rule without crossing approval boundaries.
- **Vocabulary:** Domain, Project, Mission, Outcome, Milestone, Action, Artifact,
  Decision, Log. Noun commands read; verbs may mutate within declared authority.

### Instruction budget

The generated bootstrap is limited to **8 KiB UTF-8**; a root AGENTS.md to
**12 KiB**. Default-loading project guidance across root and relevant nested
paths is limited to **24 KiB**, reserving **8 KiB** for global guidance inside a
conservative **32 KiB combined** envelope. Root overrides must retain this bootstrap.
Do not raise provider limits or automatically import the procedural library.
Setup, Way drift and dispatch check delivery; overflow or missing guidance is
an explicit failure requiring a smaller file or repaired adoption, not silence.
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

## Scout project continuation

For “continue the Scout project for Arcadia Studio” or a Scout continuation/handoff request, read `docs/scout/CONTINUE.md` before choosing work. It records the preserved candidate, current gates and evidence; revalidate current authority and expiry before any live attempt. This is separate from an unrelated active Project Action.

## Arcadia skill compatibility

Every new or modified Arcadia skill must support Codex, Claude Code and
OpenCode. Before creating, editing or installing one, read
`docs/agent-guidance/skills.md`; preserve one source and verify discovery for
all three systems. Provider-specific tools must have an explicit capability
boundary and supported fallback.

## Editorial sources

Clara owns user-facing writing within assigned authority. Follow
[article sources](docs/articles/README.md) and
[Clara's method](docs/agent-guidance/session-roles-and-briefs.md#clara-technical-writing):
`docs/articles/` captures agent-oriented topics/evidence; polished public pieces
belong in AMC. This Project-specific direction replaces the older personal
Arcadia Articles folder default; publishing retains its existing gates.

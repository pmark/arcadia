# Action cost evidence: research and proposed Plan

Research date: 2026-10-11 UTC (operator request 2026-10-10 America/Los_Angeles). Operator-directed research/planning only, Issue [#1232](https://github.com/pmark/arcadia/issues/1232). No governed Action is claimed; the active Plan/current Action and queue remain unchanged. Responsibility for implementation, if later activated, is agent. Required Artifacts are additive economic receipts, provider collector fixtures, a read-only Action rollup and reconciliation evidence.

## Outcome and Milestone

The operator can inspect each Action's chosen and observed provider/model/effort, authoritative token usage and generated size, and actual or qualified near-exact cost across attempts, delegates, reviews and failures. Proposed first Milestone: a read-only CLI rollup backed by durable provider receipts reconciles sanitized billing evidence and exposes missing coverage or attribution. The Outcome reflects the operator's explicit request; the CLI checkpoint is proposed and has not been separately approved. Subscription allocation and live billing access are not silently decided.

## Staff planning rationale and ownership

The vital few are an honest additive receipt, capture at existing provider boundaries, deterministic rating/Action rollup, then billing reconciliation. Provider usage is better evidence than counting generated text. Keep one accounting contract over existing Session/attempt/Intelligence lineage and one canonical home for each receipt; capacity allowance observations remain their existing contract. No proxy, harness wrapper, new runner, economic dashboard, or new execution authority is needed.

`docs/plans/provider-capacity-harvesting.md` already proposes `define-provider-usage-snapshot` and `reconcile-and-graph-capacity-use`; those observe allowance/reset windows and capacity-based admission, not request economics. The active governed-role Plan's `project-token-burn-rate` estimates provider reserve crossing, and its attempts/delegation lineage should be reused. A separate **inactive** Action economic evidence Plan with references to both owns this distinct outcome without amending their priorities or duplicating allowance collectors. The strict Plan Ask is a proposal only; settlement/activation require the ordinary governed path.

## Existing evidence and gaps

| Existing owner | What exists | Missing for the outcome |
|---|---|---|
| `src/intelligence/types.ts:278` | `IntelligenceUsage` includes model, input/output counts, estimated/measured USD, duration | Field provenance, pricing basis, cache/reasoning details, scope and attempt association; preserve compatibility rather than replacing it |
| `src/intelligence/claudeCode/textExecutor.ts:86` and `src/intelligence/codex/textExecutor.ts:80` | Existing subprocess boundary retains stdout/stderr, output manifest and timeout recovery | Returned usage currently provider/duration only; normalize real emitted usage including failures without trusting generated manifest token claims |
| `src/intelligence/litellm/httpClient.ts:164` | Response model and prompt/completion counts retained | Available detailed categories and cost provenance are not retained here |
| `src/sessions/index.ts:1410,1457` and `src/sessions/reconciliation.ts:249,531` | Actual managed coding-Session headless JSONL/stream-json launches and existing provider-log exit reconciliation | These are the principal coding-agent economic capture boundary; Intelligence-only instrumentation would miss ordinary managed work |
| `src/sessions/enrollment.ts:34,96` and `src/sessions/roleLineage.ts` | Execution provider/model/effort and bounded role attempts with independent verdict lineage | Launch selection is requested configuration, not evidence of actual responding model/effort; add receipt associations, not a second task/attempt system |
| `src/codingAgents/availability.ts:454` and `src/codingAgents/capacity.ts` | Status/context/allowance telemetry and included/paid/unknown admission semantics | Account context/window totals cannot honestly be assigned to one Action, especially during concurrent work |
| `docs/model-selection.md`, `src/codingAgents/modelTiers.ts` | Chosen logical tier, alias and effort mapping; sessions may start light then escalate | Preserve actual observed IDs per inference span and unsupported effort independently; surname/tier and alias are not actual model proof |

## Current official source findings

Official documents were searched and opened; no live billing account or credential was accessed. Source observations reflect the research date, not a promise that current prices stay fixed.

* Claude Code's session dollar total is computed locally at list or configured contracted rates and remains an estimate. Included Pro/Max subscription usage is not billed per session. Record the total as reported estimate and mode as separately evidenced. [Claude Code costs](https://code.claude.com/docs/en/costs).
* Claude Agent SDK result totals can be cumulative across resumed sessions; `modelUsage` and total cost include subagents whereas top-level `usage` excludes them. Parallel messages can repeat IDs; output placeholders must be replaced by final usage. Crashes can emit zeroed finals, so retain prior evidence and mark partial. Do not sum parent-inclusive totals with children. [Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking).
* OpenTelemetry offers model/session token and cost observations, but cost is approximate. Provider-version-specific duplicate-stream corrections matter. Normal Anthropic input excludes separately counted cache categories. This is an optional supported observation surface, not permission to enable/export telemetry. [Monitoring](https://code.claude.com/docs/en/monitoring-usage).
* Anthropic's organization Usage/Cost APIs require Admin scope. Usage supports time-bucket/model/cache detail; Cost uses daily buckets and decimal strings in cents. Workspace/model/tool scope does not make a bucket a request-level invoice. Use sanitized export first. [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).
* Anthropic pricing depends on model and token category, cache-write duration, batch, tools, speed/geography and other applicable modifiers. Preserve evidence-backed prices/effective date instead of hard-coding an alias or universal cache rate. [Pricing](https://platform.claude.com/docs/en/about-claude/pricing).
* Codex's supported JSONL stream includes `turn.completed` token usage and thread identity. The opened current example includes input, cached input, output and reasoning output counts; each installed CLI version may omit details, and unsupported actual model/effort or billing remains unknown. [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
* OpenAI Responses usage distinguishes cached input and reasoning output subsets. A request can spend reasoning tokens before producing visible output. Never add a subset to its inclusive total again. [Reasoning usage](https://developers.openai.com/api/docs/guides/reasoning), [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
* OpenAI organization Costs reports currency/amount in daily aggregate buckets with project/key/line-item grouping, not Action IDs. Reconciliation must expose attribution gaps rather than declare per-Action billing exact from overlapping buckets. [Costs reference](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs).

These sources support the design; live integration coverage and each installed CLI's actual versioned result shape must be proved when its collector Action runs. API list prices are not subscription invoices. No exact dollar price is asserted here. A provider invocation denied before launch records the orchestration attempt and absent provider usage; it is not a billing receipt showing zero charged.

## Minimal receipt contract to prove first

An additive `action-economic-evidence-v1` receipt should retain:

* Stable receipt and provider request/message/event identity; observed/received times; adapter/CLI version; safe raw-evidence reference/hash; success/error/denied/interrupted state; Action reference, existing Session/Run/role-attempt and parent linkage when available. An unallocated receipt remains visible for later association. Never manufacture a governed Action for operator-directed work.
* Requested provider/model alias/tier/effort and immutable launch/binding reference separately from observed responding provider/model/effort, with per-field source/confidence and explicit unavailable reason. A result's model map proves those model IDs participated, not which one alone performed every role or an unexposed effort value.
* Provider-native usage plus category semantics: uncached input, cache read/write (TTL if price depends on it), output including applicable reasoning, optional reasoning subset, tool/service quantities. Record whether native totals include categories or descendants. Unsupported detail stays null, not zero.
* Scope (`request_delta`, `turn_delta`, `session_cumulative`) and cumulative baseline/reset/resume/fork lineage; aggregation coverage and child-inclusion markers. Stable repeated events count once. Late corrections append references; they do not erase evidence or double charge. Shared parent totals are counted once, while unavailable per-role breakdown stays unavailable.
* Separate monetary basis: provider-reported estimate, deterministic API-equivalent estimate, provider billing-confirmed amount at its actual scope, included subscription mode, or unknown. Preserve currency/decimal units, effective versioned rates and provider/model/modifiers. A per-Action bill is exact only when the billed scope maps uniquely to it; otherwise known totals and unattributed residuals stay qualified.
* Generated UTF-8 bytes and Unicode codepoints, with a hash/reference to the generated artifact. Optional visible-text token estimate names tokenizer/version; it is never substituted for authoritative provider usage. Output bytes count tool/text artifact size but cannot reveal hidden reasoning or price the context/tool cycles.

The first receipt proof should associate one real existing sanitized provider result with the existing Session/attempt or explicitly mark it unallocated, then demonstrate that requested `opus/high` can differ from actual model provenance. This task's specialist result is a candidate fixture only after privacy review. The contract also needs synthetic fixtures for replay, resumed/forked baselines, parent-inclusive delegates, failed/partial streams and late receipt association. No live replay inference is needed to validate arithmetic.

## Session-sized sequence

The strict Ask carries full acceptance criteria and dependencies. Dedicated model-selection fields are not writable in Agent Ask v1; role/tier/size/gate/token recommendations are therefore carried in each Action's desired result, as the planning process requires. Semantic effort recommendations use `e2_standard`; actual provider effort is resolved at dispatch. All implementation remains inactive until the operator settles and activates it.

| Proposed Action | Dependency | Role / size / model effort | Observable proof |
|---|---|---|---|
| `define-action-economic-receipt` | None | Implementer / S / standard, e2_standard | Focused schema/idempotence/lineage fixtures pass; compatibility and missing evidence explicit |
| `capture-claude-economic-evidence` | Receipt | Implementer / M / standard, e2_standard | Actual sanitized provider fixture plus errors/resume/delegate fixtures normalize through existing boundary; no harness changes |
| `capture-codex-economic-evidence` | Receipt | Implementer / M / standard, e2_standard | JSONL truncation/turn/thread fixtures and existing LiteLLM detail compatibility pass |
| `rate-and-report-action-economics` | Both collectors | Implementer / M / standard, e2_standard | Proposed read-only `arcadia action cost <plan>#<action> --json` reproduces golden totals once, reports missing coverage and size separately |
| `reconcile-action-billing-evidence` | Rollup | Implementer / S / standard, e2_standard | Sanitized export fixtures reconcile scope/units and retain unexplained residuals and revisions without account access |

S/M describe complexity inside a single bounded session, not calendar promises. If a collector requires new provider launch architecture, stop and split before implementation rather than turning one Action into a project. Token impact is medium for the implementation sequence: deterministic ingestion, arithmetic, CLI and reconciliation use zero model calls; each activated Action gets one bounded builder pass and independent review, with retries justified by concrete failure. Haiku/light is suitable for later mechanical fixture/docs tasks; standard/Sonnet is the default for these integration Actions; heavy/Opus High is reserved for unresolved cross-provider accounting design or a demonstrated standard-tier failure. These are recommendations, not measured comparative model superiority.

## Decisions and explicit deferrals

No new consequential choice is needed to draft the inactive receipt/fixture/rollup plan. Fixed subscription allocation is optional and remains unavailable; if the operator requests full allocated unit cost, record a Decision with a stated allocation method before displaying it. Live Admin/API billing access, transcript export or telemetry configuration requires a scope-specific operator approval; the baseline imports sanitized exports and does not request credentials. This plan grants no spending, authority change or runtime install.

| Deferred work | Checkable revival trigger |
|---|---|
| Economic dashboard | CLI rollup reconciles three real Actions and operator requests a visual comparison |
| Automatic Admin/API import | Sanitized manual exports materially delay reconciliation and explicit read-only scope/credential Decision is approved |
| Subscription fixed-cost allocation | Operator requests allocated subscription expense and chooses an allocation method |
| Additional provider/multimodal billing adapters | A real Action emits unsupported billable categories; preserve them as unpriced meanwhile |
| Adaptive model selection / quality-cost benchmark | At least ten comparable accepted Actions have coverage-qualified cost, size and outcome evidence |
| Finer attribution of parent-inclusive subagents/background work | A real receipt cannot isolate a materially costly role; do not fabricate the split |

## Session evidence and handoff boundary

Coordinator/author: Codex, not Opus. Initial repository-aware Opus High consultation was rejected by automatic approval review before process execution: the reviewer identified transmission of potentially sensitive repository contents and an internal prompt to external Anthropic without explicit payload/destination authorization. No bypass or unchanged retry occurred; no model ID, session ID, usage or cost exists for that rejected attempt. Root completed a safer conceptual Opus High consultation from `/tmp` with generic requirements only, `--safe-mode` and `--tools ''`; no repository/private context was transmitted. Exact launch/config and safe returned counters are preserved in `action-cost-consultation-evidence-2026-10-11.json`; the model did not verify repository files or official sources. Repository source checking and strict Plan drafting remain Codex work.

Preservation monitor: `/tmp/action-cost-work-monitor.json`, `ok:true`. Initial CLI read failed because worktree dependencies were absent; existing `pnpm bridge:worktree` linked four dependency trees and fixed it without install/network. A draft `--file /tmp/... --dir <worktree>` was correctly refused as outside its repository; inline draft is the supported recovery. Preserve failed receipts in session scratch; no policy weakening.

Instruction retrieval: root AGENTS, Constitution, Project/current `define-governed-role-registry`, all three context policy files, guidance index; planning process, managed documents, agents context, Agent Ask, operator-directed work, standard harness, principles, Git identity, continuation, working-copy safety, PR procedure, arcadia-repository Orientation/Model Selection/Claude Code, semantics and AGENT_ORIENTATION; targeted notes for provider sign-in, sandbox/worktree dependencies, Ask draft/settlement/activation. Skills applied: Arcadia Agent Ask for strict draft/preview, OpenAI Docs for current official provider sources. Byte inventory is recorded below after final artifact generation.

### Retrieved instruction inventory

Bytes are complete file sizes; named bounded sections above were retrieved from procedural files instead of automatically importing the whole library.

| Path | UTF-8 bytes |
|---|---:|
| `AGENTS.md` | 9276 |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31700 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 6393 |
| `docs/planning-process.md` | 13059 |
| `docs/managed-documents.md` | 16111 |
| `docs/agents-context.md` | 7841 |
| `docs/agent-guidance/agent-asks.md` | 22884 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/agent-guidance/standard-harness.md` | 5569 |
| `docs/agent-guidance/principles.md` | 13789 |
| `docs/agent-guidance/git-identity.md` | 5248 |
| `docs/agent-guidance/continuation.md` | 6239 |
| `docs/working-copy-safety.md` | 15818 |
| `docs/agent-guidance/pull-requests.md` | 16922 |
| `docs/agent-guidance/learning.md` | 1636 |
| `docs/agent-guidance/arcadia-repository.md` | 30174 |
| `docs/model-selection.md` | 9476 |
| `docs/arcadia-semantics.md` | 14180 |
| `docs/AGENT_ORIENTATION.md` | 13594 |
| `docs/notes-to-self.md` | 33541 |

Strict Ask draft and replay preview passed. Request `plan-action-economic-evidence-20261011`, proposal `agentask_ab7a3676ca47ed2abb`, capture `capture_f25e7ad9-3080-41bd-9b01-75c7e2b8edff`; replay preview reports `projectWritesPerformed: 0`. No settlement, active Plan change or queue entry was made. The repository file is the durable input handoff; workspace receipts remain in their canonical store.

## Actual specialist consultation and critique

The conceptual consultation succeeded (exit 0, `is_error:false`, no permission denials), session `5ec5bd00-67b9-493f-9a2c-b6e0f9c72ada`. Requested alias `opus`, effort `high`; observed model map contains `claude-opus-5` plus auxiliary `claude-haiku-4-5-20251001`. Returned effort is unavailable. Main usage reports 14,786 output tokens, including 7,211 thinking tokens; 2 uncached input and 5,270 one-hour cache-write tokens. Auxiliary usage reports 1,392 input and 16 output tokens. The parent reported total **$0.423832** is a client-side list-price estimate (Opus $0.42236 plus auxiliary $0.001472), not invoice evidence. The thinking count is a subset of output, and the model totals already belong to the parent total. The JSON evidence preserves the returned floating-point value without pretending extra digits are financial precision.

The call answered both Clock and Action economics; its cost is shared/unallocated overhead, not the full cost charged to each track. Its visible returned text size is separately preserved. This real safe result illustrates why output-only, main-loop-only and selected-alias-only accounting undercounts work. No billable mode, subscription charge or actual effort observation is inferred.

Opus recommended separate billed/estimated/allocated values, requested/observed provenance, immutable evidence, replay protection and cost per accepted result as the routing experiment. Those reinforce the verified design. Its suggested ten Actions, daily authenticated billing job, mandatory subscription allocation and arbitrary 50-Action/2%-for-seven-days thresholds were not adopted: they add scope, require authority or overstate justified precision. The five-Action baseline imports sanitized evidence, retains unknowns and uses golden fixtures plus scope-compatible reconciliation; comparative routing metrics return after enough comparable accepted work.

Independent preliminary critique returned HOLD for two acceptance gaps: Intelligence-only collection could miss the main managed coding-Session path, and synthetic fixtures could pass without real provider provenance/association. Both were corrected in **r2**: collectors now explicitly include managed Session log/reconciliation and Intelligence boundaries; real authorized sanitized provider evidence is mandatory, with an explicit unavailable-evidence blocker rather than fabricated coverage. Disposable fixture lineage tests include development and independent review, while actual production association requires real matching Session/log identity. The original registered r1 proposal remains preserved and unaccepted; r2 supersedes it in this handoff. No authority, private-log access or accounting implementation was added.

Current handoff request: `plan-action-economic-evidence-20261011-r2`, proposal `agentask_d89203864aaa466a4e`, capture `capture_1b014161-83a3-4467-9637-621a053604ad`; strict replay preview confirms zero Project writes and zero required Decisions. Use the r2 file for QA or later settlement; never settle both versions. The older registered draft is preserved only as revision history.

Preservation friction: the app-created assigned worktree initially had detached HEAD. Commit `367e89470` preserved all four artifacts; `git push -u origin HEAD` and PR creation refused because HEAD was unnamed. Recovery creates a named `codex/action-cost-plan` branch at that exact commit before remote preservation; no reset or history rewrite. This is a transport/preservation remedy, not a governance change.

# Arcadia naming: independent review 3

## 1. Your independent view

The existing layers are an optional human profile (Rowan, Ellis, Nadia and others), a registered assignment Role, a domain specialization, reusable Behaviors and their active modes, an authorship capacity (builder/critic), a provider-and-tier signature, and concrete Session/attempt/claim or native-host references. Supervision is a relationship, not another Role; a profile is neither a unique actor nor proof of expertise. The single most confusing thing today is that the generated block says “You are Claudia Mason” and calls other platforms “your teammates,” while the assignment calls the same agent Rowan or Ellis: a signature class is presented as a person, and a platform roster is presented as a live team. Simply replacing that with a persona would still fail unless the block distinguishes the assigned profile, the actual instance reference, and what is genuinely known about other instances.

## 2. Verdict

**HOLD:** the signature/persona separation is sound, but the proposed universal Identity block and design-help promise still assert identity, completeness and expertise that the available records cannot establish.

This is a hold on adopting the briefing as an implementable contract, not on using the existing consultation procedure. Recommendations below decide nothing.

## 3. Findings, most severe first

### F1. A valid signature does not prove which runtime did the work

- **Claim:** the schema's Signature row says “Which runtime and model tier did this?” and “Provable? Yes”; both reviewers treat the signature as proof.
- **Evidence:** `src/codingAgents/agentIdentity.ts:117` accepts supplied platform/tier/capacity strings. `src/commands/identity.ts:72` resolves a supplied tier without inspecting the running agent. `src/codingAgents/agentIdentity.ts:198` maps model first, effort only as fallback. The requested Claude-standard command succeeded in this Codex review and printed Claudia Mason; that is a concrete counterexample to runtime attestation. `docs/arcadia-semantics.md:218` explicitly says names do not authenticate a sender or establish independence.
- **Disagrees with:** both.
- **Why it matters:** two instances can share a signature, and a stale or incorrectly supplied tier can produce a valid signature. Neither a signature nor its Critic prefix proves independent judgment. A tier also does not identify an exact model/version.
- **Smallest correction:** call it an attribution convention resolved from supplied or recorded runtime metadata. State the metadata source and freshness separately; retain exact model/effort where observed. Preserve the signature bytes and historical attribution. Do not infer a tier change solely from an effort toggle when the registered model still determines the tier.

### F2. The teammate list cannot be a complete roster of current people

- **Claim:** replacing “partners” with “teammates” and printing only existing rows achieves exact identification of everyone working alongside the caller.
- **Evidence:** `src/sessions/partners.ts:33` selects prepared/running Sessions by Project, not by shared assignment; prepared is not proof of active work. Lines 46–51 derive a default builder identity from stored model/effort and discard the selected Session ID. Lines 56–62 select claims without retaining their IDs and deduplicate by worktree. `src/db/schema.ts:446` has Session IDs, Plan and Action references, model and provider, but no persona/registered Role/depth columns in the inspected schema. `src/db/schema.ts:169` has distinct attempt IDs, ordinals and actor IDs; the partner reader does not join them. `docs/agent-guidance/session-roles-and-briefs.md`, “Native dispatch,” says native launch is not Session enrollment.
- **Disagrees with:** both; Nadia caught invented personas but not the remaining completeness and identity-capacity claims.
- **Why it matters:** native helpers and interactive peers may be absent; a prepared Session may not have run; a stored model may be stale after a switch. A same-Project row is not necessarily on the same work. A claim is evidence of custody, not a named active person. Missing tables also yield partial coverage, not a complete “none.”
- **Smallest correction:** render “Recorded Project peers, as of <observation>; coverage: <sources/limits>.” Carry existing Session/claim IDs, status, Plan+Action and recorded launch metadata through the projection. Mark capacity/persona/runtime freshness unknown unless independently supported. Show claim-only entries explicitly. Separate known native/interactive peers supplied by a brief from database observations. Never equate an empty partial query with no teammates anywhere.

### F3. “Interactive” and “subagent of X” do not uniquely identify an instance

- **Claim:** the proposed lineage alternatives disambiguate every situation.
- **Evidence:** the briefing's canonical form allows “interactive” in place of a reference; two interactive chats can share persona, signature and Action. Two children can have the same parent. `src/agentRoles/brief.ts:49–51` constructs native assignment from supplied policy labels, and its emitted notice explicitly denies proving actual Session lineage. `docs/agent-guidance/chat-titles.md`, “Title format,” requires the exact parent chat link/ID and says a shared label does not prove parentage.
- **Disagrees with:** both.
- **Why it matters:** “Ask Nadia” can target the wrong instance even after the proposed migration. An eight-character display fragment is not necessarily a unique locator either.
- **Smallest correction:** use a typed instance locator: Arcadia Session ID, host chat ID/link, or host native-agent ID plus actual parent locator. Keep full IDs as link targets; shorten only when unambiguous. “Interactive; instance reference unavailable” is honest but fails exact addressing. Separate instance reference from governed attempt lineage; neither substitutes for the other. Scope Action references by Project/Plan. Print unknown rather than inventing depth 0 or attempt 1.

### F4. Role plus arbitrary specialization cannot derive persona reliably

- **Claim:** the brief can derive persona from Role plus specialization without a binding rule or extra input.
- **Evidence:** `src/agentRoles/brief.ts:10` makes specialization optional; lines 57–61 accept a free-text label, not an enum. Its returned JSON already includes `specialization` (so the schema's “Machine field: none” is wrong). `docs/arcadia-semantics.md:175` maps researcher to Mira or Vida, implementer to Ellis or Clara, and allows composable methods. `docs/agent-guidance/session-roles-and-briefs.md`, “Composable specializations,” explicitly records the profile in Task prose and forbids new role-brief JSON fields today.
- **Disagrees with:** both, including Rowan's proposed Role-plus-specialization repair.
- **Why it matters:** “technical writing about system health” does not mechanically distinguish writer, investigator and assessor. Role IDs constrain the assignment; they do not determine the name the operator chose. Adding Iris makes planner ambiguous too.
- **Smallest correction:** retain an explicit, optional profile binding in existing Task prose; report it only when the binding is available. Omit persona from a generic machine Identity block. A role brief can keep Role and specialization without guessing a profile. Do not add a Session column merely for display: if automatic addressing later becomes required, propose a structured, revisioned assignment binding and a supported reader as separate scoped work. Default Rowan only when the existing default's preconditions are known; `identity resolve` has no such context.

### F5. “Capacity follows Role, never chosen by hand” contradicts the supported critique path

- **Claim:** identity capacity is always derived from the registered Role.
- **Evidence:** `docs/agent-guidance/git-identity.md`, “Agent Git Identity,” says launched Sessions bind builder and an agent producing critique resolves critic manually; an agent fixing the criticized work uses builder. `src/commands/identity.ts:50` documents this artifact-sensitive choice. `src/agentRoles/brief.ts:53` derives the default from the Role only when generating that kind of brief.
- **Disagrees with:** both.
- **Why it matters:** a Lead can provide adversarial feedback without becoming a separately admitted plan-critic. Conversely, using a critic signature never admits independent review or makes self-review independent.
- **Smallest correction:** say “Registered role briefs supply their configured capacity; other permitted critique uses the documented critic resolver. Resolve capacity for the actual artifact and assignment, without claiming a new Role or independence.” Keep `identity_role`, `identity.role` and the existing `--role` API. The reviewer variant remains deliberately minimal; document that it is an exception to universal teammate visibility, not a fulfillment of it.

### F6. The agreed export rename collides with an existing, different API

- **Claim:** rename `agentTeammates` to `agentRoster` so stale call sites fail.
- **Evidence:** `src/codingAgents/agentIdentity.ts:258–309` already defines `AgentRoster`/`agentRoster()` and separately `AgentTeammates`/`agentTeammates(identity)`. The former returns all signatures; the latter returns self plus other platforms. `src/commands/identity.ts:33,88` exposes nested `teammates` JSON, while line 130 already uses `agentRoster` for the roster command.
- **Disagrees with:** both.
- **Why it matters:** a simple rename produces a duplicate symbol or silently changes function shape/meaning; replacing exported types or JSON keys can break tools outside the checked repository. Atomic repository changes do not prove atomic installed adoption.
- **Smallest correction:** reuse the existing roster API in display rendering. Preserve legacy machine fields until a documented compatibility migration is justified; label their legacy platform-roster meaning. Do not repurpose `teammates` JSON to live Session rows under the same shape. Update prose/tests together, preserve released compatibility, and report installed adoption separately.

### F7. Lead is an immediate operational ambiguity; generic “agent” is not

- **Claim:** Lead, agent and design can remain undifferentiated open collisions while the rest becomes exact.
- **Evidence:** Decision 0112 approves a developing Lead. `docs/agent-guidance/native-app-sessions.md:23–26` explicitly restricts the native-app Lead to non-product-code work, with an implementer as sole writer. `docs/arcadia-semantics.md:177` permits Ellis to be planner or implementer. Decision 0114 constrains delegation by Role and depth, not persona.
- **Disagrees with:** both on leaving Lead open; neither on keeping the technical IDs.
- **Why it matters:** two agents with the same `lead` label can read different mutation rules; “Ellis, fix X” cannot silently reassign custody, and “Ask Nadia” cannot select one of several matching instances or bypass the existing Lead.
- **Smallest correction:** bind the applicable operating contract, actual owner and sole writer in the brief now. Keep the native-app exception explicit until an operator Decision reconciles it; a naming change must not remove it. Resolve requests by task/function, then existing owner/instance, then Role and permitted route. Ask only when ambiguity materially changes the target or scope. Qualify engineering design versus experience/field design now for routing, without reserving the word design for Iris. Defer renaming generic `agent`, Agent Ask and Claude Agent: revive only on a concrete misrouting or API-change requirement.

### F8. Iris is an optional address, not an assurance mechanism; the Behavior rejection is too broad

- **Claim:** an expert persona plus a guide makes design help expert in any field; design cannot be a Behavior because it lacks triggers/stops.
- **Evidence:** revision 7:75–84 says no-guide expertise is general knowledge/inference; REQ-006 requires guide provenance, REQ-013 attribution, REQ-014 resumption. None validates domain expertise. Revision 7:276 still describes a Behavior despite the naming briefing dropping it. `docs/arcadia-semantics.md:130` defines a Behavior as a bounded procedural contract; `docs/agent-guidance/consultation.md` already supplies request triggers, bounded passes and stop conditions.
- **Disagrees with:** both on rejecting a bounded design-help procedure as a possible Behavior; Rowan on persona being necessary for reach; neither on field specialization being separate.
- **Why it matters:** naming cannot turn an unfamiliar field into expertise. Conversely, the sustained record method is a repeatable procedure, not merely the label “website design.” Mixing these obscures what the operator can rely on.
- **Smallest correction:** function-first design consultation, with a field specialization and optional Iris handle. The sustained record procedure can be a documented method/Behavior once its trigger, allowance and stop are explicit; a bare field name is not one. No new registered Role. Recommend Iris as an optional named profile if the operator wants a stable conversational handle, subject to an explicit Decision citing 0068's revival question. This helps addressability, not expertise, authority or independence. Specialization-only remains fully usable by function. Do not require a named persona to provide advice under existing authority.

### F9. The universal reach and continuity promise has two unresolved dependencies

- **Claim:** “from anywhere,” across harnesses, sessions and owners, can be delivered by the naming model and current consultation alone.
- **Evidence:** `docs/agent-guidance/skills.md:9–25` requires installed same-source discovery, not merely a file in this repository. Consultation's final paragraph distinguishes source instruction from native behavior/host enforcement. Revision 7:310–326 explicitly leaves the pre-Project brief home, mobile linking, non-operator owners and attachment storage open. `docs/agent-guidance/operator-directed-work.md`, “Requests that arrive remotely,” treats remote messages as signals because sender verification is insufficient.
- **Disagrees with:** neither as a claim already proven; both must close these gaps before promising the addendum's outcome.
- **Why it matters:** an unrelated chat cannot discover uninstalled guidance; a phone capture is not a launched designer; a temporary file is not a resumable shared Artifact. A co-owner's preference is not the Arcadia operator's approval.
- **Smallest correction:** distinguish request acceptance, procedure discovery, authorized execution, durable record and delivered answer. Show “captured, awaiting routing” when that is all that happened. Resolve one durable pre-Project Artifact location and locator before promising sustained resumption; keep the original capture linked. No duplicate brief per harness and no inferred co-owner approval.

### F10. Collision cleanup should not become unnecessary API or authority work

- **Claim:** one Decision and a “docs PR” sufficiently describe the whole migration; avoiding the supervisor person noun is essential.
- **Evidence:** Decision 0121 explicitly permits an event-triggered model-bearing supervisor, amending 0113; `.agents/skills/arcadia-supervisor/SKILL.md`, “Enter or resume,” requires an actual assignment. The Constitution reserves authority changes and important Decisions to the operator. Existing Role keys are the approved 0100 taxonomy; display text is not itself an authority grant.
- **Disagrees with:** both on treating “supervisor” as necessarily non-personal and on collapsing all changes into one undifferentiated approval.
- **Why it matters:** an assigned agent may perform supervision; what is false is asserting a currently running supervisor from a relationship default. Mechanical vocabulary edits do not require a new authority Decision, while schema/API/runtime work needs more than a docs label.
- **Smallest correction:** retain relationship/function/assigned invocation as distinct usages. Group related naming choices for convenience but keep Iris, API migration, Lead semantics and design storage choices separable. Docs-only clarifications preserving approved meanings can use a normal docs PR; unresolved product choices and changes to approved authority need operator Decisions. No guidance here approves launch, merge or publication.

### Collision audit and cost of the smallest correction

All briefing rows were checked: identity, role/capacity, Critic, teammates, partners, profile, Supervisor, Lead, agent, Session and design have the cited distinct meanings. Additional consequential collisions are **signature versus authentication**, **instance reference versus governed lineage**, **assignment versus runtime**, **designer advice versus independent design review**, and **Owner of a design choice versus mutation owner/operator** (revision 7, Terminology). “Role: what may it do?” must mean eligibility, not a permission grant. A Behavior's mere inclusion in a brief does not prove it was activated or followed.

| Change or meaning | Smallest affected surfaces | Cost/breakage and deferral |
|---|---|---|
| identity profile → persona; signature vocabulary | Semantics, identity and role guidance, index trigger synonyms, applicable skill prose | Docs change; keep old phrase as discovery synonym during adoption. No signature or JSON rename. |
| teammates/partners display → recorded peers; roster display | Identity renderer, partners projection, CLI renderer, identity-block/identity-command tests and role snapshots; guidance | Small code change plus docs; preserve unknown states and command/reviewer variants. Legacy JSON remains documented until a separate migration. |
| existing IDs retained in peer projection | `AgentPartner`, `partners.ts`, renderer and focused tests; source IDs already exist | No DB migration needed for Session/claim IDs; do not claim attempt/depth without a supported link. Tests need same-signature peers, partial tables, prepared rows, no-row peers and unknown capacity cases. |
| persona rendered from explicit assignment | Task/Context prose today | No new JSON/DB field now. Revive structured binding when a consumer must automatically resolve or address persona instances; then define input, validation, versioning and migration together. |
| capacity terminology | Guidance only; current role brief already says capacity | Keep enum, keys and flag. `--capacity` alias is optional future API work with conflict handling and tests, not needed for clarity. |
| Nadia title / fixed Git names | No change recommended | Renaming fixed names changes emails/signatures and future history continuity. Never rewrite historical commits. Renaming Nadia adds no demonstrated value. |
| Behavior activity names | Guidance and skill prose if needed; index synonyms | Keep `arcadia-supervisor` and `arcadia-hacker` IDs/paths. Any modified skill still requires same-source three-harness checks. |
| Lead scope clarification | Role/native-app guidance and brief Context/Ownership | Docs can expose existing restriction. Removing it or changing registry eligibility needs an operator Decision and governed implementation. |
| Iris and engineering/field design distinction | Profile table, role guidance, consultation routing, design skill description and index | Optional Iris Decision; field specialization already supported. No per-persona skill or role enum expansion. |
| titles/pings | Optional display wording after workstream/state; canonical source references | No persona as unique recipient ID. Keep signatures, parent links and notification authorization/deduplication. Inspect ping implementation before changing it; not reviewed here. |

**Operator surfaces:** chat titles may append a known persona plus task when useful, but preserve the contact star/helper arrow, kind/state and workstream first; persona is optional text shortened first. `chat-titles.md` already permits “role or task” detail, so “titles carry Plan and state only” is inaccurate. Discord FYIs may say “Ellis · task” with an exact existing link and the required signature; a name alone must never route a message. Do not ping merely to announce this review.

## 4. The situation walk-through

Answers assess the proposed block as written, not the corrected future implementation.

| Situation | Can it name itself exactly? | Can it name each teammate exactly? | What is missing |
|---|---|---|---|
| Launched Session | Partly: signature class and Session row, not necessarily current persona/runtime/capacity | No | Explicit assignment binding; retained peer IDs/status/Plan; freshness, coverage and supported attempt link. |
| Interactive session | No unique locator from “interactive” | No | Host chat ID/link and actual assignment; no automatic Arcadia row or live-team inventory. |
| Native subagent with no Session row | Not from “subagent of X” alone | No | Actual child and parent host locators, brief source, runtime evidence; no invented Session/attempt admission. |
| Read-only reviewer posting nothing | Signature attribution only; intentionally not a team identity block | Intentionally no | Explicit privacy/minimal-context exception; independent assignment evidence belongs outside the name. No forced signing command or developer roster. |
| Mid-session model-tier change | Only after resolving from actual new runtime metadata | No guarantee | Old inherited environment and stored peer model may be stale; re-resolve before commit/comment, retain old artifact attribution. Persona/instance does not change merely because tier changes. |
| Two Sessions using same persona | With distinct full Session locators, yes; name/signature alone no | Current projection loses the needed IDs | Carry and link full instance references; scope tasks by Plan/Project; do not assume short IDs unique. |
| Delegated implementer under Lead | Conditional on actual native-launch or Session evidence | No complete inventory | Explicit child ID, parent reference, depth source, sole-writer handoff; labels in role brief prove eligibility only. Lead pauses edits. |
| “Ask Nadia to check this” / “Ellis, fix X” | Name identifies a profile/function, not one actor | Not without assignment lookup/context | Resolve which artifact and existing owner/instance; bind plan-critic versus planner/implementer and authorized route. Same person cannot self-certify independence; do not launch by name alone. |

## 5. Corrections to the schema table

Only changed rows follow, with the briefing's exact columns.

| Element | Answers | Examples | Source of truth | Set by | Provable? | Grants? | Machine field | Canonical term |
|---|---|---|---|---|---|---|---|---|
| Signature | Which platform/tier/capacity is this artifact attributed to? | Claudia Mason with canonical email | Identity table plus supplied/recorded metadata | Resolver; refreshed for actual runtime | Mapping yes; runtime/authorship not by name alone | No | `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, comment signature | **signature** |
| ↳ given name | Which coding platform is attributed? | Cody / Claudia / Owen | Identity table | Supplied or recorded platform | Mapping yes; not runtime attestation | No | `--agent`, identity `agent` | **platform** |
| ↳ surname | Which tier is attributed? | Swift / Mason / Atlas | Tier/name mapping and relevant registry | Model lookup, effort fallback or explicit tier | Conditional on input and registry freshness | No | `--tier`, identity `tier` | **tier** |
| ↳ Critic title | Which authorship capacity applies? | Critic Claudia Atlas | Identity rules; registered Role default where applicable | Actual assignment/artifact; explicit resolver for critique | Attribution, not independence proof | No | `identity_role`, `identity.role`, identity command `--role` | **identity capacity** |
| Lineage | Which instance, parent and governed attempt are evidenced? | Session ID; host chat/child ID; scoped Action; attempt ID | Existing Session/claim/attempt records or host launch receipt, each identified | Actual records; supplied policy labels kept distinct | Only recorded links; missing remains unknown | No | Existing IDs and explicit brief references; no universal field | **lineage**, with **instance reference** distinguished |
| Role | What assignment eligibility applies? | Seven registered IDs | Registry plus assigned brief | Explicit assignment/default in its applicable scope | Brief proves assignment intent, not runtime admission | No authority; defines eligibility only | Role ID; distinct attempt role and identity capacity | **Role** |
| Persona | What optional handle names this assignment? | Rowan — Coordinator; Ellis — Engineer | Explicit Task binding and canonical profile table | Assignment, not reverse inference from free text | Binding can be evidenced; expertise cannot | No | Existing Task prose; no universal structured field | **persona** |
| Behavior | Which bounded method is assigned or active? | supervision; hacker recovery; bounded design consultation | Method source plus actual assignment/evidence | Trigger and applicable authority | Assignment and performance separately evidenced | No | Skill reference where used; not a universal activation field | **Behavior** |
| Mode | What procedural state is reported? | recovery mode | Applicable Behavior and current evidence | Actual activation | Only if supported; not inherently unprovable | No | No universal field | **mode** |
| Specialization | Which domain/method narrows the assignment? | website design; technical writing | Assignment brief | Assignment | Assigned label yes; expertise no | No | `RoleBriefInput.specialization`, returned `specialization`, Task/Context | **specialization** |
| Roster | Which attribution combinations exist? | Platform × tier × capacity | Existing `agentRoster()` and identity table | Data | Yes | No | Existing `AgentRoster`, `agentRoster()` | **roster** |
| Teammates | Which relevant peer instances or claims are recorded? | Session ID/status or claim ID; separately supplied host peers | Identified source observations with time and coverage | Existing records/explicit briefs | Partial observations, not universal live-team proof | No | Current partners projection, extended with existing IDs; legacy API kept distinct | **teammates** in conversation; **recorded peers** in projections |

## 6. Decisions for the operator

These are review choices, not filed or answered Decisions. No immediate reply is needed to complete this review.

1. **How far to automate persona identity:** **A (recommended)** — retain explicit Task binding, omit unknown persona from generated blocks, and expose existing locators; cheapest truthful fix. **B** — fund a structured assignment binding and resolver now; enables automatic display/addressing but adds schema/API and migration scope.
2. **Iris:** **A (recommended)** — optional “Iris — Designer” profile invoked primarily by function, on the existing planner Role, with field specialization and record method; preserves addressability without a new executor. Record a Decision addressing 0068's revived need before adoption. **B** — keep design-help specialization only; same capability, no dedicated named handle. **C** — new registered designer Role; requires a demonstrated gap, taxonomy/authority Decision and runtime work; not recommended.
3. **Naming migration:** **A (recommended)** — approve display vocabulary/coverage correction, preserve signatures and machine compatibility; limited implementation. **B** — rename exported APIs/JSON as well; additional consumer inventory and compatibility plan required. No `agentTeammates` → existing `agentRoster` blind rename.
4. **Lead:** **A (recommended now)** — make the current native-app exception explicit in each applicable brief; no authority change. **B** — harmonize mutation rules across transports; requires an operator authority Decision, revised guidance and proof before agents rely on it.

Ordinary explanatory docs changes need a docs PR, not a freshly invented Decision for every synonym. Changing what the agents may do, introducing a disputed new persona/workflow, or reversing 0068's chosen deferral requires the governed operator path. Neither this report nor an accepted proposal is approval. A single naming Decision may carry several separately answerable choices; do not bundle storage, deployment or new delegation permission into it.

## 7. Where the briefing is right

Keep persona and signature separate; use concrete references for concurrent instances; never infer a peer's persona; preserve the authority/operator/workspace rules and the minimal reviewer variant. Keeping the seven Role IDs, fixed signature names, capacity keys and existing skill IDs avoids needless breakage. Function-based requests and existing brief fields are the right starting point. The revision-7 separation of owners' words, evidence and attributed advice is valuable and does not require a new executor.

## 8. Limits of this review

Reviewed source checkout HEAD: `b6974693dde42df1a3303543a64b0ea2a36d689c`, 2026-10-29. Scope: independent plan-critic, direct operator assignment, read-only repository. The active Project Action is `make-arcadia-go-orient-one-caller-truthfully-before-authorized-work#repair-host-owned-source-completion-capabilities`; it concerns host completion capabilities, not this naming proposal. No Action, claim, persona-instance admission or attempt is claimed here.

The required `pnpm -s arcadia identity resolve --agent claude --tier standard` exited 0 and returned Claudia Mason/builder, the platform “teammates” line and workspace rule. It was a requested demonstration, not this reviewer's signature. The independent paragraph above was written before opening the briefing/history files and has not been edited.

No tests, live Session/claim database reads, launch, messages, postings, skill installation, Git changes, or governance mutations were performed. No simulation files, production adoption, remote sender identity, cross-harness native discovery, or quoted settlement receipt were independently verified. Proposal/history claims about those remain attributed claims. No general design best-practice assertions were researched: this review evaluates the proposed provenance and assurance contract, not the quality of any actual guide. No external sources were needed for that bounded comparison.

Source inspection supports the specific schema/reader limits above, not a claim that every identity-producing consumer was audited. Some early combined tool output was truncated; the decisive identity, registry, partner, role-guidance, Decision and design passages were subsequently retrieved in bounded reads. Targeted Notes lookup found no naming-specific remedy; unrelated identity/preservation matches were not used as authority. Durable learn capture, ledgers, PRs, title changes and remote reports were intentionally excluded by the prompt's stricter read-only/one-output-file boundary. The required output is the sole written file.

Instruction-source inventory (UTF-8 source bytes; source sizes are not token usage or proof that an initially truncated tool result was fully visible):

| Loaded instruction source | Bytes |
|---|---:|
| `CONSTITUTION.md` | 3320 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 8771 |
| `.agents/skills/arcadia-role/SKILL.md` | 11841 |
| `docs/agent-guidance/git-identity.md` | 5248 |
| `docs/agent-guidance/session-roles-and-briefs.md` | 15378 |
| `docs/agent-guidance/consultation.md` | 6588 |
| `docs/agent-guidance/chat-titles.md` | 6539 |
| `docs/agent-guidance/skills.md` | 3305 |
| `docs/agent-guidance/operator-directed-work.md` | 4536 |
| `docs/agent-guidance/learning.md` | 2458 |
| `.agents/skills/arcadia-supervisor/SKILL.md` | 5893 |
| `.agents/skills/arcadia-hacker/SKILL.md` | 2024 |

Additional targeted retrieval: PROJECT frontmatter; active Plan Action at lines 160–179; semantics Behavior/profile sections at lines 128–225; repository guidance Orientation and Semantics; planning-process opening requirements; native-app Lead/implementer lines; Notes identity/naming matches; Agent Orientation schema source-of-truth section; the six requested Decisions; role registry and identity/partners/brief/schema/command source sections cited above; requested briefing, proposal history, critique and full design revision 7. The supervisor and hacker skills were read as review evidence, not invoked as supervision or recovery.

## 9. Design help from anywhere

### Context walkthrough

The following is the recommended contract, with current versus proposed capabilities explicit. The same natural-language request should work in all three harnesses once the portable procedure is installed; identical request semantics do not imply identical dispatch tools or current availability.

| Context | What is typed or briefed | What loads | Field selection | Record kept where | Assurance shown | Gaps |
|---|---|---|---|---|---|---|
| Coding-agent chat in/out of repository, during other work | “I need design help with this onboarding flow.” For persistence: “Keep a design brief for this.” | Existing consultation/role guidance; proposed portable design-help skill/core and selected guide. Existing work assignment retained. | Agent proposes interaction/onboarding design from the artifact, audience and intended experience; confirm only material uncertainty. | One-off answer in current authorized handoff/chat; sustained work in one designated durable Artifact with its locator returned. | Guide name/revision/scope; sources, owner practice and inference distinguished; uncertainties and suggested test. | Outside this repo, installation/discovery is not guaranteed. Missing skill means preserve request and disclose limitation, not claim Arcadia Design ran. Do not silently transfer code ownership or start a second writer. |
| Mobile capture, Discord reply or Agent Ask | “Design help: make onboarding less confusing. Context: <link>. Quick opinion” or “Keep/resume brief <locator>.” | Existing capture/routing first; designer loads the same procedure only after a supported authorized route accepts the assignment. | Use linked artifact; ask one concrete field question if routing changes. | Original capture/Ask receipt links the eventual brief; no parallel chat-only source of truth. | First show captured/queued versus actually answered; eventual answer cites the guide and evidence. | Mobile-to-brief linking is deferred in r7. Remote signal is not verified operator authority. No universal immediate-response or delivery guarantee; verify actual response delivery through existing authorized channel. |
| Ellis, Clara or Rowan needs design judgment mid-task | Brief: “Design advice on <uncertainty>, field <x>, source revision <r>, read-only, output recommendation and limits; owner <ref>; independent opinion required/not required.” | Consultation plus design method/guide. Depth-one delegate hands request to Lead; Lead uses existing authorized route. | Ellis: interaction design; Clara: information/editorial structure; Rowan: product/experience framing. Confirm overlap rather than forcing all into website design. | Current assignment's report/handoff; promote to the single design brief only when sustained work is requested. | State self-advice versus fresh independent opinion, guide coverage and source of conclusions. | Consultation is a method, not a transport. Self-application is not independent review; a delegated agent cannot spawn another child. |
| Resuming last week's design in another harness with co-owner | “Resume design <durable locator>; <co-owner> is here. Read back what changed and what needs our agreement.” | Pinned brief top section first (REQ-014), then relevant originals/evidence and guide revision; current skill/procedure. | Retain recorded fields; make any change explicit and check applicability of old advice. | Same canonical Artifact and attachments; stable locator supplied in every handoff; one current writer. | Last confirmed version, changed interpretations beside originals, per-owner agreements and missing agreements, due items, guide freshness. | Pre-Project home, attachment storage and co-owner access are unresolved. Attribution is not authentication or permission to settle Asks. No shared-memory claim based on Iris. |
| Field without a guide: song or physical product | “Design help with this song/product; what can you advise without a guide?” | Generic core and consultation; authorized source research if useful; no invented guide. | Identify experience target and relevant fields; physical product may need separate ergonomics/materials/safety expertise. | One-off response or same sustained Artifact policy. | Say up front “No validated guide; general-knowledge inference”; distinguish researched sources from inference, confidence and limitations. | Do not refuse all brainstorming. Refuse unsupported assurance; obtain qualified evidence before consequential recommendations. Expert label alone is no basis for confidence. |

### Recommended invocation model (ten lines)

1. Recognize “design help,” “designer,” “design advice,” “critique this design,” and “resume/keep a design brief”; Iris is optional.
2. Resolve the question, artifact, owner, field and output using available context; ask only when ambiguity changes the advice.
3. Load the portable design procedure and applicable field guide; report missing guidance before relying on general knowledge.
4. Default a bounded question to a quick design consultation; “keep/resume a brief” requests sustained design facilitation.
5. Quick advice stays in the existing handoff; promote it by linking the original words and attributed advice into one confirmed brief.
6. Bind the existing Role, field specialization, ownership and allowance; a persona or skill selects no provider and grants no authority.
7. Self-applied guidance is allowed within assignment but is not an independent second opinion; route independent help through the Lead.
8. Show guide/version/scope, material sources, operator practice, inference, confidence and unresolved disagreement.
9. Resume from the brief's top section and original evidence; preserve each owner's versioned agreement and keep one writer.
10. Stop at the bounded answer, agreed session end or named gap; ready designs yield governed proposals, never self-approved work.

### One invocation, two depths

Use **design consultation** for a bounded question, and **design facilitation** for a sustained conversation maintaining a design brief. The operator chooses in ordinary language, not with a required mode picker. The first can grow into the second when continuity becomes useful: return a proposed durable destination, preserve the original exchange by reference, distinguish advice from owner statements, and confirm changed interpretations. Do not force the full r7 record onto “Is this layout confusing?” or silently make a throwaway answer a permanent Project.

The operator types a function. An agent writes a Role-bound consultation brief with a field specialization, required independence and output. The harness loads a reusable skill/procedure; it does not launch a human name. Iris can be the conversational handle for this purpose. The sustained record method is distinct from the field specialization and can sit beneath Consultation without another registry.

For a game's website, separate the website's navigation/conversion experience from the game's mechanics/player experience. Use both guides for their relevant parts; one bounded adviser may combine compatible methods. If the advice conflicts, show the tradeoff against the owner's experience target. Ask the owner only where the chosen priority changes the recommendation. Do not silently select a competing framework on the owner's behalf; r7 REQ-006 reserves that decision.

### Assurance that can honestly be promised

Recommend: **“You can request design help from any supported surface; the answer shows which field guidance and evidence it used, where they fit, and what remains uncertain.”** Best-practice compliance cannot be guaranteed for every field, especially with no guide or an unreviewed guide. Provenance is necessary but not sufficient: a citation may be irrelevant, outdated or misapplied, and operator ratification does not turn it into expert validation.

For material recommendations, show the guide's title/revision and applicability, the source passage or evidence supporting the claim, whether it is cited source/operator practice/agent inference, confidence with a reason, and a cheap observable test. Keep this concise in the answer; place detailed traceability in the brief. Mark taste as taste. No guide means disclose that fact at the start and offer bounded exploratory advice, not fabricated assurance or a blanket refusal.

Catch shallow/wrong guides through source verification, counterexamples, competing frameworks, domain-qualified independent review where needed, and observed user/probe outcomes. A provenance-format validator catches missing labels, not incorrect advice. Before a guide is treated as validated, define its scope and test cases, retain failures and review dates, and revise or withdraw unsupported recommendations. R7's simulated record-fidelity results are useful hypotheses; they do not establish real-user usefulness or domain-best-practice coverage. Its Milestone 1 already recognizes that limit.

### Authority, independence and delegation

The invocation changes no provider binding, budget, launch authorization, Action, queue, claim, production gate or permission to settle an Ask. A designer can examine and improve its own design, but must label this self-check. A fresh design/brief critique uses an independent plan-critic (optionally Nadia) with the relevant field specialization. Sage is for code/candidate defects and Quinn for acceptance evidence; neither name supplies field expertise. An independent field opinion may use another appropriately assigned adviser, but must not be presented as a governed code-review/QA gate without its required separate Session and evidence.

| Route | When to use | Truthful identity/lineage |
|---|---|---|
| Same agent follows guidance | Bounded advice compatible with current assignment; no independent opinion claimed | Same instance and actual Role; field/method noted in Task/Context. No new parent, Session, attempt or persona inferred. |
| Authorized native helper | Top-level Lead needs bounded specialist help; eligible role and depth under 0114 | Host child ID + actual parent ID, Role, assignment and observed runtime if available; Arcadia Session/attempt explicitly unrecorded unless separately proven. No child delegation. |
| Separate authorized Arcadia Session | Supported admission/launch is available and needed, particularly registered review/QA | Actual Session and linked attempt/admission evidence only; no invented link from profile or brief. Existing separate-Session constraints retained. |
| Consultation request/Agent Ask awaiting route | Needed helper unavailable, unauthorized or unsupported | Request receipt/brief locator and status, no claim that a designer is running or advice delivered. |

### Smallest required artifacts

| Artifact | Exists today? | Smallest addition |
|---|---|---|
| Portable skill for design help | Not established by this review; r7 is proposal evidence, not an installed skill | One function-named skill, e.g. proposed `arcadia-design`, with core/field references; no per-Iris skill. Stable personal install for out-of-repo use; repository same-source `.agents/skills` and `.claude/skills` exposure. Verify all three runtimes separately from filesystem checks. |
| Trigger index and discoverable description | Consultation and role triggers exist; inspected index has no dedicated design-help entry | Add design-help/designer/onboarding/design critique/keep or resume brief triggers; field-specific terms route through context to avoid treating every code “design” mention as facilitation. Keep optional Iris and old identity-profile synonyms. |
| Consultation extension | Consultation exists | Add the design-advice field-selection route and pointer to the sustained method; preserve existing launch/independence limits and ordinary briefs. |
| Field-guide format | Requirements exist in r7; format/home remain open | Scope, revision/review date, source and provenance/confidence per entry, applicability limits, competing frameworks and validation examples. No guide remains a supported disclosed state. |
| Durable brief home and locator | One checked-in Artifact is proposed; pre-Project home unresolved | Choose one accessible owner-approved versioned home and stable locator, record originals/attachments and one writer. Link capture and future Project to it; do not copy a canonical brief into each harness. |

For an existing Project, use its authorized Artifact destination and custody rules. Before a Project exists, recommend one operator-owned versioned design-artifact location registered by an unscoped intake reference if that route is supported. This is a proposed policy, not an existing resolved path. If no home is configured, provide quick advice now and preserve the sustained request; resolve the destination before promising cross-session durability. A chat-only link or `/private/tmp` file is insufficient to satisfy the proposed checked-in brief contract.

### Lettered design Decisions for the operator

- **A1 (recommended):** one function-based entry with quick consultation and optional sustained facilitation. Consequence: low friction for small questions, explicit durable-record work for larger designs. **A2:** always maintain a full brief. Consequence: simpler uniform procedure but unnecessary burden for one-off advice.
- **B1 (recommended):** promise visible provenance, applicability and uncertainty across supported surfaces. Consequence: useful advice remains available without a guide, with honest limits. **B2:** promise validated best-practice coverage only in reviewed guide scopes. Consequence: stronger assurance within that scope, unavailable assurance elsewhere; still no universal expertise guarantee.
- **C1 (recommended before sustained pilot):** choose one durable operator-owned pre-Project Artifact home and discoverable locator. Consequence: cross-harness/co-owner resumption becomes testable. **C2:** restrict the pilot to existing Projects. Consequence: cheaper implementation but explicitly fails “outside any Project” until this decision is revived by the first such request.
- **D1 (recommended):** function-first with optional Iris as in section 6, and one portable design skill. Consequence: no name memorization or persona-derived authority. **D2:** function-only specialization. Consequence: equally usable help without a stable named designer handle.

These choices do not settle r7's existing architecture, guide authorship, operator-probe representation or revival Decisions. Reconcile the draft's remaining “Behavior” language and attach the selected invocation/storage/assurance requirements before any implementation Plan is treated as complete.

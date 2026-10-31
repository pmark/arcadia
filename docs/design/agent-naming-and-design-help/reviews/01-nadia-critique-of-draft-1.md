# Critique: unified agent naming proposal (draft 1)

Nadia — Critic (plan-critic). Read-only; sources read at the primary checkout
`/Users/pmark/Dev/MR/Arcadia/arcadia` on main (b6974693d). `pnpm -s arcadia
identity resolve --agent claude --tier standard` run read-only; its Identity
block is quoted below.

Verdict: **PASS WITH CHANGES** (three required changes at the end).

Where the proposal is right: the signature/persona split is real and correct
("identity profile", docs/arcadia-semantics.md:157 vs "semantic agent Git
identity", docs/agent-guidance/git-identity.md:3-13); realigning "teammates" to
mean live co-workers matches the operator's own usage and the stated goal;
"only the signature proves anything" matches semantics.md:218-224 and
`IDENTITY_AUTHORITY_RULE` (src/codingAgents/agentIdentity.ts:214-215); the
persona line carrying `(role: lead)` is the right shape because Ellis maps to
two Roles (semantics.md:177).

## Findings, most severe first

### 1. The proposed "Teammates on this work" line cannot be produced from recorded data; it would be invented
Claim: `Teammates on this work: Ellis — Engineer as Cody Atlas (session …)` requires a persona and a registered Role per live Session. Nothing stores either.
Evidence: `agent_sessions` rows read for partners carry `id, provider, model, effort, action_id, worktree_path` only (src/sessions/partners.ts:33-36); claims "record neither" platform nor tier (partners.ts:16-21); `describePartner` deliberately reports "tier unresolved"/"an unattributed claim" rather than guess (agentIdentity.ts:271-277). Persona is only ever prose in a brief's **Task** field (session-roles-and-briefs.md "In the existing Task prose, identify the profile and task"). Interactive and native-subagent sessions have no `agent_sessions` row at all (git-identity.md:36-40; session-roles-and-briefs.md "Native launch evidence ... does not claim, enroll or reserve an Arcadia Session").
Why it matters: the proposal's own rule says a persona "never proves who did the work"; a generated block that asserts "Ellis as Cody Atlas" from no record breaks that rule inside the one block agents are told to trust, and for interactive/subagent teammates there is no "session …" to cite.
Smallest correction: the teammates line prints only what rows prove, exactly as partners does today (signature or "tier unresolved", Action id, Session id or "claim"), and appends persona/Role only when a brief recorded them; otherwise "persona unrecorded". Add a "subagent of Session <id>" form for native delegates.

### 2. "Stance" is a fourth name for one concept and the rename breaks governed data and JSON, not just a flag
Claim: the builder/critic field is already named three ways; renaming adds a fourth and the alias-flag plan does not cover the real surfaces.
Evidence: JSON key `identity_role` in config/defaults/agent-roles.json (every role), strictly validated by name in src/agentRoles/registry.ts:56 and :67; the registry is Decision 0100's "exact taxonomy file" (.agents/skills/arcadia-role/SKILL.md:8-9); the role brief prints it as "identity capacity" (src/agentRoles/brief.ts:25) inside schema `arcadia-role-brief-v1` whose `identity.role` field is snapshot-tested (tests/__snapshots__/agent-roles.test.ts.snap, tests/agent-roles.test.ts:21,33,66); `arcadia identity resolve --json` returns `role`; session-roles-and-briefs.md says "Do not add fields to the generated role-brief JSON". Decision 0068's rationale records that `AGENT_ROLES` "exists specifically to keep git commit/PR-comment authorship honest" and warns against letting it drift.
The collision the proposal does not name is the one agents actually hit: `arcadia role brief --role <registered id>` (src/cli.ts:4634) versus `arcadia identity resolve --role builder|critic` (cli.ts:4660), two flags with the same spelling and different domains.
Why it matters: an alias on one flag leaves the JSON key, the schema field, the registry file and the printed "capacity" untouched, so the collision survives in every machine-readable surface while adding a new word to the prose. Changing a Decision-0100 file needs its own Decision, which the proposal does not name.
Smallest correction: no code or data rename. Fix the vocabulary in prose only: call it **identity capacity** (the term the brief already prints), state once that `identity_role` / `--role` on the identity command are that capacity, and that the capacity is derived from the Role (`identity_role`) and never chosen by hand. If a flag must change, rename only `identity resolve --role` to `--capacity` with `--role` kept as alias; leave `role brief --role` alone.

### 3. Launched Sessions still have no persona, so "Rowan is default" collides with Decision 0112 and Ellis
Claim: the model does not say which persona a launched Session is.
Evidence: Decision 0112 answer: every Session starts as "Lead (Action Lead) ... does the routine work itself"; semantics.md:162-167: a Session starts as Rowan "unless its assignment explicitly binds another profile or registered Role"; Ellis is "planner or implementer" (semantics.md:177). A launched Action brief carries the Identity block (src/sessions/actionBrief.ts) and the Action, never a persona. The Identity block printed today contains no persona at all (resolve output above: `You are Claudia Mason ...`).
Why it matters: the same implementation work is "Rowan" when the Lead does it (0112) and "Ellis" when delegated at depth 1 (0114). An operator saying "Ellis, fix X" to a launched Session gets no defined answer; two agents reading the same Project will label the same Session differently.
Smallest correction: one sentence in the model: a Session's persona is the persona of its bound Role (lead→Rowan, planner/implementer→Ellis, plan-critic→Nadia, code-reviewer→Sage, qa→Quinn, researcher→Mira/Vida by specialization), the Role being the brief's `Role:` line or Decision 0112's default; the persona line is therefore derivable and should be rendered by the role brief, not asserted by the agent.

### 4. Exactness comes from lineage, not names; the proposal relies on it but does not make it a layer
Claim: "several sessions on the same persona" and "operator addressing by name" remain ambiguous because the proposal has no canonical reference form.
Evidence: semantics.md:224-226 already says "Several Sessions may use the same profile: distinguish them by name, task and Session reference"; chat titles carry Plan and state, not persona (`⭐ 🚦🟠 Lead trials · approve pilot budget`, docs/agent-guidance/chat-titles.md:33-40; "Coordination is a duty, not an additional registered role"); `--relation coordinator` (src/cli.ts:2346) is the only machine marker of "the Rowan".
Why it matters: with two Ellis sessions live, "Ellis — Engineer as Cody Atlas" is still two sessions. The operator-facing surface (session title, Discord ping) carries no persona, so the "introduce yourself by persona" rule and the title rule disagree.
Smallest correction: add **Lineage** (Session id or "interactive"/"subagent of <id>", Action id, attempt role, depth) as the disambiguating element, define one canonical short reference `Persona (role) · Signature · Session <id8> · Action <id>`, and say whether chat titles gain the persona (they currently must not change kind glyphs; chat-titles.md governs).

### 5. Collisions missed: "profile", "Supervisor", "Lead", "agent", "Session", and "Critic" is the weakest of the four stated
- **profile**: "identity profile" (semantics.md:157; 8 doc occurrences; index.json:22 trigger "named identity profiles") vs `init --profile experiment` workspace profile under Decision 0082 (src/cli.ts:689) vs `provider_profile` / `agent_profile` / `execution_profile_json` on `agent_sessions` (src/sessions/index.ts:95-96, 612, 671-672). The persona rename fixes this one but the proposal neither claims it nor lists the doc/index sweep.
- **Supervisor**: a relationship value in agent-roles.json (`"supervisor": "lead" | "project-supervisor"`), a deterministic function in Decision 0113 ("not a running agent"), a light-model invocation in Decision 0121, a process watchdog in src/briefSupervisor.ts (0113's rationale names this), a skill `arcadia-supervisor`, and a Rowan method "when assigned". The proposal's rule "Supervisor as a noun means only whoever is supervising now" contradicts 0113 (the Project supervisor is a function with nobody "now") and the registry field. Correction: "supervisor" (field) = relationship; "supervision" = Behavior; the person noun is avoided in guidance.
- **Lead**: registered role `lead`, Decision 0112 "Lead (Action Lead)", native-app "Lead/Driver" (docs/agent-guidance/native-app-sessions.md, 12 uses), the verb "lead with 🚦" (AGENTS.md Handoff), and the Plan name "Lead trials" in title examples. Not addressed.
- **agent**: `--agent claude` is a platform (`TierAgent`), while "agent", "Agent Ask", and Claude's `Agent` tool mean other things. The proposal's roster line keeps "(claude)" as the platform label without saying "platform".
- **Session**: an Arcadia Session row vs an interactive chat session vs a native subagent with no Session. The proposed "(session …)" reference is undefined for two of the three.
- **Critic** (stated collision 3): "Critic Claudia Atlas" is a fixed title in signatures (agentIdentity.ts:56-59, `criticTitle` in the roster, 246+ history entries only as builder but every critic comment to date), "Nadia — Critic" is a persona title, "Process Critic" is a plan-critic specialization, and `critique` is an attempt role. They never occupy the same slot: one prefixes a signature name, one follows an em dash. Renaming Nadia to "Plan Critic" makes the persona title identical to the role id `plan-critic`, which re-blurs the persona/Role boundary the proposal just drew. Correction: keep "Nadia — Critic", state "Critic before a roster name is always the identity capacity", drop the rename and its operator decision.

### 6. "Iris — Designer" + a Design Behavior conflicts with Decision 0068 and with the Behavior definition
Claim: a Designer persona is the deferred class 0068 named, and "design" fails the Behavior test the proposal itself states.
Evidence: Decision 0068 (approved, 2026-09-25) deferred "content-generation personas -- e.g. Writer, Painter, Director, Photographer" with the revival trigger "when a first concrete content-generation task needs a named persona", and warned against extending AGENT_ROLES for it. semantics.md:130-134 defines a Behavior by "when the procedure applies ... finite allowance and deadline, and stop or escalation conditions"; the proposal's table says Behaviors are "triggered by its conditions". Supervision and Hacker recovery have triggers (signal, two unchanged refusals); design has none. semantics.md:203-205: "A specialization narrows the domain or method of an assignment; a reusable procedural method is a Behavior."
Why it matters: a Design Behavior is a specialization mislabelled, and Iris needs 0068's trigger named (the existing docs/design/ work and the "Heavy designer" ledger row, docs/reports/session-ledger.jsonl:8, may be that evidence) or it contradicts an approved Decision.
Smallest correction: Iris binds to `planner` (read-only design) or `implementer` with a "design" specialization, no Behavior; the Ask cites 0068 and its trigger. The Ellis wording change is misquoted: the source says "Design a bounded correction or build it" (semantics.md:177), not "designs solutions".

### 7. The Behavior naming rule contradicts the existing skill and heading names, and skills are missing from "Touches"
Evidence: `.agents/skills/arcadia-hacker/SKILL.md` ("# Arcadia Hacker", "Hacker mode"), `.agents/skills/arcadia-supervisor/SKILL.md` ("# Arcadia supervisor"), index.json:24 trigger "hacker mode". Both are person nouns. Skills must exist under `.agents/skills` and `.claude/skills` for three harnesses (CLAUDE.md global rule; docs/agent-guidance/skills.md), and the proposal lists no skill touch.
Why it matters: either the rule renames two skills across three discovery paths (cost the proposal does not budget) or it is immediately violated by the canonical examples.
Smallest correction: state the rule as "the Behavior's canonical name is the activity (supervision, hacker recovery); skill ids and headings may keep their existing nouns", and add no skill rename.

### 8. The proposed block drops three load-bearing lines and ignores the reviewer variant
Evidence: today's block carries `IDENTITY_AUTHORITY_RULE` (re-resolve on model change), the operator-principal rule and `WORKSPACE_MODE_RULE` (agentIdentity.ts:285-292; resolve output above). git-identity.md:28-31 requires re-resolving after a tier change; the proposal's block has no such line. `renderReviewerIdentityBlock` (agentIdentity.ts:349-371) names no developer, partners or commands by design.
Why it matters: mid-session tier change is a listed situation; a block without the rule regresses it. A reviewer block listing teammates would name the developer and weaken the independence the design encodes.
Smallest correction: keep the three rule lines verbatim; say the reviewer variant is unchanged (signature + independence only).

### 9. Swapping the meaning of "teammates" needs an atomic migration, not just a rename
Evidence: 24 assertions in tests/agent-identity-block.test.ts reference the block; tests/identity-command.test.ts and the roles snapshot carry "Your teammates are ..."; git-identity.md:62-66 defines the current meanings; `AgentTeammates`/`agentTeammates` are exported types.
Why it matters: an old doc or Notes entry saying "teammates are the other platforms" will coexist with the new meaning. Reusing a word with the opposite meaning is the riskiest rename class.
Smallest correction: acceptable only if guidance, block, tests and `rg "teammates"` sweep land in one PR; rename the export to `agentRoster`/`roster` so stale call-sites fail to compile.

### 10. Decisions and governance the proposal does not name
- Any `agent-roles.json` key change: Decision 0100 file (finding 2).
- Iris: Decision 0068 trigger (finding 6).
- The identity profiles themselves were introduced by docs PRs #1714/#1727 without a Decision; the proposal says Iris and the Nadia rename "are operator decisions" but not through which path. Correction: one Decision carrying all naming changes (persona additions, teammates/roster meaning swap), merged under the Constitution's "changes what agents are authorized to do ... wait for the operator" clause only if any authority text changes; otherwise an operator-answered Decision plus a docs PR. Note semantics.md:228-230 and git-identity.md both say the contract adds "no CLI name aliases, automatic routing"; the model must restate that.

### 11. Five layers: right count, wrong shape
Persona is not a peer of Role; it is a human label over Role + purpose (semantics.md:157-160, finding 3). Behavior and specialization are both "methods composed within the assigned Role" (semantics.md:203-205); keeping them separate is fine because semantics already does. What is missing is the element that makes identification exact: lineage (finding 4). Suggested shape: Signature (who did it, provable) · Lineage (which Session/Action/attempt, provable) · Role (what it may do, bound) · Persona (what to call it, derived from Role) · Methods: Behaviors (triggered procedures) and specializations (domain labels). "Mode:" in the block should be "Behaviors:" (zero or more), since mode is the active state of one Behavior (semantics.md:152).

## Verdict: PASS WITH CHANGES

Required before it goes to the operator:
1. Drop the "stance" rename and any code/JSON/registry change; use "identity capacity" in prose, derived from the Role; name the real `--role` flag collision and leave `role brief --role` alone.
2. Make every teammate line provable: signature + lineage (Session id / interactive / subagent-of) + Action from existing rows, persona only when a brief recorded it; keep the authority, operator and workspace rule lines; reviewer variant unchanged; add Lineage as the disambiguating element and one canonical reference form.
3. Iris as a `planner`/`implementer` design specialization, not a Behavior, with Decision 0068's trigger cited; drop the Nadia rename; keep existing skill nouns; route all naming changes through one Decision.

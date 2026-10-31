# Arcadia agent naming and design help: briefing, revision 3

Date: 2026-10-29. Written by Rowan (Coordinator), signing as Claudia Atlas
(claude, heavy, builder). This is a proposal for review. It decides nothing:
no guidance, code, schema or Decision has changed.

Revision 2 answers independent review 3, which returned HOLD
(`reviews/02-independent-review-3.md`). It adopts all ten of that review's required
corrections; section 0 maps each to where it is handled. The source checkout
reviewed is `/Users/pmark/Dev/MR/Arcadia/arcadia` at main `b6974693d`.
Reconciled against main `55637a5d7` on 2026-10-29. The cited identity,
partners, role-brief, semantics and guidance sources are unchanged.
`src/db/schema.ts` adds one `agent_sessions` column,
`completion_capability_mode` (#1867), and shifts later lines by one. The
attempt table is now at line 170. The new `arcadia-handoff` skill (#1877) is
named as an activity, which is consistent with the Behavior naming rule.
Revision 1 and Rowan's draft 1 were working files and are not checked in.

Revision 3 applies re-review 3b (`reviews/03-re-review-3b.md`). That review
returned PASS WITH CHANGES and listed five bounded accuracy edits, F1–F5, as
its exit criterion. All five are applied here; no architecture changed. Its
remaining notes before these edits: items 2, 3 and 10 partly met, all others
met, none not met. A final critique by Nadia (`reviews/04-nadia-final-critique.md`)
returned CONVERGED WITH NOTES, validating all 13 load-bearing conclusions; its
four non-blocking notes are applied in this copy.

Every claim below carries one of three status labels:
- **Current:** works today, with the source cited.
- **Proposed:** work this briefing recommends; none of it exists.
- **Decision:** the operator's choice; none has been opened or answered.

Companion files, all in this folder (`docs/design/agent-naming-and-design-help/`):
- `reviews/01-nadia-critique-of-draft-1.md`: Nadia's critique of draft 1
- `reviews/02-independent-review-3.md`: independent review 3 (HOLD)
- `reviews/03-re-review-3b.md`: re-review 3b (PASS WITH CHANGES)
- `reviews/04-nadia-final-critique.md`: Nadia's final critique (CONVERGED WITH
  NOTES)
- `arcadia-design-proposal-r7.md`: the Arcadia Design proposal, revision 7

The review files are kept verbatim as evidence; paths inside them point to the
reviewers' original working folder, which is not checked in. The round 3
simulation logs (`sim3/`) are summarized in revision 7 and also not checked
in.
- `sim3/`: round 3 simulations

---

## 0. What changed from revision 1

| # | Review 3 required change | Handled in |
|---|---|---|
| 1 | Separate attribution from proof | §3: the Signature row and rule 1 |
| 2 | Truthful peer reporting: IDs, status, scoped Action, coverage and freshness | §3 Teammates row; §5 |
| 3 | Unique instance references | §3 Instance reference row and the locator table |
| 4 | Bind persona explicitly; never derive it; omit it when unknown | §3 Persona row; §4 |
| 5 | Correct the capacity rules | §3 Critic-title row; rule 4 |
| 6 | Drop the export rename; reuse `agentRoster()` | §3 Roster row; §9 |
| 7 | Keep Lead's native-app sole-writer restriction | §6 |
| 8 | Function-first design help; Iris optional; record method separate from field specialization | §8 |
| 9 | Bound the assurance promise | §8.3 |
| 10 | Resolve continuity scope; distinguish request states | §8.4 and §8.5 |

Revision 1 claims now withdrawn:
- the signature as proof of runtime;
- the persona derived from Role plus specialization;
- "interactive" or "subagent of X" as enough to identify an instance;
- "identity capacity always follows Role";
- renaming `agentTeammates` to `agentRoster`;
- "chat titles carry Plan and state only" (`chat-titles.md:31` allows
  `<role or task>`);
- "Specialization machine field: none" (`brief.ts` returns `specialization`);
- rejecting design entirely as a Behavior.

---

## 1. The goal

The operator: "The Arcadia agent identities need to be unified so that agents
know exactly how to identify themselves and their teammates." And, for design:
"In whatever context, I should be able to ask for a designer to help and be
assured that the advice that I get is following the best practices for that
particular design domain."

## 2. How the positions converged

| Topic | Rowan, draft 1 | Nadia | Review 3 | Revision 2 position |
|---|---|---|---|---|
| Signature | Proves who did it | Proves who did it | Attribution only; runtime, authorship and independence need separate evidence | Attribution convention (§3) |
| Teammates | Live co-workers | Only what rows prove | Recorded peers with IDs, status, scoped Action, coverage and freshness; never "complete" | Recorded peers with coverage (§5) |
| Instance identity | Persona plus signature | Add lineage; "interactive" and "subagent of" allowed | Typed unique locators; unknown when unavailable | Typed locators (§3) |
| Persona | Default Rowan | Derive from Role | Explicit binding in Task prose; omit when unknown; no schema change | Explicit binding (§4) |
| Capacity | Rename to "stance", derive from Role | No rename; "identity capacity" in prose | Role briefs supply defaults; other permitted critique resolves critic explicitly | Review 3 (§3) |
| Roster export | Rename | Rename to `agentRoster` | Collides with the existing `agentRoster()`; reuse it, keep legacy JSON | Reuse; no rename (§9) |
| Lead | Not addressed | Persona collision only | The native-app sole-writer restriction must be stated explicitly | Stated (§6) |
| Iris | Persona plus Design Behavior | Specialization only (Decision 0068) | Optional handle; function-first; the record method can be a Behavior once bounded | Function-first, Iris optional; Decision (§8) |
| Assurance | "Assured" | Not addressed | Bounded: show guide, applicability, provenance, confidence, gaps | Bounded promise (§8.3) |
| Continuity | Not addressed | Not addressed | Choose a pre-Project home or limit the pilot to Projects | Decision (§8.4) |

---

## 3. The unified schema

The same columns describe every element:
- **Establishes / does not establish:** what the element proves, and what it
  must never be read as proving.
- **Machine field today:** the field that exists now in data or code.
- **Status:** current or proposed.

| Element | Answers | Examples | Source of truth | Set by | Establishes | Does not establish | Grants? | Machine field today | Canonical term | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Signature | Which platform, tier and capacity is this artifact attributed to? | `Claudia Mason <claudia.mason@agents.arcadia.local>` | Identity table in `agentIdentity.ts` plus supplied or recorded runtime metadata | `arcadia identity resolve` from supplied `--agent`/`--tier`/`--role`, or a launch's recorded model and effort | A stable attribution mapping | The runtime that did the work, the exact model or version, authorship, independence. `identity resolve` does not inspect the running agent (`src/commands/identity.ts:72`) | No | `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, comment signature | **signature** | Current; wording proposed |
| ↳ given name | Which platform is attributed? | Cody / Claudia / Owen | Identity table | Supplied or recorded platform | Mapping | Runtime attestation | No | `--agent`; identity JSON `agent` | **platform** | Current |
| ↳ surname | Which tier is attributed? | Swift / Mason / Atlas | Tier registry | Model lookup first, effort as fallback (`agentIdentity.ts:198`), or explicit `--tier` | Mapping, as fresh as its input | The exact model; freshness after a model switch | No | `--tier`; identity JSON `tier` | **tier** | Current |
| ↳ Critic title | Which authorship capacity applies? | `Critic Claudia Atlas` | `git-identity.md`; `identity_role` in `agent-roles.json` for registered-role briefs | A role brief supplies its configured default; otherwise resolve explicitly for the actual artifact (critique → critic; fixing the critiqued work → builder) | Attribution capacity | Independence, or admission as a reviewer | No | `identity_role`, role brief `identity.role`, `identity resolve --role builder\|critic` (all kept) | **identity capacity** (prose only) | Current; prose term proposed |
| Instance reference | Which recorded Session, host conversation or child, or claim? | Arcadia Session ID; host chat ID or link; host child-agent ID; claim ID | Session rows (prepared, running or finished); the host's own IDs; launch receipts | Recorded by Arcadia or the host | Uniqueness, when typed and scoped (issuing host or workspace plus full ID, or a resolvable link) | That the instance is running now; governed attempt lineage; persona; parentage | No | `agent_sessions.id`; claim and reservation IDs; for launched Sessions, `provider_session_id` (host session ID); interactive and native-child host IDs are not stored by Arcadia | **instance reference** | Proposed term; IDs exist today |
| Lineage | Which governed work and attempt? | Project/Plan/Action; attempt ID and ordinal | `agent_sessions` Plan and Action references; attempt rows (`session_role_attempts`, `src/db/schema.ts:170`) | Arcadia records | Only the recorded links | Depth or attempt when no row links them; print "unknown" | No | Existing IDs; no single universal field | **lineage** | Current data; display proposed |
| Role | What assignment eligibility applies? | `lead`, `planner`, `implementer`, `plan-critic`, `code-reviewer`, `qa`, `researcher` | `config/defaults/agent-roles.json` (Decision 0100) plus the assigned brief | Explicit assignment, or Decision 0112's Lead default where it applies | Assignment intent and eligibility | Runtime admission or permission | Eligibility only, within assigned authority | Role ID | **Role** | Current |
| Persona | Which optional handle names this assignment? | Rowan — Coordinator; Ellis — Engineer | Explicit binding in the brief's Task prose; profile table in `arcadia-semantics.md` | The assigner, explicitly. Never inferred from Role or specialization | That an assignment named it, when bound | Expertise, a unique actor, authority, independence | No | None; Task prose only (`session-roles-and-briefs.md` forbids new role-brief JSON fields) | **persona** (replaces "identity profile") | Current practice; term proposed |
| Behavior | Which bounded method is assigned or active? | supervision; hacker recovery; consultation | Method source (guidance or skill) plus assignment | Its trigger, within the assignment's authority | That a method was assigned | That it was activated or followed; those need separate evidence | No | Skill ID where used | **Behavior** | Current |
| Mode | What procedural state is reported? | recovery mode | The Behavior plus current evidence | Actual activation | The reported state, when evidence supports it | Anything without evidence | No | None | **mode** | Current |
| Specialization | Which domain or method narrows the assignment? | technical writing; website design | Assignment brief | The assigner | The assigned label | Expertise | No | `RoleBriefInput.specialization`; returned `specialization`; free text, validated (`brief.ts:56-61`) | **specialization** | Current |
| Roster | Which attribution combinations exist? | platform × tier × capacity | `agentRoster()` (`agentIdentity.ts:272`); `arcadia identity roster` | Data | The full set of signatures | Who is working | No | `AgentRoster`, `agentRoster()` | **roster** | Current |
| Teammates | Which peer instances or claims are recorded, and how complete is that? | Session `<id>` (running) on Action `<project/plan#action>`; claim `<id>` on Action `<…>` | `partners.ts` projection (Sessions in `prepared`/`running` by Project; unexpired claims); peers named in a brief, kept separate | Arcadia records, observed at a stated time | Partial observations, with coverage stated | That nobody else is working; that "prepared" means active; same-Project means same work | No | `AgentPartner` today; drops the Session ID and selects no claim ID (verified at `partners.ts:33-62`) | **teammates** in conversation; **recorded peers** in generated text | Current projection; ID retention, coverage and freshness proposed |
| Operator | Who is the human principal? | The operator | `CONSTITUTION.md` | — | Holds approvals | Is never a teammate; never signs as an agent | Approvals | — | **operator** | Current |

### Instance locators

Every locator is typed and scoped: the issuing host or workspace plus the full
ID, or a resolvable link.

| Kind | Locator | Parent-agent locator | Work association | Available to Arcadia today |
|---|---|---|---|---|
| Arcadia Session | Workspace plus full `agent_sessions.id` (the row also stores the host's `provider_session_id`); lifecycle state shown (prepared, running, needs input or finished) | Unknown unless evidenced; the row records none | Plan and Action on the row | Yes |
| Interactive chat (Codex, Claude Code, OpenCode) | Host plus chat or session ID, or a link | Not applicable | Only as the brief states it | Only if the brief or agent supplies it; otherwise "instance reference unavailable" |
| Native child agent | Host plus child-agent ID | Host plus the actual parent ID or link, when supplied; a shared title label (`↳`) does not prove parentage | As its brief states | Only if supplied |
| Claim (a reservation, not an agent instance) | Workspace plus claim or reservation ID | Not applicable | Project and Action on the row; the Plan comes from an identified source or is shown as unavailable (claim rows have no Plan column) | The row has an ID, but `partners.ts` doesn't select it today |

Short IDs may be shown only when they are unambiguous; full IDs remain the
link targets. "Interactive" alone, or "subagent of X" alone, never counts as an
identity.

### Rules

These state current rules unless marked.
1. **A signature is attribution, not proof.** Sign every commit and comment
   with the signature resolved for the actual runtime; re-resolve after a model
   change. Runtime, authorship and independence need separate evidence.
2. **Address by function or persona, but identify by instance reference.** A
   name selects a profile, never one actor.
3. **Never claim a teammate's persona, capacity or runtime that no record or
   brief states.** Print "unknown" instead. *(Display rule proposed.)*
4. **Role briefs supply their configured identity capacity.** Other permitted
   critique resolves the critic capacity explicitly for the actual artifact.
   Fixing critiqued work is builder. The critic capacity never admits
   independence.
5. **Personas, Behaviors and specializations establish no runtime identity,
   expertise, independence or authority.** A recorded one establishes only an
   assignment label. They select no provider and authorize no dispatch. The contract adds no CLI name
   aliases or automatic routing.
6. **An empty or partial peer query is not "nobody else".** Generated text
   states its coverage. *(Proposed.)*

---

## 4. Persona catalogue

| Persona | Function | Role | Methods | Hands off to | Example request | Status |
|---|---|---|---|---|---|---|
| Rowan — Coordinator | What matters, who owns it, what's blocked, the next move | `lead` | supervision and release management when assigned | everyone; holds priorities | "What needs my attention?" | Current |
| Mira — Investigator | Why something failed; the smallest testable correction | `researcher` | release investigation | the fix owner | "Why does this keep getting stuck?" | Current |
| Ellis — Engineer | "Design a bounded correction or build it" | `planner` or `implementer` | planning, architecture, guardrails | Sage, Quinn | "Design and build this fix." | Current |
| Nadia — Critic | Challenge a plan's assumptions, risks and evidence | `plan-critic` | Process Critic | the plan's owner | "Will this plan achieve the outcome?" | Current |
| Sage — Reviewer | Defects in an exact code change | `code-reviewer` | independent PR review | the implementer | "Review this PR for bugs." | Current |
| Quinn — Verifier | Acceptance against observed behavior | `qa` | PR QA procedure | Rowan, the owner | "Verify this works, including recovery." | Current |
| Vida — Health Assessor | System health, risks and unknowns | `researcher` | bounded health assessment | Rowan; failures to Mira | "Are the services healthy?" | Current |
| Clara — Technical Writer | User-facing guides and articles | `implementer` | technical writing | Rowan | "Turn this feature into a guide." | Current |
| *Iris — Designer* | Optional handle for design help (§8) | `planner` | design consultation or facilitation, plus a field specialization | Rowan (Asks); Ellis (engineering); Nadia (independent critique) | "Help me think through this game idea." | **Decision** (cites Decision 0068) |

**Binding is explicit, never derived.** The same Role maps to several
personas: `researcher` to Mira or Vida, `implementer` to Ellis or Clara, and
`planner` to Ellis or, if adopted, Iris. Specialization is free text, so it
can't resolve the persona either. The persona is therefore whatever the brief's
Task prose states. A generic generated block (such as `identity resolve` with
no assignment context) omits the persona line. Two defaults stay separate:
- **Role default:** Decision 0112 makes the starting Role Lead.
- **Name default:** the conditional Rowan default comes from
  `docs/arcadia-semantics.md:164-171`, and applies only where its conditions are
  known.

**Behaviors and methods**

| Method | Trigger | Usually followed by | Source | Stops when | Status |
|---|---|---|---|---|---|
| supervision | An assigned relationship; a friction or exception signal; session completion (Decisions 0113, 0121) | Rowan, or the project-supervisor function | `arcadia-supervisor` skill | Its bounded diagnosis or escalation is done | Current |
| hacker recovery | Repeated unchanged refusal, procedural fixation, or a stop-the-line request | The Lead diagnoses; the authorized implementer repairs | `arcadia-hacker` skill | An authorized route is proved, or reported missing | Current |
| consultation | "get advice", "get a second opinion", "get help" | Any eligible Role | `docs/agent-guidance/consultation.md` | After the bounded pass | Current |
| design facilitation (the sustained record method) | "keep / resume a design brief" | The persona the assigner binds | Revision 7 core, to be a portable skill | Agreed session end, a named gap, or a ready brief handed off as Asks | Proposed |

Behavior canonical names are activities. Skill IDs `arcadia-supervisor` and
`arcadia-hacker` keep their nouns, so no skill is renamed. "Supervisor"
remains valid as the registry relationship field, as the Decision 0113
function, and for an assigned agent performing supervision. What is never
valid is asserting a running supervisor from the relationship default alone.

---

## 5. Identity block examples

**Current** (`arcadia identity resolve --agent claude --tier standard`):
```
You are Claudia Mason <claudia.mason@agents.arcadia.local> (claude, standard, builder); sign every comment and commit exactly so, never as another tier or name.
[authority rule: re-resolve if the model actually doing the work differs]
Your teammates are Cody Swift/Mason/Atlas (codex) and Owen Swift/Mason/Atlas (opencode), ...   ← a platform roster, labelled "teammates"
[operator rule]
[workspace rule]
```

**Proposed: assigned Session with a brief** (illustrative; IDs are placeholders):
```
Assignment: Ellis — Engineer, bound in Task prose · Role: implementer · Specialization: settings UI
Instance: Arcadia Session 7c1e2f40-…-a9 · Action arcadia/<plan>#<action> · attempt <id> (ordinal 1)
Signature: Claudia Mason <claudia.mason@agents.arcadia.local> (claude, standard, builder) · attribution only
Recorded peers on Project arcadia; records observed at 2026-10-29T14:02Z (this is when the records were read, not evidence of any peer's current runtime); coverage: agent_sessions (prepared/running) and unexpired claims only, not needs_input Sessions, interactive peers or native peers:
  - Session arcadia:3b9d…-11 (running) · Action arcadia/<plan>#<action> · platform codex; tier heavy inferred from recorded launch metadata; capacity unknown; persona unknown; current runtime unverified
  - Session arcadia:52aa…-07 (prepared, may not have started) · Action arcadia/<other-plan>#<action> · platform claude; tier unresolved; capacity unknown; persona unknown
  - Claim arcadia:0f6e…-c3 (a reservation, not an agent) · Action arcadia#<action>, Plan unavailable from the claim row · persona and runtime unknown
Peers named by the brief (not database-observed): Lead = host chat <link>
Roster: Cody / Claudia / Owen × Swift / Mason / Atlas (from agentRoster())
[authority rule, verbatim] [operator rule, verbatim] [workspace rule, verbatim]
```

A full peer signature (for example `Cody Atlas`) is rendered only when its
capacity is supported by a record. The attempt line in the example assumes a
verified Session-to-attempt link; without one, it is omitted.

**Proposed: generic** (`identity resolve` with no assignment): the signature, the
roster, and the three rule lines. No persona, no instance reference and no
peers, because the command has no assignment context.

**Read-only reviewer** (current, unchanged): signature and independence only.
This is a deliberate exception to teammate visibility, not a way of providing
it.

**Compatibility** (proposed): the legacy `teammates` JSON from
`identity resolve --json` keeps its shape. It is documented as the legacy
platform roster; it is not repurposed. The `agentTeammates` export stays. New
display text reads from `agentRoster()` and the extended partners projection.

---

## 6. Lead operating contract

- **Current:** Decision 0112 lets a Session start as the Lead and do routine
  work itself. The native-app convention (`native-app-sessions.md:23-26`)
  keeps the native-app Lead from writing product code, with the implementer as
  the sole code writer. Decision 0112 permits routine Lead development outside
  that scoped convention.
- **Proposed:** each applicable brief states which operating contract applies,
  the actual owner, and the sole writer. A naming change never removes the
  native-app restriction. A request such as "Ellis, fix X" never silently
  reassigns custody.
- **Decision:** harmonizing mutation rules across transports would change
  authority, so it needs an operator Decision before agents rely on it.

---

## 7. Situation walk-through

| Situation | Current: names itself? | Current: names teammates? | After proposed work |
|---|---|---|---|
| Launched Session | Signature and Session row; persona only if a brief bound one | Partial: recorded partners where available (`renderIdentityBlock`, `agentIdentity.ts:353-372`); no complete or uniquely identified team | Instance, lineage and bound persona; recorded peers with IDs, status and coverage |
| Interactive session | Signature only; no Arcadia instance ID | No | Host chat ID if supplied, otherwise "unavailable"; peers with coverage that excludes interactive peers |
| Native subagent, no Session row | Signature; parentage only if a host locator is supplied | No | Child and parent host locators when supplied; Session and attempt shown as "unrecorded" |
| Read-only reviewer | Signature and independence only, by design | Intentionally no | Unchanged |
| Mid-session tier change | Only after re-resolving from the actual runtime | Stored peer models may be stale | Same, plus a "records observed at" time; runtime evidence is shown separately or as unknown; persona and instance don't change because the tier did |
| Two Sessions, same persona | Distinguishable only by full Session ID | The projection drops the IDs | Full IDs carried and linked |
| Delegated implementer under a Lead | Only with launch evidence | No | Child ID and parent reference; depth from a record, or "unknown"; the sole-writer handoff stated |
| "Ask Nadia to check this" / "Ellis, fix X" | The name selects a profile, not an actor | — | Resolve by task, then existing owner or instance, then Role and route; never launch by name alone; no self-certified independence |

---

## 8. Design help from anywhere

### 8.1 Function-first, one entry, two depths

- **Entry** (proposed): you ask by function, in ordinary words: "design help",
  "design advice", "critique this design", "keep / resume a design brief".
  "Iris" is an optional handle that resolves to the same thing; nobody has to
  memorize a name.
- **Quick design consultation** (proposed extension of the current
  consultation Behavior): a bounded question, answered in the current
  conversation or handoff.
- **Design facilitation** (proposed method): a sustained conversation that
  keeps a design brief, using the revision 7 record rules.
- **Growing from one to the other:** you say "keep this". The quick exchange is
  linked into the brief by reference: your original words, the advice
  attributed to the expert, and the changed readings confirmed. A one-off
  answer never silently becomes a permanent record, and the full record is
  never forced onto "is this layout confusing?".

### 8.2 Three separate parts

| Part | What it is | Status |
|---|---|---|
| Field specialization | Website, game, song…: the domain, plus its field guide when one exists | Specialization mechanism current; guides proposed |
| Record method | Design facilitation: verbatim capture, position kept separate from evidence, return conditions, attribution, read-back, resumption | Proposed (revision 7) |
| Handle | "Iris — Designer", optional | Decision |

A field name alone is not a Behavior. The record method can become one,
because it has a trigger, an allowance and stop conditions.

### 8.3 The assurance promise, bounded

- **Proposed promise:** "You can ask for design help from any supported
  surface. The answer shows which field guidance and evidence it used, where
  they apply, and what remains uncertain."
- **What every material recommendation shows:**
  - the guide's title and revision;
  - whether the guide applies here;
  - the provenance (cited source, operator practice, or agent inference);
  - its confidence, with a reason;
  - the gaps;
  - a cheap observable test.

  Taste is marked as taste.
- **No guide:** say so at the start, then offer disclosed exploratory advice.
  Don't refuse solely because no guide exists (other limits still apply), and
  never claim expertise.
- **Catching a weak guide:**
  - source checks, counterexamples and competing frameworks;
  - independent, domain-qualified critique where it matters;
  - observed test outcomes.

  A provenance validator catches missing labels, not wrong advice.
- **Not promised:** guaranteed best practice in every field. The simulations
  are hypotheses, not proof of expertise.

### 8.4 Continuity scope

- **Current:** no home is defined for a pre-Project design brief (revision 7,
  Phase 2 question 1). Linking mobile captures is deferred. Neither a
  `/private/tmp` file nor a chat link satisfies the checked-in brief contract.
- **Decision** (choose one):
  - (C1) one operator-owned, versioned design-artifact home with a stable
    locator, linked from the original capture;
  - (C2) restrict the sustained-design pilot to existing Projects.
- Under either choice, quick consultation is available where the guidance,
  inputs, capabilities and applicable authority are present. Otherwise the
  exact gap is reported. Installation alone proves neither.

### 8.5 Request states, kept distinct

These are **proposed reporting labels, not a current persisted state machine**:

**request received or captured → handled here, OR routed to an authorized
helper → advice delivered**

- "Brief created or updated" applies only when sustained work was requested.
- "Awaiting input", "awaiting route" and "delivery failed" are valid
  stopping points; none of them claims a later stage.
- Every surface reports only the state actually reached. For example:
  "Captured; awaiting routing."
- A phone capture is not a launched designer. A remote message is a signal,
  not verified operator authority. A co-owner's preference is not the
  operator's approval.
- Facilitation outputs proposals only; it never approves its own Asks.

### 8.6 Contexts

This table is proposed target behavior. Only the "Gaps" column describes
current limits. The link from a mobile capture to a brief is proposed, not
existing.

| Context | Typed or briefed | What loads | Record | Assurance shown | Gaps (all current) |
|---|---|---|---|---|---|
| A coding-agent chat (any of the three harnesses) | "I need design help with this onboarding flow" / "Keep a design brief for this" | Consultation guidance; the proposed portable design skill and field guide | One-off: this chat. Sustained: the one brief, per §8.4 | §8.3 | Outside this repo the skill must be installed; if it's missing, say so and keep the request |
| Mobile, Discord, Agent Ask | "Design help: … Context: <link>" | Existing capture and routing first; the procedure only after an authorized route accepts it | The capture links to the eventual brief | The state first (§8.5), then §8.3 | Mobile linking deferred; no delivery guarantee |
| Another agent mid-task (Ellis, Clara, Rowan) | A brief: the uncertainty, field, source revision, read-only, owner, whether an independent opinion is needed | Consultation plus the design method and guide | The current handoff; promoted only on request | Self-advice vs independent opinion stated | Self-application is not independent review; a delegated child can't spawn another (Decision 0114) |
| Resuming in another harness, with a co-owner | "Resume design <locator>" | The brief's top section first (REQ-014) | The same single brief; one writer | Changes beside the originals; per-owner agreement; guide freshness | Depends on §8.4; attribution is not authentication |
| A field with no guide | "Design help with this song" | The generic core | As above | "No validated guide; general-knowledge inference" | Physical products may need separate safety or ergonomics expertise |

### 8.7 Delegation routes

| Route | When | Identity and lineage shown |
|---|---|---|
| The same agent follows the procedure | Bounded advice within the current assignment | Same instance and Role; method noted in Task prose |
| An authorized native helper | A top-level Lead needs specialist help, eligible under Decision 0114 | Host child and parent IDs; Arcadia Session "unrecorded" unless proven |
| A separate Arcadia Session | Supported launch, especially for independent review | Actual Session and attempt records only |
| A pending consultation or Ask | Helper unavailable or unauthorized | The request receipt and its status; no claim that advice exists |

An independent critique of a design brief uses `plan-critic` (optionally
Nadia) with the field specialization. Sage covers code and Quinn covers
acceptance; neither name supplies field expertise.

---

## 9. Capability ledger

| Item | Current capability | Proposed work | Operator Decision |
|---|---|---|---|
| Signature | Resolver; fixed names, emails, `--role` | Prose: "attribution, not proof" | — |
| Capacity term | `identity_role`, `identity.role`, `--role`; "identity capacity" already printed by `brief.ts:25` | Standardize that existing prose term across guidance | — |
| Peer reporting | `partners.ts` (IDs dropped; no coverage) | Carry Session and claim IDs, status, scoped Action, observation time and coverage; label "recorded peers" | — (a small code change plus docs PR) |
| Instance reference | Session IDs; host IDs not stored | Typed locator display; "unavailable" when missing | — |
| Persona | Task prose; profile table | Bound-only display; omitted when unknown; rename "identity profile" → "persona", keeping the old phrase as a discovery synonym | Decision 1 |
| Roster API | `agentRoster()`, `agentTeammates()`, legacy `teammates` JSON | Reuse `agentRoster()` for display; keep legacy JSON labelled as legacy | Decision 3 |
| Lead | Decision 0112 plus the native-app restriction | State the contract, owner and sole writer in briefs | Decision 4 |
| Consultation | Exists (`consultation.md`) | Add the design-advice route and field selection | — |
| Design facilitation | Revision 7 proposal only | A portable `arcadia-design` skill exposed in all three harnesses (verified per harness); index triggers (none for design today) | Decisions 2 and 5b |
| Field guides | Requirements in revision 7 | Format: scope, revision, review date, provenance and confidence per entry, applicability limits, validation examples | Revision 7 Phase 2 question (guide format and home); authorship is revision 7 Decision 3 |
| Brief home | None before a Project exists | Per the choice made | Decision 5a |
| Chat titles | `<role or task>` allowed (`chat-titles.md:31`; verified) | Optional bound persona text after the workstream | — |
| Pings | Implementation not verified | Optional persona text, subject to the existing signature, delivery and messaging rules; never used as a recipient ID | — |

## 10. Operator Decisions

These are unfiled, proposed operator choices, not existing Decision records.
None has been opened or answered.

1. **Persona automation**
   - **A** *(recommended)*: explicit Task binding; unknown personas omitted;
     existing locators shown. The cheapest truthful fix.
   - **B**: fund a structured assignment binding and resolver now. Enables
     automatic addressing, but adds schema, API and migration work.
2. **Iris**
   - **A** *(recommended)*: an optional "Iris — Designer" handle on `planner`,
     invoked mainly by function. Requires a Decision addressing Decision 0068's
     revival trigger.
   - **B**: design help by function and specialization only. The same
     capability, with no named handle.
   - **C**: a new registered Role. Not recommended: it changes the taxonomy
     and authority.
3. **Naming migration**
   - **A** *(recommended)*: correct display vocabulary and coverage; preserve
     signatures and all machine fields.
   - **B**: also rename APIs and JSON. Needs a consumer inventory and a
     compatibility plan.
4. **Lead**
   - **A** *(recommended)*: state the native-app exception in applicable
     briefs. No authority change.
   - **B**: harmonize mutation rules across transports. An authority change,
     needing guidance and proof.
5a. **Design brief home and scope**
   - **C1** *(recommended before a sustained pilot)*: one operator-owned,
     versioned pre-Project brief home with a stable locator. Cost: choosing
     and maintaining an accessible durable home, and proving cross-harness
     resumption from it.
   - **C2**: restrict the pilot to existing Projects. Cheaper, but it can't
     serve "outside any Project" until revived by the first such request.
5b. **Design help depth**
   - **D1** *(recommended)*: quick consultation by default, with an optional
     sustained brief. Low friction for small questions; recording happens only
     when continuity is asked for.
   - **D2**: always keep a full brief. One uniform procedure, but heavy for
     one-off questions, and it records material nobody asked to keep.
6. **The assurance wording**
   - **B1** *(recommended)*: visible provenance, applicability and uncertainty
     on supported surfaces; disclosed exploratory advice is permitted without a
     guide. Help stays available everywhere it is supported, with honest
     limits.
   - **B2**: claim conformance only to a named, reviewed guide, within its
     demonstrated scope. Requires guide validation, and withholds that
     assurance everywhere else. Even then it does not guarantee design
     quality.

Ordinary vocabulary clarifications that keep approved meanings can go in a
docs PR. Changes to authority, a new persona that revives Decision 0068's
deferral, or schema and API work need the governed operator path. Several
choices may travel in one Decision document, but each stays separately
answerable.

## 11. Arcadia Design status (context)

- Revision 7 was settled as proposal-only evidence: request
  `proposal-field-neutral-design-guidance-r7-2026-10-29`, receipt
  `asksettle_20f1da77066f4f58aa`. No Plan, Action or queue changed.
- Revision 7 still uses "Behavior" for the design role, and has no invocation,
  storage or assurance sections. Revision 8 must also give the facilitation
  Behavior a finite allowance and deadline. This briefing's §8 would feed a revision 8,
  which the operator has asked to hold for now.
- Positioning (discussed, not written into the proposal): Claude Design makes
  the polished visual thing. Arcadia Design keeps the thinking, in any field,
  until it becomes governed work, and uses such tools for cheap prototypes.

## 12. Limits

- **Verified by Rowan against source at `b6974693d`:**
  - `partners.ts:33-62` drops Session IDs and selects no claim ID;
  - `agentRoster()` and `agentTeammates()` both exist
    (`agentIdentity.ts:258-309`);
  - `brief.ts` accepts and returns a free-text, validated `specialization`;
  - `native-app-sessions.md:23-26` states the Lead and sole-writer convention;
  - `index.json` has no design trigger;
  - `chat-titles.md:31` allows `<role or task>`.
- **Taken from review 3 without re-checking:**
  - the `identity.ts` line references;
  - the `schema.ts` columns;
  - the test and snapshot surfaces.
- **Not verified by anyone:**
  - cross-harness skill discovery;
  - the ping implementation;
  - consumers of the legacy JSON outside this repository.
- The simulations are evidence about record keeping, not about field
  expertise.
- PR pmark/arcadia#1869 (Clara's design article, covering revisions 5 and 6)
  merged as `3e3a85d47` on 2026-10-29. It does not cover round 3, revision 7 or
  this briefing.

# Final convergence critique: Arcadia naming briefing, revision 3

Nadia — Critic (plan-critic). Read-only. Source verified at
`/Users/pmark/Dev/MR/Arcadia/arcadia` main `b6974693d` (matches the briefing's
stated head). `pnpm -s arcadia identity resolve --agent claude --tier standard`
run read-only to confirm the §5 "current" block. No file other than this one
written; nothing posted, edited or committed.

## Verdict: CONVERGED WITH NOTES

Ready for the operator to decide. Four non-blocking notes in §5; none changes
an architecture choice, a Decision option or a recommended answer.

## 1. Load-bearing conclusions

| # | Conclusion | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | Signature is attribution, not proof of runtime, authorship or independence | VALIDATED | `src/commands/identity.ts:72-88` resolves from supplied `--agent/--tier/--role` (role defaults to `builder`); no runtime inspection. `agentIdentity.ts:197-213` maps model first, effort as fallback. `arcadia-semantics.md:218-221`: names never authenticate a sender or establish independence. Live run printed `Claudia Mason` for whatever this Fable session actually is. | — |
| 2 | Instance references are typed, scoped locators; "interactive"/"subagent of X" alone are not identities; parent-agent locator and work association are separate | VALIDATED WITH CAVEAT | `agent_sessions` (`schema.ts:446-481`) carries `id`, Plan/Action refs, `provider`, `model`, `provider_session_id`, `host`, `status` in `prepared/running/completed/failed/needs_input`; no parent-agent column. `chat-titles.md` "Title format": the parent sets the helper title; a shared `↳` label proves nothing. | Caveat: §3 says host IDs are "not stored by Arcadia". For launched Sessions `provider_session_id` and `host` are stored (NOT NULL). True only for interactive chats and native children. Harmless to the proposal; slightly understates what exists. |
| 3 | Recorded peers, with IDs, status, scoped Action, observation time and coverage; never "nobody else" | VALIDATED WITH CAVEAT | `partners.ts:33-62`: selects `id` but pushes `AgentPartner` without it; claim query selects only `worktree_path, action_id`; filter is `status IN ('prepared','running')` by Project. `renderIdentityBlock` (`agentIdentity.ts:353-372`) prints "from live claims and Sessions … none" on an empty partial list, which is exactly the overclaim rule 6 corrects. | Caveat: `needs_input` Sessions are excluded by the current query. The proposed coverage line should name that exclusion (or the implementation should include the state). Non-blocking; strengthens the coverage promise. |
| 4 | Persona is bound explicitly in Task prose, never derived from Role or specialization; omitted when unknown | VALIDATED | Role→persona is many-to-one: `researcher`→Mira/Vida, `implementer`→Ellis/Clara (`arcadia-semantics.md:174-183`). `brief.ts:56-61` accepts any validated free-text specialization and resolves no persona. `session-roles-and-briefs.md:58,66`: profile named in Task prose; "Do not add fields to the generated role-brief JSON." | This overturns my draft-1 finding 3; the overturn is correct. |
| 5 | Capacity: role briefs supply the configured `identity_role`; other permitted critique resolves critic explicitly for the actual artifact; critic never admits independence | VALIDATED | `brief.ts:25` prints `identity capacity: ${role.identity_role}`; `brief.ts:53` resolves identity from `role.identity_role`. `git-identity.md:15-20,29-37`: launched path binds builder; a critique resolves critic by hand; which artifact decides builder vs critic. | — |
| 6 | No API/JSON renames; reuse `agentRoster()`; `agentTeammates` and legacy `teammates` JSON kept | VALIDATED | `agentRoster()` at `agentIdentity.ts:272`, `agentTeammates()` at `:299`, both exist today; `identity.ts:88` emits the nested legacy `teammates`. A rename would collide, as review 3 F6 said. | Overturns my draft-1 finding 9 (export rename); correctly. |
| 7 | Lead: Decision 0112 routine development preserved; native-app sole-writer restriction preserved; harmonizing is a Decision | VALIDATED | `native-app-sessions.md:23-26` verbatim; `brief.ts` last `renderRoleBlock` line restates both. Decision 0112 answer: Lead "does the routine work itself". | — |
| 8 | Design help is function-first; Iris is an optional handle on `planner`; field specialization, record method and handle are three separate parts; the record method may be a Behavior once bounded | VALIDATED WITH CAVEAT | `consultation.md` §"Resolve the request"/§"Select the smallest useful consultation" already select expertise by function. `arcadia-semantics.md:128-134` defines a Behavior by trigger, scope, allowance/deadline, stop conditions; `:202-205` a bare field label is a specialization. Decision 0068 defers content personas with the revival trigger the briefing cites. | Caveat: §4's "design facilitation" row states trigger and stop but no finite allowance/deadline, which the Behavior definition requires. Belongs to revision 8, not this briefing. |
| 9 | Two depths: quick consultation by default, sustained brief on "keep this"; the one-off never silently becomes a record | VALIDATED | Consistent with `consultation.md` "Brief, launch and return" (bounded pass, no new ledger) and §8.7's same-agent route. | — |
| 10 | Assurance promise bounded: guide title/revision, applicability, provenance, confidence, gaps, cheap test; exploratory advice disclosed when no guide; no universal best-practice guarantee | VALIDATED | r7 REQ-006/013/014 (provenance, attribution, resumption) per review 3 F8; `index.json` has no design trigger (grep: none), so nothing today loads a field guide. The briefing says so (§12). | — |
| 11 | Continuity scope is a Decision (C1 durable pre-Project home vs C2 Projects only) | VALIDATED | r7 "Phase 2 open questions", first bullet: where a brief lives before a Project exists; mobile linking deferred (fifth bullet). | — |
| 12 | Request states are proposed reporting labels, not a persisted state machine; "captured; awaiting routing" is a valid stop | VALIDATED | No such state exists in schema or CLI; `operator-directed-work.md` treats remote messages as signals (per review 3 F9). The briefing labels it proposed. | — |
| 13 | Six operator Decisions (1 persona automation, 2 Iris, 3 naming migration, 4 Lead, 5a home/scope, 5b depth, 6 assurance), each separately answerable, with consequences | VALIDATED WITH CAVEAT | §10 matches review 3 §6 and its lettered design Decisions one-for-one after the 5a/5b split. Each option carries a consequence; the recommended option is first. | Caveat: §9's "Revision 7 Decision 3" points at r7 *authorship* (A/B/C), while the row describes guide *format*, which r7 lists as a Phase 2 open question. See §5 note 2. |

## 2. F1–F5 applied?

- **F1** applied: §5 peer line reads `platform codex; tier heavy inferred from recorded launch metadata; capacity unknown; persona unknown; current runtime unverified`; timestamp labelled "records observed at" with the explicit non-runtime disclaimer; claim line shows "Plan unavailable from the claim row" (claim table has `project`, `action_id`, no Plan: `schema.ts:620-637`); full peer signature only when capacity is supported; attempt ordinal conditioned on a verified link. Correct.
- **F2** applied: Instance reference row now asks "Which recorded Session, host conversation or child, or claim?"; locator table has separate "Parent-agent locator" and "Work association" columns; lifecycle state shown; claims labelled reservations. Correct.
- **F3** applied: §8.5 headed "proposed reporting labels, not a current persisted state machine"; chain is `received/captured → handled here OR routed → advice delivered` with `brief created/updated` only for sustained work; awaiting/failed stops preserved; §8.6 labelled proposed target behavior; "available where guidance, inputs, capabilities and applicable authority are present"; proposals-only and no self-approval retained. Correct.
- **F4** applied: §7 "Partial: recorded partners where available"; §4 Rowan default attributed to `arcadia-semantics.md:164-171` (verified: the "Default identity" paragraph) and kept separate from Decision 0112's Lead default; §9 "Standardize that existing prose term" with `brief.ts:25` cited; chat-titles and pings split into two rows, pings marked unverified; rule 5 now "establish no runtime identity, expertise, independence or authority". Correct.
- **F5** applied: Decision 5 split into 5a (C1/C2) and 5b (D1/D2), each with consequences and C1's cost stated; Decision 6 B1/B2 wording matches the review's text including "supported surfaces" and "does not guarantee design quality"; §10 header says unfiled proposed choices. Correct.

New unsupported claims or contradictions introduced by the edits: none found. Decision numbers in §9 (1, 3, 4, 2+5b, 5a) match §10. Residual cosmetic items: §2's column is still titled "Revision 2 position"; §9 has no row citing Decision 6; option lettering differs per Decision (A/B, C1/C2, D1/D2, B1/B2), inherited from review 3 and consistent with the lettered-choice convention.

## 3. Convergence check

Where draft 1, my critique, review 3, review 3b and revision 3 differed, revision 3 holds the position the evidence supports:

- Persona derivation (my finding 3 vs review 3 F4): revision 3 adopts explicit binding. I withdraw the derivation ask; the many-to-one Role→persona mapping makes it unimplementable.
- Export rename (my finding 9 vs F6): withdrawn; `agentRoster()` already exists.
- Design as Behavior (my finding 6 vs F8): revision 3's split (field label = specialization; record method = Behavior once bounded) is consistent with `arcadia-semantics.md:128-134,202-205`. I accept it.
- Review 3b's three "partly met" items (2, 3, 10) are closed by F1, F2, F3/F5 as verified above.

No material disagreement remains between the four documents.

## 4. Goal check

**Goal 1, unified identities.** Answered as a proposal: one schema, one rule set, a truthful generated block, and the Decisions needed to adopt it. Biggest remaining risk: the operator's most common way of talking to agents (interactive chats and native children) has no Arcadia-recorded instance reference, so exact identification of those teammates depends on the host or the brief supplying a locator; the proposal honestly prints "unavailable". This is future work (Decision 1 B, or host integration), not a proposal defect.

**Goal 2, assured design best practice.** Answered honestly rather than fully: the bounded promise (Decision 6 B1) delivers visible provenance and gaps from any supported surface, but "best practices for that particular design domain" is reached only field by field as each guide is authored and ratified (r7 Decision 3) and loaded (today `index.json` has no design trigger and no guide exists). Biggest remaining risk: the operator reads B1 as delivering the assurance, when it delivers the disclosure. The briefing states this in §8.3 "Not promised" and §12; the risk is future work plus Decisions, not a defect.

## 5. Non-blocking notes

1. §3 Instance reference, machine-field column: say "host IDs for interactive chats and native children are not stored; launched Sessions store `provider_session_id` and `host`." Smallest edit; strengthens the proposal.
2. §9 Field guides row: cite "revision 7 Open Decision 3 (authorship); format and home are r7 Phase 2 open questions" instead of "Revision 7 Decision 3". Avoids mixing the briefing's Decision numbers with revision 7's.
3. Proposed coverage line (§3 Teammates, §5 example): name that `needs_input` Sessions are outside the current `prepared/running` query, or include them in the implementation.
4. Revision 8 (held) must give the design-facilitation Behavior its finite allowance/deadline; the §4 row lists trigger and stop only.

Cosmetic, optional: retitle §2's last column "Revision 3 position"; add a Decision 6 reference to §9's Consultation row.

## Limits

Verified: identity resolver and renderers, partners projection, Session/attempt/claim schema, role brief, native-app restriction, chat-title format, semantics profile table and Behavior definition, Decisions 0068/0112/0114 answers, consultation headings, `index.json` design grep, revision 7 Decisions and Phase 2 list, live `identity resolve` output. Not verified: ping implementation, cross-harness skill discovery, external JSON consumers, the r7 settlement receipt, the `sim3/` simulations. Taken from review 3 without re-check: `operator-directed-work.md` "Requests that arrive remotely"; r7 REQ numbering.

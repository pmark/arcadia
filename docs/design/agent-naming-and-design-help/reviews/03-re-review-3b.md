# Arcadia naming re-review 3b

## 1. Verdict

**PASS WITH CHANGES.** Revision 2 resolves the architectural reasons for HOLD and preserves the existing authority and compatibility boundaries. The corrections below are bounded proposal edits, not a demand for implementation or another identity registry. An unconditional PASS requires these examples and decision wording to match the otherwise sound contract.

## 2. Ten-item status table

The numbering follows the ten required changes in the handoff and revision 2 §0.

| # | Required change | Status | Briefing and source evidence |
|---|---|---|---|
| 1 | Separate attribution from proof | **met** | §3 Signature and rule 1 correctly deny runtime/authorship/independence proof. `src/commands/identity.ts:72–88` resolves supplied metadata; no runtime inspection. |
| 2 | Truthful peer reporting | **partly met** | §§3,5,9 now require IDs, status, scoped work, observation time and coverage. However, §5 still displays a capacity-bearing name from model alone; §7 incorrectly describes current output as platform roster only. See F1/F4. `src/sessions/partners.ts:33–62` and `agentIdentity.ts:353–372` support the corrected distinction. |
| 3 | Unique instance references | **partly met** | §3 requires real host child/chat IDs and full references, correctly rejecting “interactive” alone. The locator table still calls Plan/Action a parent link and overstates a locator as a “running instance.” See F2. `src/db/schema.ts:446–481` records lifecycle and work association, not a parent-agent link. |
| 4 | Explicit persona binding | **met** | §§3–5 retain Task prose, omit unknown persona and reject reverse inference. `src/agentRoles/brief.ts:56–76` accepts/returns arbitrary validated specialization; it does not resolve persona. Correct the attribution of the Rowan default as noted in F4. |
| 5 | Correct capacity rules | **met** | §3 permits role-brief defaults and explicit critic resolution for the actual artifact. Matches `docs/agent-guidance/git-identity.md`, “Agent Git Identity,” and `src/agentRoles/brief.ts:53`. Fixed keys/flags retained. |
| 6 | Keep/reuse existing roster API | **met** | §§5,9 keep `agentTeammates`, legacy JSON shape and existing `agentRoster()`. Both functions exist at `agentIdentity.ts:272–309`; nested JSON is produced by `src/commands/identity.ts:88`. No implicit migration approved. |
| 7 | Preserve native-app Lead restriction | **met** | §6 explicitly preserves the exception and sole writer; harmonization is an operator choice. Matches `docs/agent-guidance/native-app-sessions.md:23–29` and role brief authority notice. |
| 8 | Function-first help; two depths; optional Iris | **met** | §§8.1–8.2,8.7 separate invocation, specialization, record method and handle, with same-agent/native/separate-session/pending routes. Existing Consultation already supports expertise selection and bounded advice. The proposed state diagram needs to accommodate those routes (F3). |
| 9 | Bound assurance | **met** | §8.3 promises visible applicability/provenance/uncertainty, not universal expertise; no-guide advice is explicitly exploratory. Retain that boundary in Decision 6 (F5). “Never refuse outright” should mean “do not refuse solely because no guide exists,” not override other limits. |
| 10 | Resolve continuity scope and distinguish request states | **partly met** | §8.4 explicitly offers a durable pre-Project home versus a Project-only pilot, which is sufficient for proposal review while undecided. §8.5's mandatory-looking chain and §10's bundled depth choice remain inconsistent with optional helper/brief paths. See F3/F5. R7 Phase 2 leaves the home and capture linking unresolved. |

No item is **not met**. Signature formats, names, emails, keys and flags remain unchanged in the recommendation. An optional future breaking migration is presented as a choice, not quietly authorized.

## 3. New and residual findings, most severe first

### F1. The peer example still implies an unrecorded capacity; observation time is not runtime freshness

**Claim:** §5 prints “attributed Cody Atlas from recorded model; persona unknown,” while §3 rule 3 forbids an unsupported peer capacity. §7 offers “a freshness timestamp” after a model change.

**Evidence:** the identity convention makes `Cody Atlas` a builder signature and `Critic Cody Atlas` the critic signature. `src/sessions/partners.ts:46` supplies model/effort but no capacity; `src/codingAgents/agentIdentity.ts:213` defaults the omitted capacity to builder. The partner reader is querying stored launch metadata, not observing a peer's current runtime. Querying an old model row now does not refresh that model evidence. Also, claim rows at `src/db/schema.ts:620–637` have Project and Action but no Plan column, so the fully scoped claim Action in §5 needs a supported resolution source or an unknown Plan.

**Smallest correction:** replace that peer text with `platform codex; tier heavy inferred from recorded launch metadata; capacity unknown; persona unknown; current runtime unverified`. Label the timestamp `records observed at`, with runtime evidence time/source separate or unknown. Render a full signature only when capacity is supported. State that claim Plan scope is resolved from an identified source or shown unavailable; do not imply all identifiers come from the claim row. The illustrative attempt ordinal is acceptable provided the example explicitly assumes a verified Session-to-attempt link and otherwise omits it.

### F2. The locator table confuses work association, identity and parentage

**Claim:** §3 says a full ID establishes uniqueness for “Exactly which running instance,” and lists Plan/Action under the Arcadia Session's “Parent link.”

**Evidence:** `src/db/schema.ts:446–481` includes prepared and terminal Sessions as well as running ones. Plan/Action references identify work, not the parent actor. `docs/agent-guidance/chat-titles.md`, “Title format,” requires an actual parent chat link/ID. Host IDs also need their issuing system/scope; a bare full string is not universally unique across providers or workspaces. A claim identifies a reservation, not an agent instance.

**Smallest correction:** say “Which recorded Session, host conversation/child, or claim?” Use typed, scoped locators (issuing host/workspace plus ID, or a resolvable link). Separate **parent-agent locator** from **work association** in the table. Parent is unknown/not applicable unless evidenced; prepared/completed state remains visible. No new persistence mechanism is required by this wording fix.

### F3. The state chain reintroduces a mandatory helper and brief

**Claim:** §8.5 presents `captured → routed → helper launched → advice delivered → brief updated` as the request states for every surface. §8.4 says consultation “works anywhere the procedure is installed.”

**Evidence:** §8.7 itself correctly allows the same agent to give advice, and §8.1 makes sustained facilitation optional. `docs/agent-guidance/consultation.md`, “Brief, launch and return,” distinguishes authorized/available routes from pending requests and requires no new consultation ledger. Its closing paragraph distinguishes loaded source from demonstrated host capability. Installation alone proves neither accessible inputs nor delivery or launch support.

**Smallest correction:** explicitly label these **proposed reporting labels, not a current persisted state machine**. Use `request received/captured → handled here OR routed to authorized helper → advice delivered`, with `brief created/updated` only for requested sustained work. Preserve awaiting-input/route and failed-delivery cases without claiming later stages. Label §8.6 as proposed target behavior except its current limitations; its mobile capture-to-brief link is proposed, not existing. Replace “works anywhere installed” with “available where guidance, inputs, capabilities and applicable authority are present; otherwise report the exact gap.” Explicitly retain proposals-only output and no self-approval of Asks for facilitation.

### F4. Several “current” labels and source attributions need small factual repairs

**Claim/evidence/correction:**

- **§7 launched teammates: “No: platform roster only.”** Current `renderIdentityBlock` also renders recorded partners when supplied (`src/codingAgents/agentIdentity.ts:353–372`), using `partners.ts`. Replace with “Partial recorded partners where available; no complete or uniquely identified team.” Lack of exactness is not absence of the existing feature.
- **§4 “Decision 0112's Rowan default.”** Decision 0112 establishes **Lead**, not the name Rowan. Attribute the conditional Rowan default to `docs/arcadia-semantics.md:164–171`; keep it separate from the Role default.
- **§9 “identity capacity” as a new prose term.** It already appears in `src/agentRoles/brief.ts:25`. Label the proposal “standardize existing prose term,” not introduce it.
- **§9 “Chat titles and pings: <role or task> allowed.”** `chat-titles.md` supports titles; it does not verify the ping implementation, which §12 expressly excludes. Split the row: current title convention verified; ping behavior unverified/proposed subject to its existing signature, delivery and messaging rules.
- **§3 rule 5 “prove nothing.”** The schema correctly says a recorded profile/specialization establishes an assignment label. Replace the absolute with “establish no runtime identity, expertise, independence or authority.”

These are localized accuracy edits, not reasons to reopen the chosen architecture. The current/proposed separation is otherwise substantially improved. Source labels do not by themselves prove installed execution, as §12 now acknowledges.

### F5. The six Decision headings are not yet six independently answerable, consequence-complete questions

**Claim:** §10 says each choice stays separately answerable.

**Evidence:** Decisions 1–4 each have one clear axis and meaningful consequences. Decision 5 combines home/scope (C1/C2) with quick-versus-full depth in an unlettered “Also choose” sentence. Decision 6 names promises but omits operational consequences, and B1's “everywhere” drops §8.3's “supported surface” boundary. B2 can be read as a guarantee of correctness from merely reviewed guides, which §8.3 expressly rejects.

**Smallest correction:**

- Keep six headings if desired, but make Decision 5 independently answerable as **5a Home/scope** and **5b Depth**, each with lettered options and consequences. For C1, state the cost of selecting/maintaining a durable accessible home and proving resumption. For 5b, retain quick consultation plus optional brief versus always-full-brief with the respective friction/recording tradeoff.
- Decision 6 A: “Visible provenance, applicability and uncertainty on supported surfaces; permits disclosed exploratory advice without a guide.” Decision 6 B: “Claim conformance only to a named, reviewed guide within its demonstrated scope; requires guide validation and withholds that assurance elsewhere, without guaranteeing design quality.”
- A brief header should state that §10 describes **unfiled proposed operator choices**, not existing Decision records. That is already the intended meaning; retain it.

**Exit criterion:** apply F1–F5 to the briefing and examples. No implementation, tests, live launch, registry change or new operator approval is required merely to make this proposal internally accurate. Subsequent execution retains its own gates.

## 4. Limits

Reviewed revision-2 briefing in full, the available revision-1 diff, and the earlier review/pass condition. Source HEAD remains `b6974693dde42df1a3303543a64b0ea2a36d689c`. Reused the previously loaded plan-critic skill and repository guidance; refreshed the decisive identity resolver/renderers, role brief, partner projection, Session/claim/attempt schema, Consultation, native-app restriction, chat-title convention, profile default and Git identity rules. Source paths/sections are cited above; instruction inventory is retained in review 3.

This is proposal review, not an implementation or runtime audit. No live database, installed skills, external JSON consumers, ping implementation, simulations, proposal-settlement receipt or author's claimed runtime was verified. No claim that a Decision has actually been filed or answered was independently checked; the briefing says none has. No tests, posting, launch, governance mutation or repository edits were performed. Only `arcadia-naming-review-3b.md` was written. The bounded changes above are the complete requested follow-up, not authorization to broaden the design.

# Evidence: how Arcadia could guide design brainstorming

Verbatim source material for the article's claims receipt, checked in so a reviewer can pin it. Captured 2026-10-28 from the proposal submitted as Agent Ask request `proposal-field-neutral-design-guidance-2026-10-28` (proposal `agentask_3bbb6cfe31923cf29a`, accepted as preserved evidence by settlement `asksettle_4f5f06945f9f489e9a`). The walk-throughs below used simulated operator personas, not real use.

## Proposal, revision 4

## Proposal: field-neutral design guidance (Phase 1, revision 4)

Revision 3 applied an adversarial domain-generality review (game, song, physical
space) and the operator's direction: website design first, then game design.
Revision 4 applies a simulated paper walk-through (website and game operator
personas): both passed with changes; evidence in sim-website-log.md and sim-game-log.md.

### Outcome
The operator can brainstorm freely in any design field and trust that every idea
is kept verbatim and leaves the session either settled, rejected on record, or
with a concrete next move, while the field's practices (when a guide exists)
shape the questions; a design that is ready to commit reaches the operator as a
design brief and governed Asks to settle.

### Milestones
1. Field-neutral core proven on paper: one vague idea each in website and game
   is walked through the core with no field guide and no code; every idea ends
   settled, rejected or with a next move, no step needs a field-specific
   assumption, and the operator would accept the resulting items unchanged
   (actually settling Asks stays the operator's choice). A simulated rehearsal
   with operator personas has been run; the real walk-through uses the operator's
   own ideas.
2. Website design field guide (first guide, operator direction): one vague
   website idea is taken through the core enriched by a website field guide to a
   ready-to-commit brief, with no website-only change to the core.
3. Game design field guide (second guide, operator direction): one of the
   operator's vague game ideas reaches a ready-to-commit brief the same way, with
   no game-only change to the core.
Later field guides follow the same path; none changes the core.

### Field-neutral core (plain language, not a schema)
- Design brief: one checked-in design Artifact per design.
- Experience target: the moment or result the whole design is judged against, in
  the operator's words (e.g. "on the twentieth night it finally turns and looks at
  you"); probes test against it.
- Principles: the operator's convictions and taste ("no hunger bars", "wet chalk",
  "one textarea"); settled on statement, recorded with operator-practice provenance.
- Idea: a verbatim capture of any size or medium; never requires classification.
- Element: a part of the design that matters; core, conditional or optional; from a
  field guide or emerging from ideas; elements inform each other, cycles allowed.
  An idea may stay attached to several elements as one knot; separating them is
  only ever a suggestion.
- Position: open, candidates, leaning, chosen (an operator Decision), evidenced
  (a probe result) or rejected (kept on record, no next move; the operator may
  still act against it). Any position can be reopened, and positions move
  conversationally without ceremony.
- Next move, at most one per open idea or element: ask (one question), decide (a
  Decision with options in the operator's words), probe (the cheapest experiment
  that produces an Artifact; the operator states who performs it, how it is
  judged, "gut" included, and how long it will really take), waits on (another
  named move), or park (a near "revisit at the end of this design" list, or the
  Back Burner with a revival condition for ideas outside this design).
- Advice: the facilitator may state a risk once in conversation; advice is never
  an item, a gate or a next move.
- Field guide (optional): elements, competing frameworks, questions and probe
  types, each entry carrying provenance.
- Ready to commit: core elements chosen, the experience target's riskiest
  assumption probed or explicitly accepted, every other open item has a next move.
  Not ready is the normal end of a first session; its output is the probes and
  open Decisions.

### Behavioral brief
- REQ-001 Capture first: any idea at any time is kept verbatim before any question is asked.
- REQ-002 Next move: every open idea or element leaves a session with exactly one next move (including "waits on"); settled, principle and rejected items need none.
- REQ-003 Suggest, don't impose: the guide proposes which elements an idea touches and which element to work next (the operator's lead or the riskiest open one); once the operator declines a suggestion (e.g. separating a knot) it is not asked again.
- REQ-004 Related change: changing a chosen or evidenced element flags every element it informs; already-settled governed work changes only through the existing amendment path.
- REQ-005 No guide still works: a field with no guide gets the generic core (experience target, audience, constraints, principles, riskiest assumption) and elements emerge from ideas.
- REQ-006 Provenance: every field-guide entry is marked cited source, operator practice or agent inference (reusing `learn` provenance/confidence terms); missing provenance fails validation; where a field has competing frameworks, choosing one is a Decision.
- REQ-007 Commit output: a ready-to-commit design yields Asks previews only: the brief as an `artifact` Ask, plus Outcome, Milestone and Decision Asks, plus the probe list for Phase 2; nothing self-approves and the brief grants no authority.
- REQ-008 View: the operator can view the brief read-only; any view is derived from the checked-in brief.
- REQ-009 Operator's words: options, probe judgments and estimates use the operator's vocabulary and numbers; the facilitator never asserts a probe's size or rewrites a conviction.
- Edge cases: conflicting ideas stay as competing candidates until a Decision; a brainstorm resumes from the checked-in brief in a later session; a brainstorm can start before any Project exists; the operator may act against a rejected item.
- Non-goals: generating the work; third-party guide sharing; AI judging design quality; interactive board.

### Open Decisions (Phase 1)
1. Architecture
   (A) Few built-in fields in code: fastest; every new field needs code changes.
   (B) Field-neutral core only: works for any field; no field knowledge.
   (C*) Field-neutral core + optional field guides as data: new fields need only a guide; requires a guide format (new; analogous to Decision 0074's data-not-code principle).
   (D) Code plugin system: most flexible; highest cost; drifts toward excluded third-party sharing.
2. Role for design facilitation (a Behavior run between Phase 1 and Phase 2)
   (A) A design-facilitation Behavior followed by `planner`: no registry change or new authority.
   (B*) A named creative-facilitation profile on `planner` carrying that Behavior: an addressable role by name and function, distinct from Ellis the Engineer; no registry change or authority.
   (C) An eighth registered role: first-class contract; changes the role registry and Decision 0114 delegation; operator-only authority change.
3. Field-guide authorship
   (A*) Operator-curated with agent research; operator ratifies each guide: trustworthy; costs operator time per guide.
   (B) Agent-drafted with a mandatory operator ratification pass: faster; risk of confident shallow guidance if review is light.
   (C) Import external guides verbatim: fastest; copyright, staleness and fit risk.
4. Probes the operator performs (playtests, demo listens, mock-ups)
   (A*) A Decision with an evidence Artifact attached: no schema change; probes do not appear in the work queue.
   (B) An Action with a new operator responsibility: visible and trackable; changes the dispatch and completion contract (responsibility today is autonomous | agent | requires_review | blocked; completion needs a git candidate_revision); needs its own Decision.
   (C) Operator to-do items only: cheapest; least governed.
5. Revival condition for this proposal
   (A) Dependency on a named Action the operator picks reaching done: automatic resurfacing; must name a real Action.
   (B) Manual: resurfaces when the operator browses the shelf; truthful, may never resurface.

### Phase 2 open questions (not decided here)
- Where a brief lives before a Project exists (for example the source-ref of an unscoped Back Burner item).
- Field-guide format and home.
- Whether Decision-to-Decision links need enforcement; out of scope until a brief proves it.
- The view's surface.
- Linking items captured in the existing /capture PWA to a brief (deferred; mobile capture itself already exists).

### Terminology
"Field" and "field guide", not "domain"/"domain pack": Domain is a core Arcadia
term (a life/work area) and "domain pack" already means a business vertical's copy rules.

## Simulated walk-through log: website

## Simulated paper walk-through: website (Fable web-developer persona)

Facilitator: Ellis, following the revision 3 field-neutral core only (no field guide).

### Round 1: persona opening (verbatim ideas)
- I1 "a waitlist for local trades... 'I need someone for X, I'm not in a hurry, ping me when you have a gap.' Not a directory."
- I2 "Name's something like Slack Days or Gap Day, haven't decided."
- I3 "Tech: I want it boring. Server-rendered, maybe Astro or plain Rails... might just do HTML + a tiny bit of JS."
- I4 "the 'request' form should be one textarea. One. No dropdowns for category. I'll classify it later."
- I5 "a site that just shows the tide times for my town, big numbers, nothing else. Might bolt that on. Probably shouldn't."
- I6 "who pays? Probably nobody. Fine for v1."

### Facilitator round 1
Emerging elements (generic core + from ideas): Purpose/experience, Audience (two-sided),
Core (gap-matching waitlist), Request capture, Name, Constraints (tech), Business model,
Riskiest assumption.

| Idea | Suggested elements | Next move |
|---|---|---|
| I1 | Core, Purpose, Audience | probe: riskiest assumption (below) |
| I2 | Name | decide (later; candidates: Slack Days, Gap Day) |
| I3 | Constraints | chosen? ask-free: record as constraint candidate, decide when stack matters |
| I4 | Request capture | chosen (operator stated firmly) |
| I5 | outside this design | park (Back Burner, manual) |
| I6 | Business model | decide: "no revenue in v1" accepted as explicit risk |

Observation (strain): I3 and I2 have no natural "next move" now. Forcing exactly one
next move on them is ceremony. Candidate fix: allow "wait: no move until X" as a
valid next move, or treat a stated preference as a chosen-but-reopenable position.

### Round 2: persona (verbatim ideas)
- I4 confirmed chosen. I5: "Don't park the tides thing too far away, I'll come back to it."
- I7 "lead apps send them strangers who want quotes. This sends them people who already said yes, just not when. No quoting, no haggling, you just pick a Tuesday."
- I8 "maybe the tradesperson never opens anything. Maybe they get a text: '3 people waiting, reply Y for the list.' ... No login. Contradicts my 'site' idea... the site's for the homeowners then."
- Probe accepted: "I know Dean (electrician) and the gate guy. I'll ask them this week. Not building before that. Well. Maybe the textarea page."

### Facilitator round 2
- I7 -> Purpose/Core: candidate value proposition; informs Audience and Core.
- I8 -> new element "Tradesperson channel": candidates SMS-only vs site; it informs Core and Constraints (I3: server-rendered stack now covers only the homeowner side). Flag I3 as affected (REQ-004 informs-change worked naturally; cycle Core<->Channel<->Constraints).
- Riskiest assumption now concrete; probe = operator asks Dean + gate guy this week; judged by operator. Evidence Artifact = their answers.
- Brief NOT ready to commit (riskiest assumption neither probed nor accepted). Output = brief + next moves, no Outcome/Milestone Asks yet.

Observations (strain):
- S2 Park strength: operator wants the tide idea "close". Back Burner manual vs "near" is not expressible; condition types are date/dependency/predicate. Fix candidate: park with "revisit at end of this design" as a brief-local list, not Back Burner.
- S3 Operator wants to build the textarea page before the probe. Core has no stance on "build before evidence"; guide should name the risk once, not block (suggest, don't impose).
- S4 Not-ready output is the common case after session 1. The actionable artifacts are the probe and the open Decision, which is good, but the operator-performed probe has no governed home today (Decision 4).

### Round 3: persona verdict on the four items: "Mostly yes."
- Probe accepted but: "I'm not reading them a script... judge by gut."
- Keep/Change/Drop accepted; wants "shelve" instead of "drop".
- Text vs site: "not really a decision yet, it's a hunch I'll know more about after #1. Fold it into #2."
- Textarea heads-up as a numbered item "smelled like" bureaucracy; will build anyway.
- "put 'name: Gap Day (leaning)' somewhere. I think I've decided."

### Website result: passes with changes
Every idea got a next move; no website-only assumption was needed; operator would
accept the items with small edits (not unchanged).

Findings:
- S1/S5 "Exactly one next move" is too strict. Some items legitimately wait on another
  move (text-vs-site waits on the probe; stack waits on channel). Allow "waits on <move>".
- S2 Park distance: need a near "revisit at end of this design" list, separate from Back Burner.
- S3/S6 Advice is not an item. Heads-ups are said once in conversation, never numbered.
- S4 Not-ready is the normal end of session 1; the actionable output is probes + open Decisions.
- S7 The operator chooses how a probe is judged ("gut" is valid); no scripted probes.
- S8 Use the operator's vocabulary for options ("shelve", not "drop").
- S9 Positions move conversationally ("Gap Day (leaning)") with no ceremony; "leaning" is a real position between candidates and chosen.

## Simulated walk-through log: game

## Simulated paper walk-through: game (Fable game-developer persona)

Facilitator: Ellis, following the revision 3 core plus the website amendments
(waits-on moves, leaning position, near-park list, advice not itemized,
operator's words for options).

### Round 1: persona opening (verbatim ideas)
- G1 "You're a lighthouse keeper but the lighthouse is dead and you're trying to keep something alive by hand... the light is a creature, or a fire, or a person maybe, and it needs you."
- G2 "The verb is tending. Or coaxing? Those are different and I keep swapping them."
- G3 "Not survival-crafting. I hate hunger bars."
- G4 "it's 3am, storm, you've been feeding the thing for twenty nights and tonight it finally turns and looks at you. That's the whole game honestly."
- G5 "Art mood: wet chalk. Everything slightly smeared."
- G6 "Switch probably, or PC first because I'm one guy with evenings."
- G7 "a ship-visitor system with a reputation grid and that's a different game, I know it is, and I'm going to build it anyway."

### Facilitator round 1
Elements emerged (no game guide): Player fantasy, Core verb, Core loop (a night),
Progression/payoff (the relationship across nights), Tone/art, Platform, Scope.
Informs links form a cycle: Verb <-> Loop <-> Progression <-> Fantasy (G4 is both
loop payoff and progression).

| Idea | Elements | Position | Next move |
|---|---|---|---|
| G1 | Fantasy | candidates (creature / fire / person) | waits on probe |
| G2 | Verb | candidates (tending / coaxing) | waits on probe |
| G3 | Loop, Tone | chosen (taste conviction; operator practice) | none needed |
| G4 | Progression, Loop | chosen as the north-star moment | probe |
| G5 | Tone/art | chosen (taste) | none needed |
| G6 | Platform | leaning PC first | waits on scope |
| G7 | outside this design (operator's own words) | — | park near, operator says he'll build anyway: say once, don't itemize |

Riskiest assumption: tending without meters stays compelling night after night and
the 20th-night look lands. Probe: cheapest toy of one night.

Observations (strain):
- G-S1 Two elements are chosen with "none needed" next move: taste convictions settle instantly. Core rule "exactly one next move per open idea/element" holds only because they are no longer open. Fine.
- G-S2 The informs graph is cyclic as predicted; ordering-free core held.
- G-S3 G4 is an experience target, not a choice: it's the acceptance criterion for the whole design. Core lacks an "experience target" concept; it got squeezed into Progression.

### Round 2: persona (verbatim)
- G8 "it's not numbers, it's the thing's body. It flickers less. It leans toward where you usually stand. The stairs creak differently... Change lives in the room, not a panel."
- G9 "it should sometimes get WORSE for no reason you did, because real things do, and I'll die on that hill."
- G10 "what if the light remembers one specific wrong thing you did and never quite forgives it. One grudge. That's the whole progression maybe. Or it's a tangle with the tending, I can't separate them, stop asking me to."
- Probe: "yes, but ten minutes is a lie, it'll be a weekend... Blob, one action, one night."
- Verdict: "I'd accept your list unchanged except the ship stuff isn't 'nearby', it's 'no', and I'll still probably build it."

### Game result: passes with changes
No game-only change to the core was needed beyond the gaps below; the operator would
accept the items unchanged except the parking of G7.

Findings:
- G-S3 Experience target: G4 is the yardstick for the whole design, not an element choice. Add "experience target" to the generic core (purpose/experience already gestures at it; make it explicit and testable by probes).
- G-S4 Tangles: the operator refused to separate grudge, tending and progression. The core must let an idea stay attached to several elements as one knot; separating them is a suggestion the operator may reject (REQ-003 holds, but facilitation must stop re-asking).
- G-S5 Rejected is not parked: "it's 'no'" plus "I'll still probably build it". Need a "rejected (kept on record)" state with no next move, distinct from park; the operator may still act against it.
- G-S6 Probe cost belongs to the operator: "ten minutes is a lie, it'll be a weekend". The facilitator must not assert probe size; ask or record the operator's estimate.
- G-S7 Taste convictions (G3, G5, G9) settled instantly with operator-practice provenance; confirms REQ-006's provenance categories.
- G-S8 Unpredictable downturns (G9) are a design principle, not an element: principles/convictions need a place in the brief alongside elements.

## Round 2 and revision 5 (added 2026-10-28)

Verbatim source material for the revision 5 update. Unlike the revision 4 proposal above, revision 5 is a draft held in a scratchpad awaiting operator review; it has not been submitted as an Agent Ask, and nothing here changes any Plan or queue. The round 2 personas are simulated and fictional. Each file below is reproduced unaltered inside a four-backtick fence so its own headings do not mix with this file's. Source file names are given as relayed by Rowan; the scratchpad copies are not in the repository.

### Proposal, revision 5 (draft)

````markdown
# Proposal: field-neutral design guidance (Phase 1, revision 5)

Revision 3 applied an adversarial domain-generality review (game, song, physical
space) and the operator's direction: website design first, then game design.
Revision 4 applied a simulated paper walk-through (one website persona, one game
persona); both passed with changes.
Revision 5 applies a second simulated round. Five operator personas: two
website, two game (one physical, one with two owners) and one song. The core
held in all five with no field-specific change, including the song. Only one
persona accepted the record unchanged. Most recurring defects were in how the
facilitator records and speaks. Two exposed gaps in the core itself: it assumed
a single decision owner, and near parks had no way back. Revision 5 adds Owner
and revival conditions for those. Evidence:
sim2-synthesis.md and the five sim2-*.md logs.

## Outcome
The operator can brainstorm freely in any design field and trust three things:
- Every idea is kept verbatim, in its original medium, at the strength and
  scope the operator gave it.
- Every idea leaves the session settled, rejected on record, or with a concrete
  next move that has an owner.
- The field's practices, when a guide exists, shape the questions.

A design that is ready to commit reaches its owners as a design brief and as
governed Asks to settle.

## Milestones
1. **The field-neutral core is proven on paper.** One vague idea each in website
   and game goes through the core with no field guide and no code. Every idea
   ends settled, rejected or with a next move. No step needs a field-specific
   assumption. The operator would accept the resulting record unchanged.
   Actually settling Asks stays the operator's choice. Two simulated rounds with
   operator personas have been run (seven runs across website, game and song).
   The real walk-through uses the operator's own ideas.
2. **Website design field guide** (the first guide, by operator direction). One
   vague website idea goes through the core, enriched by a website field guide,
   to a ready-to-commit brief, with no website-only change to the core.
3. **Game design field guide** (the second guide, by operator direction). One of
   the operator's vague game ideas reaches a ready-to-commit brief the same way,
   with no game-only change to the core.

Later field guides follow the same path. None of them changes the core.

## Field-neutral core (plain language, not a schema)
- **Design brief:** one checked-in design Artifact per design. Its top holds the
  experience target, the principles and the stated scope, each attributed to
  whoever said it.
- **Experience target:** the moment or result the whole design is judged
  against, in the owners' words. Examples: "on the twentieth night it finally
  turns and looks at you"; "the thing you feel when you put a heavy bag down".
  If none has been stated, one question asks for it. Probes test against it. A
  design may have more than one target, for example the lasting moment plus a
  festival-booth test.
- **Principles:** the owners' convictions and taste. Each is recorded at the
  strength it was given: a rule ("no passwords, ever") or a feel ("chord barely
  changes is the feel, not a law"). A principle is settled when stated, carries
  operator-practice provenance, and only its owner rewords it.
- **Learned:** what a probe or past attempt showed, scoped to exactly what was
  tried ("that one steal rule felt mean"). A learned result is evidence, not a
  principle. It becomes a principle only when the owner says so. A probe's own
  acceptance bar may become a principle when the owner states it as one ("the
  real version has to be about as easy as a text").
- **Idea:** a verbatim capture of any size or medium. Never requires
  classification. A non-text idea (photo, voice memo, sketch, reference site) is
  kept as the original, attached or marked "to attach", alongside the owner's
  own description. Never transcribe it or normalize it to the facilitator's
  words. An idea can be marked "thinking out loud": kept, with no position.
- **Element:** a part of the design that matters, whether core, conditional or
  optional. Elements come from a field guide or emerge from ideas, and they
  inform each other (cycles are allowed). An idea may stay attached to several
  elements as one knot; separating them is only ever a suggestion. A link the
  facilitator infers is shown as a suggestion until the owner confirms it. An
  element may be recorded as one route to an experience target. This keeps
  cheaper substitutes open ("#2 is one way to get #5").
- **Owner:** who decides each element: one person, everyone jointly, or one
  person after a condition ("art, Dev after the two-day pass"). The default is
  the single operator. The views of an absent owner or stakeholder are kept
  attributed ("Ana says ...") and are never merged into the present owner's
  view.
- **Position:** one of the following. Any position can be reopened, and
  positions move conversationally without ceremony. Options are recorded exactly
  as wide as stated: "hasn't seen a buy button that feels right" is not "won't
  have one".
  - open
  - candidates
  - leaning (with the owner's reason, when given)
  - chosen (an owner's Decision)
  - evidenced (a probe result)
  - rejected (kept on record with its reason and no next move; the owner may
    still act against it)
- **Next move:** at most one per open idea or element. It names who does it.
  Facilitator-owned moves are marked as the facilitator's and never attributed
  to the operator. It also names when, in the owner's terms: a date, or a step
  such as "before I write a second verse". It lists only the items it actually
  settles. The kinds of move:
  - **ask:** one question.
  - **decide:** a Decision with options in the owner's words, each carrying its
    cost in the owner's numbers ("a two-day pass").
  - **probe:** the cheapest experiment that produces an Artifact. The owner says
    who performs it (chosen for a valid result), how it is judged ("gut"
    included), and how long it will really take. The material may set the pace
    ("the kiln doesn't care").
  - **waits on:** a named move that settles this item.
  - **park:** see below.
- **Park:** every park has a revival condition, near or far. The conditions are
  "revisit at the end of this design", a date ("the week after the festival"),
  a trigger ("if people ask 'can I keep that?'"), or held hidden until a date or
  step ("don't let it come back up before"). Ideas outside this design go to the
  Back Burner with a revival condition. An urgent real-world task outside the
  design goes to the operator's to-do (see Decision 4), not to the shelf.
- **Visible:** items the owner marks as energizing ("the bit I'm actually
  excited about") stay in view whatever their position or next move.
- **Advice:** the facilitator may state a risk once in conversation. Advice is
  never an item, a gate or a next move.
- **Field guide (optional):** elements, competing frameworks, questions and
  probe types, each entry carrying provenance.
- **Ready to commit:** the core elements are chosen; the experience target's
  riskiest assumption is probed or explicitly accepted; every other open item
  has a next move with an owner. "Not ready" is the normal end of a first
  session, and its output is the probes and the open Decisions.

## Behavioral brief
- **REQ-001 Capture first:** any idea, at any time and in any medium, is kept
  verbatim or as its original before any question is asked.
- **REQ-002 Next move:** every open idea or element leaves a session with
  exactly one next move, including "waits on". The move names its owner, its
  "when" in the owner's terms, and only the items it settles. Settled items,
  principles, learned results and rejected items need none.
- **REQ-003 Suggest, don't impose:** the guide proposes which elements an idea
  touches, which links connect them, and which element to work next (the
  operator's lead or the riskiest open one). Once an owner declines a
  suggestion, for example separating a knot, it is not asked again.
- **REQ-004 Related change:** changing a chosen or evidenced element, or a
  principle, flags every element it informs. Already-settled governed work
  changes only through the existing amendment path.
- **REQ-005 No guide still works:** a field with no guide gets the generic core
  (experience target, audience, constraints, principles, riskiest assumption),
  and elements emerge from ideas.
- **REQ-006 Provenance:** every field-guide entry is marked as a cited source,
  operator practice or agent inference, reusing the `learn` provenance and
  confidence terms. Missing provenance fails validation. Where a field has
  competing frameworks, choosing one is a Decision. Third-party advice that an
  owner merely repeats ("someone on a podcast said ...") is an idea, not a
  guide entry.
- **REQ-007 Commit output:** a ready-to-commit design yields Ask previews only:
  the brief as an `artifact` Ask, plus Outcome, Milestone and Decision Asks,
  plus the probe list for Phase 2. Nothing self-approves, and the brief grants
  no authority.
- **REQ-008 View:** the owners can view the brief read-only. Any view is derived
  from the checked-in brief.
- **REQ-009 Owners' words:** options, probe judgments and estimates use the
  owners' vocabulary and numbers. The facilitator never asserts a probe's size.
  Core terms ("probe", "waits on", "position") stay internal. In conversation
  the facilitator says what the owner would say ("the test", "not decided"),
  and asks for a probe's who, how and how long conversationally, not as a
  checklist.
- **REQ-010 Record fidelity (new):** the record states exactly what was said, no
  more and no less. That covers strength (rule vs feel), scope (a learned result
  vs a principle), width (options are not narrowed) and direction (inferred
  links are suggestions). An owner who says "that isn't what I said" about any
  row is a failed record.
- **REQ-011 Owners (new):** each element has a decision owner. Absent owners'
  and stakeholders' views stay attributed. A joint decision is chosen only when
  every joint owner has chosen.
- **REQ-012 Revival (new):** every park, near or far, carries a revival
  condition. Hidden-until conditions keep an item out of view until they are
  met.
- **Edge cases:**
  - Conflicting ideas stay as competing candidates until a Decision. An owner
    may dissolve a conflict by rewording their own principle.
  - A brainstorm resumes from the checked-in brief in a later session.
  - A brainstorm can start before any Project exists.
  - An owner may act against a rejected item.
  - Sensitive personal material is the owner's call alone, and the facilitator
    doesn't press it.
- **Non-goals:** generating the work; third-party guide sharing; AI judging
  design quality; an interactive board.

## Open Decisions (Phase 1)
1. **Architecture**
   - (A) A few built-in fields in code. Fastest, but every new field needs code
     changes.
   - (B) Field-neutral core only. Works for any field, but has no field
     knowledge.
   - (C*) Field-neutral core plus optional field guides as data. A new field
     needs only a guide, but this requires a guide format (new, analogous to
     Decision 0074's data-not-code principle). Round 2 supports this: three
     fields ran on the core alone.
   - (D) A code plugin system. Most flexible, but highest cost, and it drifts
     toward the excluded third-party sharing.
2. **Role for design facilitation** (a Behavior run between Phase 1 and Phase 2)
   - (A) A design-facilitation Behavior followed by `planner`. No registry
     change or new authority.
   - (B*) A named creative-facilitation profile on `planner` that carries that
     Behavior. It is addressable by name and function and distinct from Ellis
     the Engineer, with no registry change or authority. Round 2 found that the
     facilitator's voice and record fidelity are the hard part, which favours a
     dedicated profile with its own brief.
   - (C) An eighth registered role. A first-class contract, but it changes the
     role registry and Decision 0114 delegation, and is an operator-only
     authority change.
3. **Field-guide authorship**
   - (A*) Operator-curated with agent research; the operator ratifies each
     guide. Trustworthy, but costs operator time per guide.
   - (B) Agent-drafted with a mandatory operator ratification pass. Faster, but
     risks confident shallow guidance if the review is light.
   - (C) Import external guides verbatim. Fastest, but carries copyright,
     staleness and fit risk.
4. **Probes and urgent to-dos the operator performs** (playtests, demo listens,
   mock-ups, the outside-design task that matters this week)
   - (A*) A Decision with an evidence Artifact attached for probes; urgent
     outside-design tasks go to the operator to-do list. No schema change, but
     probes do not appear in the work queue.
   - (B) An Action with a new operator responsibility. Visible and trackable,
     but it changes the dispatch and completion contract (responsibility today
     is autonomous | agent | requires_review | blocked, and completion needs a
     git candidate_revision), so it needs its own Decision.
   - (C) Operator to-do items only, for both. Cheapest, but the least governed.
5. **Revival condition for this proposal**
   - (A) A dependency on a named Action, which the operator picks, reaching
     done. It resurfaces automatically, but must name a real Action.
   - (B) Manual. It resurfaces when the operator browses the shelf. Truthful,
     but it may never resurface.

## Phase 2 open questions (not decided here)
- Where a brief lives before a Project exists, for example as the source-ref of
  an unscoped Back Burner item.
- The field-guide format and its home.
- Whether Decision-to-Decision links need enforcement. Out of scope until a
  brief proves it.
- The view's surface.
- Linking items captured in the existing /capture PWA to a brief. Deferred;
  mobile capture itself already exists.
- How owners who are not Arcadia operators (a co-founder, a bandmate) are named
  and attributed in a brief, given that Arcadia's governance has a single human
  operator. The views of non-operator owners are recorded; only the operator
  settles Asks.
- How near parks with date or trigger conditions are surfaced. Reuse Back
  Burner revival machinery scoped to the brief, or keep a brief-local list.
- How non-text originals (audio, images) are stored as brief attachments
  without leaking private material.

## Terminology
Use "field" and "field guide", not "domain" or "domain pack". Domain is a core
Arcadia term (a life or work area), and "domain pack" already means a business
vertical's copy rules. "Owner" here means a design's decision owner, not an
Arcadia operator or a Responsibility value.
````

### Round 2 synthesis (sim2-synthesis.md)

````markdown
# Simulation round 2 synthesis (2026-10-28): five Fable personas, three fields, revision 4 core

| Run | Field | Verdict | Ready to commit |
|---|---|---|---|
| Rosa | website | accepted as written | no (probe pending) |
| Teo | website | not as written; yes with fixes | no |
| June | game (physical) | accepted with changes | no |
| Dev | game (two owners) | accepted with four edits; absent co-owner would too | no |
| Sam | song | accepted with three edits | no |

Held: every idea in all five runs got a home; no field-specific change to the core (song included); taste rules, verbatim capture of image/audio, the leaning position, the say-advice-once rule, operator-set probe judging and duration, and date revival all worked.

Recurring defects (revision 5 candidates):
1. Facilitator drift: the record says more or less than the operator said (J-S1, T-S3, T-S4, S-S1; and S8 from round 1). Rule: record strength and scope exactly as stated (rule vs feel; "learned once" vs principle; "haven't seen one" vs "won't"); inferred links are marked as suggestions.
2. Core jargon leaks (J-S3, T-S1, S-S4): "probe", "waits on" and a three-part question read as a clipboard. Rule: core terms stay internal; use the operator's words ("the test", "not decided").
3. Next moves need more than a verb (T-S2, S-S2, S-S3): who does it, by when in the operator's terms (a date or a step), and only the items it actually settles.
4. Every park needs a revival condition, near ones included (D-S3, S-S5, R-S3): end-of-design, date, trigger, or suppression until a date; urgent non-design items go to the operator's to-do, not the shelf.
5. More than one owner (D-S1, D-S5): decision owner per element, and attributed views of absent stakeholders.
Smaller: probes can yield principles (R-S2); energizing items stay visible (J-S2); a "thinking out loud" marker (T-S5); decide options carry their cost (D-S2); features are routes to the target (D-S4).
````

### Round 2 log: website, Rosa (sim2-website-rosa.md)

````markdown
# Simulation round 2: website (Fable persona Rosa, community fridges)
Facilitator: Ellis, revision 4 core, no field guide.

Ideas R1-R9 verbatim in transcript. Hidden contradiction: R9 "just the volunteers" vs R3 "no login for anybody".

Record round 1: experience target R1 ("bare and they feel stupid for going"); principles R3, R6, R7, R8;
R1 chosen core -> probe; R9 vs R3 -> decide; R5, R2 -> waits on probe; R7b donor wall -> near list; R4 Tuesday cord person -> Back Burner (outside design).

Operator verdict: "The rest of the list I'd accept as written." Resolved R9 vs R3 herself: "no passwords, ever. Volunteers get a link."
Probe accepted: volunteers text full/empty; Dede + Marcus + others; two weeks starting Monday; judge: "texts from most visits for two weeks without having to nag ... If I'm chasing people by Thursday, it doesn't".

Result: passes (accepted as written). Not ready to commit (probe pending): normal.

Findings:
- R-S1 Operator refined her own principle to dissolve a conflict ("no login" -> "no passwords, ever"). Core allowed it (reopen + operator's words); the facilitator must record the new wording, not keep the old. Confirms REQ-009 direction: only the operator rewrites a conviction.
- R-S2 A probe's acceptance bar produced a new principle for the later build: "The real version has to be about as easy as a text." Probes can yield principles, not just evidence; core should say so.
- R-S3 NEW: the one urgent real-world item (cord check) was outside the design and got shelved: "the one thing ... that actually matters this week ... got shelved." Back Burner is the wrong home for an urgent operator task; outside-design items need a "your to-do, not this design" route (ties to proposal Decision 4C / operator to-do).
- R-S4 Operator gave a probe start date and a stop rule; "operator states how long" was enough to carry both.
- R-S5 Principles must be guarded across sessions: "don't let anybody talk you out of the login one later." Supports REQ-004 (changing a chosen element is flagged), extended to principles.
````

### Round 2 log: website, Teo (sim2-website-teo.md)

````markdown
# Simulation round 2: website (Fable persona Teo, studio ceramicist)
Facilitator: Ellis, revision 4 core, no field guide. Image/reference-first operator.

Record round 1: experience target T1 (shelf by the window, morning light); principles T6 (no white-background shots), T9 (phone only);
T2 photo -> attach; T3 reference site -> find; T4 email vs lost sales kept as knot -> waits on probe; T5 catalogue vs kiln openings -> waits on probe; T7 actual-size glaze -> "ask, later", informs from T6; T8 box card -> near list.

Operator verdict: "As it is right now, no, because two of the rows say things about me that aren't what I said." With fixes, yes.
Probe accepted: next kiln opening (~6 weeks out, ~2 months to know); Teo alone; judged by "did I lose a piece to a double-promise, and did I feel like a shopkeeper or like myself".
Colour in operator's words: "the inside of a bread crust ... If you write 'cream' or 'off-white' I'll know you didn't look."

Result: passes only with fixes (not accepted as written).

Findings:
- T-S1 RECURS (J-S3): "I don't know what a probe is, and it makes it sound like somebody's going to run a test on me. Just say 'not decided.'"
- T-S2 NEW: a next move with no actor ("ask, later: ask who? ... Don't put my name on a thing I'm not doing"). Every next move names who does it; facilitator-owned moves are labelled as the facilitator's.
- T-S3 NEW: facilitator inferred an informs link in the wrong direction (photos limit texture; really the site does). Inferred links are agent inference, shown as suggestions.
- T-S4 RECURS (J-S1 family): facilitator narrowed an option ("sell without a button") beyond what was said ("Teo hasn't seen a buy button that feels right, not Teo won't have one").
- T-S5 "record it, but as me thinking out loud, not a decision": captures need a "thinking out loud" marker that carries no position.
- T-S6 Probe duration is set by the material ("the kiln doesn't care"); operator estimate honoured.
- T-S7 Non-text media: the photo is attached later; the operator's own description is kept verbatim, never normalized to a palette word.
````

### Round 2 log: game, June (sim2-game-june.md)

````markdown
# Simulation round 2: game (Fable persona June, physical 2-player train card game)
Facilitator: Ellis, revision 4 core, no field guide. Non-digital game.

Record round 1: experience target J4 ("oh, you sneaky thing. Cosy menace"); principles J1 (<=4 face-up), J7 (one stop), J8 (no stealing that feels like stealing);
J2 draft rule rejected-with-reason, "passing felt nice" kept as playtest evidence; J3 hand/no hand -> waits on probe; J9 weird card -> waits on core; J6 podcast advice -> none; J5 route game -> shelved outside design.
Question: was Sam's setup hidden or in plain sight?

Operator verdict: accepts with changes. "In plain sight ... It needs me to be looking at the wrong thing" -> J3 leaning no-hand with her reason.
Test: napkin no-hand 4-card version, five commutes, judged by "whether either of us goes 'oh you sod' out loud"; once in five = something there; two weeks incl. making napkins.

Result: passes with changes.

Findings:
- J-S1 NEW: facilitator over-promoted one playtest result into a principle ("no stealing"). "Call it a thing we learned, not a rule." Core needs a distinct "learned" record (evidence, scoped to what was tested) separate from principles; the facilitator never generalizes evidence into a rule.
- J-S2 NEW: "waits on" can bury the item the operator is most excited about. Items the operator marks as energizing must stay visible regardless of position/next move.
- J-S3 NEW: core vocabulary leaked: "what probe? ... If you mean something else you're planning to do to me, no thank you." REQ-009 must cover the facilitator's own terms: speak the operator's words ("the test"), keep core terms internal.
- J-S4 One well-chosen question moved a position (hand -> leaning no-hand) with the operator's reason attached; "leaning, don't close it" confirms the leaning position again (cf. S9).
- J-S5 Third-party advice the operator half-believes (podcast) fit as an idea with no next move; no provenance problem because it is not a field-guide entry. Fine.
- J-S6 Non-digital game: no core change needed.
- Final: after the edits, "Record accepted as written."
- J-S7 The operator sharpened the test so it judges the design, not a person: "it's a test of whether the game lets *anyone* be sneaky in plain sight." The operator owns the judging criterion; it held.
````

### Round 2 log: game, Dev (sim2-game-dev.md)

````markdown
# Simulation round 2: game (Fable persona Dev, co-founder, online party game, 11-week festival)
Facilitator: Ellis, revision 4 core, no field guide. Two owners; co-founder Ana absent, quoted.

Record round 1: experience targets D5 ("you had to be there") and D3 (stranger laughing within 90 s at the booth); principle D7 (3-minute rounds);
D1 bluff vs heist -> decide with Ana; D6 art leaning Dev, not settled with Ana; D4 money -> decide with Ana (after festival?); D2 laugh detection -> waits on D1, risk said once; D9 host -> ask later; D7b spectator and D8 scrapbook -> end list.
Question: who decides when you and Ana disagree?

Operator verdict: accepts with four edits; "Would Ana? Yes, faster than me."
Decision rights answered: "money, Ana; loop, both; art, Dev *after* the two-day pass."
Probe accepted: Ana runs it ("if I run it I'll explain the game for ten minutes"); stopwatch to first real laugh, record its cause; bluff then heist, swap order with a second group; one weekend.

Result: passes with changes.

Findings:
- D-S1 NEW (major): core assumes one operator. Needs per-element decision owner (one person, both, or one person after a condition) and attributed views of absent stakeholders ("Ana says ...").
- D-S2 NEW: the real disagreement was the cost of getting evidence (a two-day vector pass), not the style. Decide options carry their cost in the operator's numbers.
- D-S3 NEW (strengthens S2): three park distances: end list, a date ("the week after the festival") and a trigger ("if ... people asking 'can I keep that?'"). "The end list is where ideas go to die": every park, near or far, needs a revival condition.
- D-S4 NEW: a feature is one route to the experience target ("#2 is one way to get #5. If there's a cheaper way ... I will take it"). Elements can be recorded as means to the target, which keeps substitutes open.
- D-S5 Scope stated by an absent owner belongs at the top of the brief, attributed.
- D-S6 Who performs a probe is chosen for validity, not convenience; the operator-states-who rule held.
- D-S7 Risk said once was noticed and accepted ("You did say it once. I noticed."). The advice rule held.
````

### Round 2 log: song, Sam (sim2-song-sam.md)

````markdown
# Simulation round 2: song (Fable persona Sam, wedding song in 16 days). First non-website, non-game field.
Facilitator: Ellis, revision 4 core, no field guide.

Record round 1: principles S9 (not a first-dance song), S3 (drone, chord barely changes), S6 (16 days, acoustic, outdoors, 3.5 min, play crying);
S1 voice memo -> attach as audio; S2 line kept, 2b open; S4 2 a.m. story -> decide, "in your own time"; S5 who sings, S7 tempo -> both wait on probe; S8 Oregon song -> Back Burner until after the wedding (date revival); lower key said once.
Question: what should Jess feel when the song ends?

Experience target, from the answer: "Relief, I think. The thing you feel when you put a heavy bag down."
Operator verdict: accepts with three edits. "Attach the memo, yes. Don't transcribe it."
Probe: back step, phone, play the sigh four or five times into the wind, headphones, ~15 minutes, Thursday; judged by "does the falling bit still land when half the notes are blown away".

Result: passes with changes. No song-specific change to the core was needed.

Findings:
- S-S1 RECURS (J-S1/T-S4): facilitator hardened a feel into a rule ("'chord barely changes' is the feel, not a law ... Don't make the record something I have to argue with later"). Principles carry the operator's strength: rule or feel.
- S-S2 NEW: "in your own time" was wrong; the decision has a sequencing deadline: "before I write a second verse." Decide moves carry the operator's "by when", which can be a step rather than a date.
- S-S3 NEW: one probe was shown as answering two items; it answers only tempo. "Waits on" must name only what that move actually settles.
- S-S4 RECURS (J-S3/T-S1): the three-part probe question felt like a clipboard ("a project-manager question"). Ask conversationally; the operator's own description already answered who, how and how long.
- S-S5 Date revival works, and suppression matters too: "don't let it come back up before, because I'll use it to procrastinate."
- S-S6 Asking for the experience target directly produced it in the operator's words; when no target was stated, one question was enough.
- S-S7 Audio medium: verbatim capture of a non-text idea means attaching the original, never a transcription.
- S-S8 Sensitive personal material (S4) was handled correctly as the operator's call alone; no change needed.
````

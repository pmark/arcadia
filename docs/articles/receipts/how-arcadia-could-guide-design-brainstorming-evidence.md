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

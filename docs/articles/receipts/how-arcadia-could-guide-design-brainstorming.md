# Field Notes evidence: how-arcadia-could-guide-design-brainstorming

- Type: essay; operator-requested explainer of a proposal, intended to become a guide on Arcadia Mission Control later.
- Article: docs/articles/2026-10-28-how-arcadia-could-guide-design-brainstorming.md
- Source repository and pinned revision: pmark/arcadia@5f06107a5 (base revision; repository paths below are pinned to it). Primary evidence is workspace receipts and a proposal draft that are not in the repository.
- Cadence window: not assessed; dated 2026-10-28.
- Evidence collection: workspace receipts relayed by Rowan, the proposal (revision 4) and two simulation logs, and repository documents at the pinned revision, read 2026-10-28.
- Previous verified publication/cutoff: none established for this article.
- Eligibility: explanatory draft of a proposal; no shipped-work or Milestone claim. No public PR pins these claims, so this draft is not Field Notes publication-eligible under Decision 0120.
- Decision: [0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)
- The canonical URL is an intended destination; no page, RSS entry or delivery is claimed.
- Workspace receipts: Agent Ask request `proposal-field-neutral-design-guidance-2026-10-28`, proposal id agentask_3bbb6cfe31923cf29a, settlement asksettle_4f5f06945f9f489e9a, lessons lesson_a256f875c950cf1756c8 (idea) and lesson_ab78ae3345fff6239708 (settle procedure; not cited by the article).
- The proposal (revision 4) and both simulation logs are checked in verbatim in the [evidence file](how-arcadia-could-guide-design-brainstorming-evidence.md) in this same change; this branch's PR pins them.

## Claims

| ID | Exact factual sentence, summary or number | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | Summary: a proposal, not a feature: a small field-neutral core that keeps every design idea, gives each open one a next move, and hands a ready design to governed Asks; reviewed and rehearsed on paper with simulated operators; nothing is built. | Agent Ask proposal-field-neutral-design-guidance-2026-10-28 (agentask_3bbb6cfe31923cf29a; settlement asksettle_4f5f06945f9f489e9a); proposal revision 4 ([evidence file](how-arcadia-could-guide-design-brainstorming-evidence.md)). | Proposal accepted as preserved evidence only; no Plan, Action, Decision or code. Workspace receipts are not public. |
| C2 | On 2026-10-28 the operator raised the idea that Arcadia should guide brainstorming using a design field's established practices (game, website, app, song), with an unlimited list of fields. | lesson_a256f875c950cf1756c8 (idea); proposal-field-neutral-design-guidance-2026-10-28 (agentask_3bbb6cfe31923cf29a; settlement asksettle_4f5f06945f9f489e9a). | Workspace receipts; the operator's words are as relayed by Rowan, not a public transcript. |
| C3 | No design facility exists in Arcadia today. | Agent Ask proposal-field-neutral-design-guidance-2026-10-28 (agentask_3bbb6cfe31923cf29a; settlement asksettle_4f5f06945f9f489e9a) (accepted as evidence only; no Plan, Action, Decision or code). | Absence claim; not verified by a full repository search. Stated by Rowan's assignment. |
| C4 | Back Burner keeps an idea on a shelf without making it work. | [docs/back-burner-guide.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/back-burner-guide.md) | Documented behavior. |
| C5 | An Agent Ask can record a proposal. | [docs/agent-guidance/agent-asks.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/agent-guidance/agent-asks.md) (`intent: proposal`) | Documented behavior; preserves evidence only. |
| C6 | Planning runs in two phases: Phase 1 is an interview that agrees an Outcome and Phase 2 turns that Outcome into a Plan. | [docs/planning-process.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/planning-process.md) (Phase 1, Phase 2) | Documented process, summarized. |
| C7 | The proposed core: design brief, experience target, principles, ideas, elements, positions, next moves, field guides, ready to commit, as described in the article. | Proposal revision 4, sections 'Field-neutral core' and 'Behavioral brief'. | Proposed design only; unimplemented. |
| C8 | Positions include open, candidates, leaning, chosen, evidenced and rejected; rejected stays on record and the operator may still act against it. | Proposal revision 4, 'Position'. | Proposed. |
| C9 | Next moves are ask, decide, probe, waits on, or park; park is a near list or the Back Burner with a revival condition. | Proposal revision 4, 'Next move'; [back-burner-guide.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/back-burner-guide.md) for the Back Burner condition. | Proposed; the Back Burner side exists. |
| C10 | Every field-guide entry would carry provenance: cited source, operator practice or agent inference. | Proposal revision 4, REQ-006; [`learn` provenance terms](https://github.com/pmark/arcadia/blob/5f06107a5/AGENTS.md) (`--provenance`, `--confidence`). | Proposed; reuse of existing `learn` terms. |
| C11 | Without a guide the core still works. | Proposal revision 4, REQ-005. | Proposed. |
| C12 | Ready to commit means core elements chosen, riskiest assumption probed or accepted, and every other open item has a next move; not ready is the normal end of a first session. | Proposal revision 4, 'Ready to commit'; sim-website-log.md ([evidence file](how-arcadia-could-guide-design-brainstorming-evidence.md)) finding S4. | Proposed; the 'normal end' point is a simulation finding. |
| C13 | A ready design would produce Ask previews only: an `artifact` Ask for the brief, Outcome, Milestone and Decision Asks, and the probe list for Phase 2; nothing self-approves and the brief grants no authority. | Proposal revision 4, REQ-007; [agent-asks.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/agent-guidance/agent-asks.md) (previews never approve themselves). | Proposed; the Ask rule is documented. |
| C14 | Work already settled changes only through the existing amendment path. | Proposal revision 4, REQ-004; [docs/operator-plan-amendments.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/operator-plan-amendments.md). | Proposed. |
| C15 | Before asking anyone to decide, the proposal was rehearsed on paper by Fable-model agents playing a web developer and a game developer, with the facilitator (Ellis, the planner) following the core by hand; these were simulated operators, not real use. | Simulation logs sim-website-log.md and sim-game-log.md ([evidence file](how-arcadia-could-guide-design-brainstorming-evidence.md)); proposal revision 4 header. | Simulated evidence only; says nothing about real operators. |
| C16 | Website simulation: waitlist for local trades, not a directory; maybe called Gap Day; the request form is one textarea. | sim-website-log.md, round 1 (I1, I2, I4). | Simulated persona's words. |
| C17 | Website simulation: the facilitator, following the core on paper, kept all six opening ideas. | sim-website-log.md, facilitator round 1 table (I1-I6). | Simulated. |
| C18 | Website simulation: the persona suggested tradespeople might get a text instead; this contradicted his site idea and the facilitator flagged his technology choice as affected. | sim-website-log.md, round 2 (I8) and facilitator round 2. | Simulated; REQ-004 behavior on paper. |
| C19 | Website simulation: he accepted a probe of asking an electrician he knows, judged by gut with no script. | sim-website-log.md, round 2 and round 3. | Simulated. |
| C20 | Website simulation: the design was not ready to commit because the riskiest assumption was unprobed. | sim-website-log.md, facilitator round 2. | Simulated. |
| C21 | Game simulation: lighthouse keeper tending a creature or fire; the twentieth-night payoff was first squeezed into a progression element, and finding G-S3 led to adding 'experience target' to the core. | sim-game-log.md, round 1 (G1, G4) and G-S3. | Simulated. [evidence file](how-arcadia-could-guide-design-brainstorming-evidence.md): sim-game-log round 1 (G1, G4) and G-S3; proposal revision 4 core. |
| C22 | Game simulation: the persona refused to separate the grudge and the tending, so they stayed one tangle. | sim-game-log.md, round 2 (G10) and G-S4. | Simulated. |
| C23 | Game simulation: he rejected a ship-visitor system but said he would probably build it anyway; the core then had no rejected state and the facilitator parked it as 'nearby', the persona corrected it to 'no', and finding G-S5 led revision 4 to add 'rejected, kept on record'. | sim-game-log.md, round 2 verdict and G-S5. | Simulated. [evidence file](how-arcadia-could-guide-design-brainstorming-evidence.md): sim-game-log round 1 (G7, park near), round 2 verdict, G-S5; proposal revision 4 'Position'. |
| C24 | Per the coordinator, Ellis (Engineer, working as planner) drafted the proposal; an independent plan-critic critiqued it; an adversarial review judged revision 2 'does not generalize as written'; changes after it produced revision 3. | Proposal revision 4 header (revision 3 applied an adversarial review); [docs/arcadia-semantics.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/arcadia-semantics.md) line 177 (Ellis, `planner` or `implementer`; Nadia, `plan-critic`). | RELAYED by Rowan: the Ellis drafting, the plan-critic critique and the quoted verdict. The review reports are not checked in and not independently verified. Role names are documented. |
| C25 | Both simulations 'passed with changes', leading to revision 4. | Proposal revision 4 header; sim logs 'passes with changes'. | Simulated. |
| C26 | Website simulation changes: 'waits on' became a valid next move; a near park list separate from the Back Burner; 'leaning' as a position; warnings said once and never itemized; the operator chooses how a probe is judged and options use his words. Game simulation changes: explicit experience target; tangles allowed; 'rejected' position; probe size belongs to the operator; principles given a place in the brief. | Evidence file sim-website-log findings S1-S9 and sim-game-log findings G-S3 to G-S8; see [evidence file](how-arcadia-could-guide-design-brainstorming-evidence.md). | Proposal text reflects these; unimplemented. |
| C27 | The proposal was submitted as the named Agent Ask and accepted on 2026-10-28 as preserved evidence only; no Plan, Action, Decision or code exists. | Agent Ask proposal-field-neutral-design-guidance-2026-10-28 (agentask_3bbb6cfe31923cf29a; settlement asksettle_4f5f06945f9f489e9a). | Workspace receipt ids as relayed by Rowan; not independently re-queried in this draft. |
| C28 | The first milestone is a paper walk-through with the operator's real website and game ideas, then a website field guide, then a game field guide. | Proposal revision 4, 'Milestones'. | Proposed order. |
| C29 | Five Decisions are open and none has been opened or answered: architecture, design-facilitation role, field-guide authorship, operator-performed probes, revival condition. | Proposal revision 4, 'Open Decisions (Phase 1)'; assignment from Rowan. | Status as relayed by Rowan; Decision documents were not looked up. |
| C30 | Architecture options are core only, core plus guides as data, built-in fields, or a plugin system. | Proposal revision 4, Decision 1 options A to D. | Proposed. |
| C31 | Open Phase 2 questions include: where a brief lives before a Project exists, the field-guide format and home, and the surface for viewing a brief. | Proposal revision 4, 'Phase 2 open questions'. | Proposed; other listed questions omitted from the article. |
| C32 | No public PR pins these claims, so the draft is not eligible for Field Notes under Decision 0120. | [Decision 0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md); [articles README](https://github.com/pmark/arcadia/blob/5f06107a5/docs/articles/README.md). | Eligibility conclusion by the author, not a formal assessment. |
| C33 | In the author's framing, brainstorming works best loose and governed work works best strict; what seems to be missing is a middle for keeping and relating half-formed ideas. | None; author's framing, not a sourced claim. | Opinion. Marked as the author's reading in the article. |
| C34 | Agent Asks are Arcadia's structured requests for a change; the vocabulary is explained in the 2026-10-23 explainer. | [docs/articles/2026-10-23-how-an-idea-becomes-governed-work.md](https://github.com/pmark/arcadia/blob/5f06107a5/docs/articles/2026-10-23-how-an-idea-becomes-governed-work.md) | Documented draft. |

Every factual sentence, including the summary, needs a row. No private logs,
credentials, account details or unredacted operational data belong here.

## Mechanical checks

Front matter present; about 1,300 words in the body (1,416 with front matter); no placeholders;
article contains no links (two file names in backticks); re-run after review round 1 edits; repository paths cited exist at the base revision
(checked with `ls` in the worktree). Results are recorded by the author, not by
a reviewer.

## Independent review

- Reviewer identity and independent lineage: Claudia Mason, Critic (claude, standard tier), a read-only reviewer session separate from the author's drafting session.
- Reviewed article and receipt revision: initial review of the uncommitted draft returned HOLD; delta check of 2b9077288 returned PASS.
- Source revision: pmark/arcadia@5f06107a5
- Report: summarized in this branch's pull request description; the full reports are not checked in.
- Verdict: PASS for editorial accuracy at 2b9077288. Field Notes publication remains HOLD (see Eligibility).
- Findings and resolution: one blocking overstatement (C23, rejected-state wording) and eight non-blocking findings were fixed in 2b9077288. Remaining non-blocking notes: C24 cites line 177 where the roles span lines 177-178; the C15 chronology is not shown in the evidence file itself. This section was updated after 2b9077288 and records that review; it was not itself reviewed.

## Delivery handoff

Pending. Draft only; not yet run or delivered. No site or RSS publication,
deployment, notification or unpublish receipt exists. Committing, pushing or
merging the draft does not publish it.

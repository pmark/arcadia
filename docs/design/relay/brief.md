# Relay design brief

**Locator:** `arcadia:docs/design/relay/`. **Method:** [arcadia-design](../../../.agents/skills/arcadia-design/SKILL.md). **Archive:** [record.yaml](record.yaml).

## Where it stands

**Stage 7 of 8: critics returned hold, and one choice is reopened.** The operator chose Way
knowledge first (S012). Critic R1 then found nine blocking problems
([report](reviews/R1-relay-critique.md)). So `arcadia way lookup` ships as read-only evidence
tooling, the decision interface is a [written contract](decision-interface.md) rather than code,
and CH-03 goes back to the operator. Sources were compiled from isolated extractions: 133 concepts
became 30 mechanisms and options, S008 added 7, and R1 led to 3 more.

- **Experience target (operator's words):** "Even a first time Arcadia operator therefore
  shall be empowered to wield the full power of the Arcadia Way via Relay interaction."
- **Name:** Relay, chosen by the operator on 2026-11-02.
- **Stated by the operator:** a single continuous thread with a UX like rich text
  messaging; the Way's most well-versed source; a first-time operator wielding its full
  power; Relay mode; eventually the default shell. It's for operators who design, build and
  deploy websites, apps and media for themselves and clients.
- **Described by the operator as DeepSeek's approach, wanted in 80/20 form:** observing
  group channels, taking active or passive action, and direct addressing. How far Relay goes
  on these is for the frame to settle.
- **Relay mode:** the [arcadia-relay skill](../../../.agents/skills/arcadia-relay/SKILL.md)
  simulates the experience in any coding agent until Relay v1.0 exists.
- **Being worked on:** first-timer guidance repair. **Next move:** the operator answers CH-03.
- **Riskiest assumption, probed once, failed:** 73% fully correct against S012's default 90%, and
  wrong on stopping ([result](probes/way-knowledge-1.md)).
- **Open blocking findings:** R1-F1, F2, F4, F5, F6, F7, F8 and F9. None is closed by this change.
- **Open sources:** the operator has more to paste. They can arrive at any time.

## Where the requirements come from

The frame is a proposal, so this separates the operator's statements from mine.

| Requirement | Source | Beyond the operator's words |
| --- | --- | --- |
| REQ-001 Way knowledge | S001 | Mine: "anything in the Way", citing guidance, and saying when it doesn't know |
| REQ-002 Operate by talking | S001 ("wield the full power") | Mine: the reading that this means no commands, paths or formats |
| REQ-003 One conversation | S001 (thread, rich messaging) | Mine: across devices and surviving restarts |
| REQ-004 Attention | S003 and the mission | Entirely mine; not stated by the operator |
| REQ-005 Group channels | S001 (as DeepSeek's approach) | Mine: nothing sent or acted on without authority |
| REQ-006 Enforced limit | S003 and the mission | Entirely mine; not stated by the operator |
| REQ-007 Relay mode | S001 | Mine: the proof, a label audit by a separate judge |
| REQ-008 Default shell | S001 | Mine: the proof, including no setup and all three hosts |
| REQ-009 Direct addressing | S001 (as DeepSeek's approach) | Mine: only once a Decision allows it |
| REQ-010 Speed | S008 | Mine: the proof by measured budgets |
| REQ-011 Minimal Way context | S008 | Mine: the proof by rerunning the probe |

The non-goals are also my proposals. S001 asks for "something similar" to Dot and its "own
implementation" of DeepSeek's benefits; "no OpenAI integration" is my reading of that.

## Principles

Recorded at the strength given:

- "the most well-versed and knowledgable source of understanding and wisdom regarding the
  Arcadia Way and its practical application": a rule, as requirement REQ-001.
- "Even a first time Arcadia operator ... shall be empowered": a rule, as REQ-001 and
  REQ-002.
- "highest bang per buck": a rule on scope.
- "blazing fast": a rule, as REQ-010.
- "minimal context in order to be an adherent to the way": a rule, as REQ-011.
- "I would lean towards an open local solution, but people will want to use Jev": a lean, not
  a decision, as CH-04.
- "clearly differentiating existing from filled-in, improvised behaviors": a rule, as
  REQ-007.
- "Eventually, Relays will replace Rowan as the default coding agent shell": direction,
  with no date, as REQ-008.

## Expert notes (Claudia Atlas's, not the operator's)

- **I was wrong that a deterministic lookup would be immediately useful to every agent,** at
  least for first-timer wording: it reached 16 of 30. It may suit agents' own vocabulary, which is
  unmeasured. I also specified an interface with no caller. S008's concepts were added directly by me rather than
  by an isolated extractor, because the source is short and the operator's own.
- **A decision engine helps only one step.** It can make routing fast, but answering still takes
  retrieval and possibly a model. Relay's speed depends on how often the fast paths apply, which
  is why latency per route matters more than any one engine's headline figure.
- **Laya's and Jev's published figures are unverified.** They come from write-ups and listings I
  haven't checked against primary sources. `tests/fixtures/ask-golden.jsonl` holds 20 routing
  cases, a start on an honest comparison, though too few to decide on.

- **The main finding of the compile: nothing but the operator asks for Way knowledge.** Of
  five other sources, none addresses a first-timer learning the Way through Relay (C-001,
  C-002). It's the largest gap and the reason I lean to C-028. The probe failed its pass mark, and
  C-041 now puts guidance repair first.
- **Agreement between S002 and S003 is weak evidence.** S003 was written after reading S002,
  so their shared concepts aren't independent. Agreement between S002 and S004, S006 or S007,
  written separately, counts for more, as on truthful state.
- **REQ-006 and REQ-008 pull against each other.** A read-and-propose limit fits a
  conversational agent, but a default coding session needs to write code. CH-03 is where this
  gets resolved, and my reading is that the shell's limits stay the existing gates while the
  conversation's own tools stay read-and-propose.

- **Knowledge of the Way is the hardest requirement, and the plan in S003 missed it
  entirely.** S003 treated answers as status lookups. REQ-001 needs retrieval across the
  whole Way with citations, and a way to measure accuracy.
- **"Most knowledgeable" can't be asserted, only measured,** so REQ-001's proof is a graded
  question set. The guidance itself may have gaps or stale passages, and Relay's questions
  will expose them. One was already found and recorded as a lesson.
- **"Wield the full power" can't mean bypassing a gate.** I read it as the operator holding
  that power through Relay, with Relay proposing and the operator approving (REQ-006). This
  reading is mine, for the operator to confirm.
- **The milestone is ambitious for a first version.** A narrower first milestone may be
  right, and that is the operator's call.
- **"One thread" and "Relays" pull against each other, and this is the design's main open
  question.** S001 asks for a single continuous thread and also for Relay in every coding
  session. My reading: one experience and one conversation record, with many sessions
  behind it. Other readings are possible, and it is the operator's call.
- **Replacing Rowan needs separating a shell from a duty.** `AGENTS.md` makes Rowan the
  default and gives Rowan release-manager custody, which a conversational shell shouldn't
  silently inherit. My reading: Relay replaces how a session talks to the operator, while
  coordination stays a duty of the `lead` Role. Changing the default touches the bootstrap,
  so it goes through a Decision when its time comes.
- **Relay mode is also the cheapest probe available.** Each improvised behavior it captures
  shows what operators actually need, before anything gets built.

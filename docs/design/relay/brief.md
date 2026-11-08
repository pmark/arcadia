# Relay design brief

**Locator:** `arcadia:docs/design/relay/`. **Method:** [arcadia-design](../../../.agents/skills/arcadia-design/SKILL.md). **Archive:** [record.yaml](record.yaml).

## Where it stands

**The frame is confirmed (S022), and the operator approved the three Workspace layers with 1A and 2A (S029).** The
[layer design](workspace-layers.md) sets what the scene, the view and the Relay overlay each do and who may move what, with a
[throwaway prototype](../prototypes/relay-workspace-layers.html) and [one probe](probes/layers-1.md). The operator's phone test revised its build order, and that revision
is proposed (S030, S031). S014 refocused Relay on the operator's own critical path, from idea to planned, autonomously produced
work, with arbitrary text starting a conversation at once and much of it at zero cost. Unattended production stays first,
and first-timer onboarding is deferred, though nothing built now should require special knowledge. Critic R1's hold still
stands against the earlier frame ([report](reviews/R1-relay-critique.md)). A thin [local model probe](probes/local-model-1.md)
suggests conversation is viable on the operator's MacBook Air, and [a second](probes/local-model-2.md) shows tuning moves
routing scores a lot, ahead of a proper bake-off. Way lookup is built as evidence tooling, and the decision interface is a
[written contract](decision-interface.md).

- **Experience target (operator's words):** "I should be able to just go from idea to planned
  project work that is autonomously produced." The earlier first-timer target (S001) is deferred.
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
- **Routing direction (S017):** the local model routes and uses tools, Ask comes first, engines are
  pluggable with none added now, and supervisors supply rich context ([probe 3](probes/routing-3.md),
  [ladder](decision-interface.md)).
- **Being worked on:** items 1 and 2 of the revised build order have merged. Items 3, 4 and 5 and a lighter Decision page are built and reviewed, and the operator said to merge them
  (S032, S033). The operator hasn't judged them on a phone yet. Production work goes first whenever they compete.
- **Riskiest assumption about the layers, probed once:** that one sky can carry status behind a view and an overlay. Text
  held and the sky stayed visible ([probe](probes/layers-1.md)). The operator's phone test found the weather too noisy (S030), which the
  revision addresses.
- **Riskiest assumption about Way knowledge, probed once, failed:** 73% fully correct against S012's default 90%, and
  wrong on stopping ([result](probes/way-knowledge-1.md)).
- **Open blocking findings:** R1-F1, F2, F4, F5, F6, F7, F8 and F9. My reading of S014: a dashboard
  conversation gives the interface its caller (F1) and fits the spending order (F2), no write tools
  ship (F6), and deferring first-timers narrows F4 and F9. F8 stays, because the operator's own
  Projects need the corpus too. A new critic round has to judge that.
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
| REQ-012 Arbitrary text starts a conversation | S014 | Mine: "changes no state by itself", and the proof |
| REQ-013 Mostly zero cost | S014 | Mine: "paid models only when they add value", and the proof |
| REQ-014 Idea to autonomous production | S014 | Mine: the proof |
| REQ-015 Status at a glance from every view | S023 | Mine: every Workspace view, words as well as weather, never falsely clear, and the proof |
| REQ-016 The view defines context | S023 | Mine: it moves only as CH-05 decides, each answer names its scope, and the proof |
| REQ-017 Relay always available | S023 | Mine: including a failed view, an uncertain send and an open Artifact, and the proof |
| REQ-018 Mobile-first, XR as the horizon | S022 | Mine: the proof |
| REQ-020 Approvals carry across sessions (proposed, not yet confirmed) | S035 | Mine: a recorded scope and end, a relayed sentence never counting, and the proof |

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

- **"Warm" should mean resumable, not running.** I rejected hot sessions (C-053) because they spend while
  idle and need a keep-alive service. That's my call, for the operator to overrule, and the resume path's
  speed and cost are unmeasured.
- **S017 asks that Relay manage production "through skills". I read that as:** a coding agent uses skills,
  and the local model uses a short typed tool list, because a small model can't follow long skills.

- **I was wrong that a deterministic lookup would be immediately useful to every agent,** at
  least for first-timer wording: it reached 16 of 30, and 9 of its 20 matches were wrong. It may suit agents' own vocabulary, which is
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

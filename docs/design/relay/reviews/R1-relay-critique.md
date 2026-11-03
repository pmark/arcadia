# Relay design: scrutiny round 1

- **record_hash reviewed:** `afcb4a73728f74b7bdd86ef5033c906e8a79b94c5b1c85e0901303061dc0d900` (reproduced with `arcadia design check` at commit `c0a13cc809ff16903fd2fbb80f7678a32ae3c37d`)
- **Critic:** read-only plan-critic, depth one. Claude Code, Claude Opus 5.5 (`claude-opus-5-5`). Wrote none of the design.
- **Lenses covered:** mission, evidence, failure.
- **Verdict:** `hold`. See the end for what can proceed now.

## Limits of this review

- **Not read:** pointer sources S002, S004, S006, S009, S010 and S011. S007 only in its opening. I did not verify any Laya or Jev claim.
- **Issues 2005 and 2013 not read:** `gh` failed with a certificate error in the sandbox. I used the probe's judgment file for the guidance defects instead.
- **Host tool restriction not tested:** I could not establish what Codex or OpenCode allow, so C-030's feasibility on those hosts stays unproved, not disproved.
- **My experiments are crude.** `R1-F4`'s retrieval test is a roughly 40-line BM25 with no stemming, no synonyms and a corpus I selected. It's a cheap attempt to falsify the idea, not a measurement of what the author will build.
- **Commands run:** `design check` (read-only), `arcadia --version` and `arcadia learn search stop --json` against the live workspace (reads only), and a pure replay of the Ask router in an extracted tree.

## Blocking findings

### R1-F1: the rules-first interface has no position in the chosen runtime

- **Severity:** blocking. **Lens:** mission, failure. **Concerns:** C-032, C-038, C-030, C-013, REQ-010.
- **Claim:** C-032 says every message passes one interface, rules first. C-038 says the operator sees an acknowledgment at once.
- **Problem:** CH-03 chose a standard coding-agent session, where the model reads each message first. `docs/agent-guidance/standard-harness.md` ("The rule") forbids wrapping or patching the harness. So nothing can sit in front of the model. The interface can only be a tool the model chooses to call, which means:
  - rules run after a model turn has already started, so they can't deliver the latency REQ-010 wants;
  - routing is enforced by the prompt, which contradicts C-032 serving REQ-006 ("enforced by tools rather than by its prompt");
  - C-013's "before any model sees it" and C-038's instant acknowledgment can't hold. C-038's only fit evidence is the dashboard's `workspace-ask.tsx`, which isn't the chosen runtime.
- **Consequence:** the slice ships a seam with one route, one engine and no caller. REQ-010's proof needs "a real message set", and no surface in this slice produces one. The operator would hear that speed has been addressed when turn latency is unchanged.
- **Also:** the same standard-harness section says direct chat is the one input channel it doesn't measure.
- **Needed:** name the caller and the point of interception before writing the interface. Either a front door exists (see R1-F13), or the interface stays a written contract with golden routes until one does. S008 asks for "figuring out the interface", which a contract satisfies.

### R1-F2: CH-03 conflicts with the Constitution's spending order, and silence settled it

- **Severity:** blocking. **Lens:** mission. **Concerns:** C-030, C-031, C-016, CH-03.
- **Conflict:**
  - `CONSTITUTION.md` "Economy" orders spending as deterministic, then local, then frontier. `AGENTS.md` adds "use a coding agent for code".
  - C-030 makes every Relay turn, including a Way question, a coding-agent session. CH-03's own text admits each turn costs a session.
  - C-016 (code first, then local model) is leaning, and on this runtime it can't happen in that order.
  - The probe's limits section says local models are untried, so nothing shows the frontier spend is needed.
- **How it was settled:** S012 asked only about build order. It says this default stands because the operator disagreed with none, and that it's "not the operator's own words". The record still says `decided_by: operator`. The S012 table shows one line for this default, with no consequence or Constitution conflict. I can't see the full message beyond what S012 records.
- **Wrongly parked:** C-031 fits the Economy order and the local-router rule better, and its revival ("turn cost proves too high") has no threshold or measurement behind it.
- **Needed:** a Decision on CH-03 that shows this conflict and R1-F11.

### R1-F3: the brief reports a failed probe as "inconclusive, leaning supported"

- **Severity:** blocking. **Lens:** evidence. **Concerns:** `riskiest_assumption`, brief "Where it stands", `probes/way-knowledge-1.md`, C-028.
- **Under S012's pass mark the probe fails both clauses:**
  - 22 of 30 is 73%, against 90%.
  - The clause is none wrong on authority, spending, merging **or stopping**. Q15 told the operator the material has no one-press stop, and the judgment confirms a STOP button exists. `START_HERE.md` has no occurrence of "STOP" (checked).
- **How it's presented:**
  - The brief's headline drops "stopping" ("no wrong statement about authority, spending or merging") and leads with "0 wrong".
  - The brief reports the 73% miss but not the stopping failure.
  - The probe file still says the operator hasn't set the pass mark.
  - The record's status is `inconclusive`.
  - A false statement about the emergency stop was graded `partial` because the rest of the answer was right.
- **The cause tally is also generous.** The judge's own defect list ties four of the five "retrieval" misses to guidance defects: Q2 (no walkthrough), Q22 (three conflicting commands), Q15 (`START_HERE.md` omits STOP), Q4 and Q23 (no route to deploy). So "1 missing guidance" understates the gap.
- **Consequence:** C-028 says failure means fixing guidance or retrieval first, yet the next move is a rerun through a new lookup. The operator is being told the bet is holding when its own test says otherwise.
- **Needed:** record the status as failed, state both clauses, and make guidance repair explicit in the sequence.

### R1-F4: a deterministic lookup won't handle first-timer wording, and can't say "I don't know"

- **Severity:** blocking. **Lens:** evidence, failure. **Concerns:** C-036, C-037, REQ-001, REQ-011.
- **The probe doesn't support C-036.** It tested a frontier model that could reformulate with `rg` and read iteratively, and 5 of 30 still missed by the judge's count. A one-shot lookup is strictly weaker than that. C-036 is `untested`, and the planned test comes after the build.
- **Test 1, existing trigger logic** (`renderGuidanceRetrieval` in `src/projects/agentGuidance.ts`, over the 30 questions):
  - 17 of 30 match nothing.
  - Q15 matches `continuation` and `native-mail-checkpoints`, which concern stopping a session, not stopping Arcadia.
  - Q4 matches `agent-asks` through the word "idea".
  - It does work where vocabulary matches operations: Q10, Q19 and Q21.
- **Test 2, BM25 over 459 heading-level passages in 41 files:**
  - The top three hold what the probe's answer cited for only 6 of 30 at heading level and 13 of 30 at file level. This is a rough proxy.
  - Four of the five retrieval misses stay missed (Q2, Q4, Q15, Q22). Q23 gets the Astro section at rank 3, under the section the judge called misleading.
  - Q10, the merge question, returned no merge guidance.
- **No threshold for "don't know":** the off-topic query "xylophone repair schedule" scored 6.3, level with correct hits (Q28 at 6.0, Q7 at 7.1). Zero scores only appear for wholly foreign vocabulary. The record names no abstention rule, though REQ-001 requires one and the probe already failed this twice (honest about limits, 6 of 8).
- **A positive result:** the top three averaged about 4.7 KB, roughly 1,200 tokens, so a small context is reachable if the passages are right. Some passages are far too large, the largest about 51 KB.
- **Consequence:** the lookup returns a tidy, cited, wrong passage. Falling back to a model search removes the token saving. Hand-written trigger lines would raise the score, but they'd be tuned to the only question set (R1-F9).
- **Needed:** split the problem. An operation-keyed lookup suits agents, whose vocabulary matches the triggers. First-timer language needs a curated question map or model reformulation. Define abstention before building.

### R1-F5: the 5,000-token baseline is unsound, and the lookup doesn't touch the standing load S008 complains about

- **Severity:** blocking. **Lens:** evidence, mission. **Concerns:** REQ-011, C-036.
- **The baseline:** one agent answered all 30 questions in one run, sharing reads across them, and the figure is what the runtime reported. Whether 157,000 is cumulative or final context isn't stated. No answer ran in isolation, so this isn't a per-question figure, and answers may have benefited from earlier reads. Yet the brief's next move has the operator set targets from it.
- **The standing load is larger than the baseline.** At this commit `AGENTS.md`, `CLAUDE.md`, `CONSTITUTION.md`, the `.arcadia` context files, the guidance index and the Relay skill total about 32 KB, roughly 8,000 tokens. That's before the harness prompt, the Project frontmatter's neighbours or any matched procedure. REQ-011's proof doesn't count it.
- **The contract blocks the saving.** `AGENTS.md` requires reading the listed procedure before acting. An agent that reads only a passage breaks that rule, and one that also reads the procedure saves nothing. Nothing in the record changes the rule. Changing it means `docs/agents-context.md`, regeneration, propagation, and probably a PR that waits for the operator.
- **The proof measures the wrong population.** S008 is about any agent consulting the Way. REQ-011's proof reruns first-timer questions such as "What is Arcadia?", not agent operations such as what to do before a commit.
- **Needed:** a per-question baseline from fresh sessions, including standing load; an agent-operation question set; and a named route for the bootstrap change.

### R1-F6: `arcadia ask` isn't capture, so the "read and propose" tool set can change state

- **Severity:** blocking for any session exposed to untrusted text. **Lens:** failure, evidence. **Concerns:** C-014, C-030, REQ-006.
- **The code:**
  - `src/commands/ask.ts` lines 856-866 call `createProjectWithDefaults` at high intake confidence.
  - Lines 921-950 apply a Project attribute update at high confidence.
  - My replay confirms "Create a project called Seed Library" resolves as high confidence, Execute Directly, and it's also a golden case.
  - The command also has `--run-safe`.
- **Consequence:** a hostile document or message that gets the model to run the phrase changes Project state through the allowed tool. REQ-006's adversarial proof would fail on the first obvious case.
- **Restriction itself is unproved.**
  - The record admits no session is restricted yet.
  - The repository's proven pattern is a read-only sandbox in `src/qa/prReview.ts`, which likely can't coexist with these tools, because capture, preview and learn write to the workspace database.
  - So this needs per-command allowlisting that binds subcommands and flags, on all three hosts. Allowing `arcadia` generally would expose everything.
  - CH-03 is `chosen` while C-014, which it depends on, is `leaning` and `untested`.
- **Needed:** a capture-only path, using `--back-burner`, `--direction-target` or a new flag, plus a per-host proof before calling any session restricted. The first slice can avoid this by having no write tools at all.

### R1-F7: the lookup will serve stale or truncated guidance with a clean citation

- **Severity:** blocking. **Lens:** failure. **Concerns:** C-036, C-037, REQ-001's "none wrong" clause.
- **Stale, observed:** Q14's top hit in my test was `docs/managed-production-readiness.md` "Operator view: the rover's route from here" at byte offset 22003. That's inside a `<details>` block for an October 25 derivation. The same heading appears four times in that file, and three of the `<details>` summaries are labelled superseded. A heading-addressed passage strips the only marker saying so. The probe's "0 stale" came from a reader that saw the context.
- **Truncated:** authority text is rule plus exception. `CONSTITUTION.md` calls merging a hard stop with one standing exception, and that exception has its own exclusions. A smallest-passage result can return half of that with a valid citation.
- **Second truth:** C-037 asks for a "short body that stands alone" and a new trigger line per rule. Unless the body is the canonical text, that's a rewrite, which conflicts with the Constitution's one-authoritative-home rule. The word "generated" doesn't solve it, since trigger lines are authored. The judge also found three documents disagreeing on how to add a Project, and a lookup picks one silently.
- **No freshness rule:** the record doesn't say what happens when the index and guidance disagree. `fingerprints.json` is whole-file and hand-refreshed. A checked-in compiled index would also conflict across concurrent PRs.
- **Needed:** before building, specify superseded-state handling, a fail-closed staleness check, a rule that authority passages carry their exceptions or point to the full section, and canonical text rather than a rewrite.

### R1-F8: the lookup's corpus is undefined outside Arcadia's own repository

- **Severity:** blocking. **Lens:** evidence, mission. **Concerns:** C-036, REQ-001, REQ-011, the milestone.
- **Evidence:**
  - 26 of the 30 answers cite `START_HERE.md`.
  - `guidanceResources` in `src/projects/agentGuidance.ts` propagates only the index, fingerprints and indexed procedures, and `START_HERE.md` isn't among them. `wayPropagation.ts` doesn't mention it.
  - The Relay skill says to report the gap in a Project without those files.
  - `START_HERE.md` says Relay mode works "in a checkout containing the skill".
- **Consequence:** the milestone's first-timer works in their own or a client's repository, where the corpus the probe measured doesn't exist. A pass in this repository proves nothing there. The "revision" on a citation is also ambiguous between the Project's copy and the installed CLI's.
- **Needed:** decide where the corpus lives and how it's versioned before fixing an index format, and run a probe from an adopting Project.

### R1-F9: rerunning the same 30 questions can't prove the pass mark

- **Severity:** blocking. **Lens:** evidence. **Concerns:** C-002, REQ-001, REQ-011's proof.
- **Contaminated:** the questions and their defects are published, and the same author is building the fix, so any trigger or guidance change is tuned against the test.
- **Not first-timer wording throughout:** at least seven questions use Arcadia's own nouns (Q3, Q7, Q8, Q16, Q18, Q20, Q22). Someone who knows nothing wouldn't ask about the difference between an Ask and an Agent Ask. No real first-timer was involved.
- **Thin at the mark:**
  - Fixing all five retrieval misses gives exactly 27 of 30, with no margin. Q24, Q26 and Q29 aren't retrieval problems, and any regression fails it.
  - 27 of 30 has a 95% interval of about 74% to 97%.
  - "None wrong" on safety rests on about five questions.
  - There's no answer key, so the judge can drift between runs.
- **Consequence:** a reported pass would carry more confidence than it earned. REQ-001's own wording already separates this set from the final graded one, but the brief's next move doesn't.
- **Needed:** a held-out set written by someone else, ideally real first-timers, with an answer key, one fresh session per question, and a larger safety block.

## Notes

### R1-F10: other silent settlements are recorded as operator decisions

- **Severity:** note. **Lens:** mission. **Concerns:** CH-01, CH-04, S005.
- S012 is honest about this, but `decided_by: operator` isn't. S005's readings, which carry Rowan's custody, were also "accepted without correction". `CONSTITUTION.md` "Truth" says silence doesn't close open questions, although here the operator did accept the answer-only-if-you-disagree format. A record that distinguishes `operator_default` would avoid misleading later readers.

### R1-F11: REQ-008 doesn't fit REQ-006 as written, and CH-03's consequence overstates the link

- **Severity:** note now. It must be resolved before C-024 leaves `leaning`, and it belongs in R1-F2's Decision. **Lens:** mission. **Concerns:** REQ-006, REQ-008, C-015, C-024, C-030.
- A default session needs write, Git and PR tools, and C-015 says Relay never does technical work. A restricted shell can't be the default working session, and an unrestricted one can't meet REQ-006's tool-enforced limit "whatever a message tells it". The brief's reading, that a shell keeps existing gates while the conversation stays read-and-propose, means two tool regimes. So "the same contract becomes the default shell" in CH-03 isn't accurate.
- **Custody:** `AGENTS.md` makes a session Rowan in `lead` by default, and that session holds coordination and sole-writer duties. The readiness document names Rowan as the sole contact. If the default shell becomes Relay, nothing says who that fresh session is when it's asked to coordinate. "Custody stays with `lead`" names a Role but not a Session.

### R1-F12: the critical path gets no explicit trade-off, and guidance churn can touch it

- **Severity:** note. **Lens:** mission, failure. **Concerns:** C-037, CH-02.
- `PROJECT.md` still has the unattended-production milestone active, and `docs/managed-production-readiness.md` route step 4 is open. CH-02 mentions shared capacity in its question, but S012's question didn't, so the trade-off wasn't put to the operator in those terms. The operator-directed route permits this work, and it crosses no approval boundary as a read-only lookup. That route also says to stop and plan when work needs several Actions or has open questions, which fits this slice.
- **Coupling:** `guidanceResources` throws on a stale fingerprint, and retrieval refuses on delivery problems. A broad C-037 restructure of indexed procedures touches files every session reads, including a future START run. Keep such changes out of any START window.

### R1-F13: C-027 and the messaging wish were offered as all-or-nothing

- **Severity:** note, though it may be the best answer to R1-F1. **Lens:** failure. **Concerns:** C-027, C-004, CH-02, S001.
- The operator chose this order, so parking C-027 isn't wrong in itself. But messaging leads S001, and:
  - C-004 is `chosen` with nothing behind it, because C-005 is `leaning` and fit `missing`.
  - C-027's revival requires the interface to be "in use", which R1-F1 suggests can't happen, and a pass on a contaminated test. So it can stay parked indefinitely with no visible date or signal.
- **Missing option:** answer Way questions at the existing Ask surfaces (dashboard composer, possibly Discord) through the lookup, without a synced thread. This costs far less than C-027, gives the interface a real caller and message set, needs no coding agent per question, and fits the Economy order. Discord replies need checking against Decision 0084 and the remote-request rules in `operator-directed-work.md`.
- **Today's router isn't usable for this.** Replaying the 30 questions through `replayAsk` gives zero recognised as questions: 26 are `unclear / Clarify First` and 4 are `work / Plan First`. All are low confidence. Clarify First creates a review item, so a first-timer's question would land on the operator's list.

### R1-F14: C-032's and C-033's fit evidence cites the wrong file

- **Severity:** note. **Lens:** evidence. **Concerns:** C-032, C-033.
- `src/ask/rules.ts` is an exact-prefix-to-Project registry with one processing profile (`living-songbook-v1`), not intent routing. The real rules-first router is `resolveIntake` in `src/intake/index.ts`, with `src/stewardship/index.ts`. That already has an `IntakeClassifier` interface with a deterministic implementation, confidence labels, and a golden replay (`src/ask/goldenReplay.ts`). So C-032's fit of `missing` and "no engine seam" are overstated. It lacks a time budget and a Way route, but any interface should extend this rather than start a second router.

### R1-F15: C-034 and C-035 are reasonably parked, but the record narrows S012 and their revival may never fire

- **Severity:** note. **Lens:** failure, evidence. **Concerns:** C-033, C-034, C-035.
- S012 reads as rules first, then benchmark an open local model, with Jev staying selectable under a Decision. The record makes the benchmark conditional on measurements showing rules fall short, and parks Jev. That narrows what was accepted.
- The revival needs routing measurements that don't exist. The golden set has 20 cases and no Way-question type (`GOLDEN_TYPES`). On C-030 an engine has no position either, since the session's own model already reads every message. On the replay above, rules decide none of these questions with confidence.
- A benchmark of a local model through the existing LiteLLM route is cheap and needs no spending Decision, so nothing argues for waiting indefinitely. Hosted Jev still needs its Decision, and parking it is right.

### R1-F16: the first hop may already cost more than a second

- **Severity:** note. **Lens:** evidence. **Concerns:** REQ-010, C-036, C-038.
- On this host, single runs through the installed wrapper took 1.3 s for `arcadia --version` and 1.2 s for `arcadia learn search`, and it runs source through `tsx`. There was no `dist/cli.js` in the main checkout. This isn't a benchmark, and a compiled path would be faster. Still, the lookup's latency target can't be set without choosing how it's launched.

### R1-F17: Relay mode's labels count an agent's own file read as "Arcadia did"

- **Severity:** note. **Lens:** evidence. **Concerns:** C-023, REQ-007.
- The skill's table puts any read of a checked-in document under **Arcadia did**, whichever tool read it. The same section says the operator must be able to tell what would still work without the agent, and a file read wouldn't. S001 asks for a clear split between existing and improvised behavior. C-023's `exists` holds for the skill, but REQ-007's label audit hasn't run. A real lookup receipt would fix this.

### R1-F18: later-phase ordering

- **Severity:** note. **Lens:** failure. **Concerns:** REQ-005, C-019, C-022.
- REQ-005's proof is a record-only run on a real channel, which needs C-022's retention Decision first, so the proof can't be scheduled until then. C-014 should also say whether lessons can feed the lookup: C-036 cites `docs/notes-to-self.md`, and a captured hostile text returned later as cited guidance would be persistent injection.

## Answers to the brief's specific questions

- **Does REQ-008 fit REQ-006 and Rowan's custody?** Not as written (R1-F11).
- **Does building now conflict with the critical path?** Not an authority conflict. It's an unstated capacity trade-off (R1-F12).
- **Existing capability that makes a piece unnecessary?**
  - `src/ask/rules.ts` doesn't help, but `src/intake` covers much of the interface (R1-F14).
  - `arcadia learn search` is substring search over lessons, not guidance, so it doesn't replace the lookup.
  - The guidance index only points to whole procedures, so C-036's `partial` is fair.
  - Repairing guidance could address most of the "retrieval" misses without a lookup (R1-F3).
- **Wrongly rejected or parked?** C-031 (R1-F2). The all-or-nothing framing of C-027 (R1-F13). C-034's revival condition (R1-F15). C-035's parking is right.

## Pre-mortem: why Relay failed by May 2027

1. The interface shipped with no caller and became an unused abstraction. Latency stayed at model-turn speed.
2. The score reached 90% on the tuned 30 questions, and the first real first-timer, in a client repository, got an empty or wrong corpus.
3. A confident cited passage, stale or missing its exception, misled someone on stopping or merging. Trust in "cites what it used" never recovered, because citations looked identical either way.
4. Generated index and trigger lines drifted from the guidance and caused conflicts on PRs, so agents returned to `rg`.
5. Relay turns cost frontier-model sessions, so nobody used it for small questions.
6. The messaging experience the operator first asked for never came, because its revival depended on the above.

## Checked and found sound

- Record hash and all five retained source hashes match.
- Mission quotes M1 to M5 are exact.
- Probe totals match the judgment file.
- The Discord allowlist does fail open when empty (`apps/discord-bot/src/config.ts`, `messageCreate.ts`).
- Decision 0084 covers only operator pings, as C-021 says.
- The brief's disclosure of which requirement text is the author's own is candid and useful.
- The first slice as a read-only lookup crosses no approval boundary.

## Verdict: hold

Passing this round doesn't require abandoning the operator's order. It requires correcting what the operator has been told (R1-F3), a Decision on CH-03 with the conflicts visible (R1-F2, R1-F11), and a specification for the caller, corpus, abstention and staleness rules before the interface or index format is fixed.

**Can proceed meanwhile, without new risk:**
- the guidance repairs from the judge's defect list;
- a throwaway read-only lookup prototype used only to generate evidence, on a held-out question set with fresh sessions.

**Should wait:** interface code, the C-037 restructure of indexed guidance, and any session described as restricted.

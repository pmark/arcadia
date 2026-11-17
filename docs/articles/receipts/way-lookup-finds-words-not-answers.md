# Field Notes evidence: way-lookup-finds-words-not-answers (draft, rewrite R1)

- Type: draft claims receipt for the rewritten essay. Not yet on main. No approval, publication or merge is claimed.
- Article: `docs/articles/2026-11-03-way-lookup-finds-words-not-answers.md` (rewrite draft R1-way-lookup.md).
- Source repository and revision checked: `pmark/arcadia` `origin/main` at `4c2cb0ee3` (fetched 2026-11-17). Original draft arrived on main through PR 2028 (merged 2026-11-10).
- Labels: 🔎 Checked means read at file:line or looked up with `gh` on 2026-11-17. 📐 Proposed and ❓ Not proved are marked where used.
- Paths below are on `origin/main`. "probe" is `docs/design/relay/probes/way-knowledge-1.md`; "judgment", "answers" and "questions" are the `way-knowledge-1-*.md` files in the same folder.

## Claims and evidence

| ID | Exact factual sentence in the article | Evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | We wrote a keyword search over our agent rule files, the guidance our coding agents follow. | `docs/COMMANDS.md:2065-2079` (corpus is a fixed list of checked-in guidance files, Constitution, operator guides and skills). | The command searches a fixed list of checked-in guidance. "Our coding agents follow" is a reading of the corpus, not separately tested. |
| C2 | ...then tested it on 30 questions a newcomer might ask. | probe:12-13; questions:3-6, 8-37 (30 numbered questions, written from a first-time operator's point of view). | 30 questions exist. They are author-written (C3). |
| C3 | One author wrote the questions. | questions:3 ("Written by Claudia Atlas..."); probe:75 ("One author wrote the questions and one judge graded them"). | Single author. Whether another person reviewed the questions is not recorded in these files. |
| C4 | The search put the right passage in its top three results for 16 of the 30. | probe:59; `tests/fixtures/way-lookup-golden.jsonl` (30 rows, each with an `accept` list of passage-address prefixes); `tests/way-lookup.test.ts:447-478` (the measuring test). Reproduced by re-run, see C15. | "Right passage" is defined by the fixture's accept lists, not by a judge reading results. The files do not say who wrote the accept lists or when. Counts the nearest-address list as well as matched results (`tests/way-lookup.test.ts:461`). |
| C5 | An agent using ordinary file search over the same files, with no lookup command, gave answers that a judge marked fully correct for 22 of the 30. | probe:14-16, 24; answers:3 ("targeted rg and bounded reads ... No arcadia command was run"); judgment:38. | 22 yes, 8 partial, 0 no for "correct". One run, one agent (Claude Sonnet 5.5, probe:14-15), one judge. |
| C6 | These two numbers are not like for like. One counts whether the right passage appeared in three results. The other counts whether a written answer was correct. | C4 and C5 above. | A reading by Clara of the two definitions: retrieval hit versus graded answer. Not a claim from the probe. |
| C7 | Both come from a development set: ... one judge graded all 30 answers (22 were fully correct), and the search's author had already seen the questions. | probe:54-55 ("development data, already seen by its author"); probe:75; judgment:3. | Limits stated by the probe. |
| C8 | 🔎 Checked: the numbers are real. | C4, C5, C15. | The numbers match the cited files; the lookup number also re-ran. This does not say they generalize (see next sentence in the article). |
| C9 | Table: agent "22 fully correct, 8 partial, 0 wrong"; lookup "16 of 30". | probe:24, 59; judgment:38. | As C4 and C5. |
| C10 | The agent was told to start from the guidance index and one skill file, and could use file search and bounded reads. | probe:14-16; answers:3. | As stated by the probe. |
| C11 | The lookup ranks passages by keyword (BM25 over lightly stemmed words). It uses no model and no network, and by default returns at most three passages and 1,500 bytes. | `docs/COMMANDS.md:2065-2069` (deterministic, BM25 over lightly stemmed words, no model, no network); `docs/COMMANDS.md:2094-2095` (default `--limit` 3, `--budget` 1500); `src/way/lookup.ts:44-45`. | Describes the command on current main. The probe measured an earlier build of it (see C15). |
| C12 | The lookup was built after the agent run and measured on the same questions. | probe:54 ("was then built and measured on these same questions"). | Sequence as recorded in the probe. |
| C13 | Lookup table: 30 questions; 20 where the search said it had a match; 9 of 20 matches did not contain the right material (captioned as original build; 8 of 20 on main); 17 of 17 off-topic queries refused. | probe:59-62. Off-topic list of 17 queries and the test that none matches: `tests/way-lookup.test.ts:360-383`. | Development data. The 17 off-topic queries are a list in the test file; who wrote them is not recorded. |
| C14 | A match means only that the question's words were found, not that the passage answers the question. The command's documentation says so, and its output opens with that warning. | `docs/COMMANDS.md:2102-2110` ("`matched` is about wording, not correctness"; human output begins "These are the closest passages by wording and may not answer the question..."). | Documentation text. This receipt did not run the command to see its printed output. |
| C15 | The probe's example is the question "How do I stop everything immediately?". The lookup matched, and returned the agent's own stopping rule, not the operator's stop control. | probe:67-69 ("Asked how to stop everything, it matches and returns the agent's own stopping rule"); questions:22 (Q15 wording). | Stated by the probe. "Not the operator's stop control" is the probe's framing: judgment:19 says a STOP button exists on the Actions page. |
| C16 | That ranking has since been changed. A pull request merged on 2026-11-13 (#2549) makes stop-production wording return the production Off guidance first, and tests pin nine wordings. | `gh pr view 2549` on 2026-11-17: title "fix(way): rank the production Off guidance first for stop-production wording (#2348)", MERGED, `mergedAt` 2026-11-13T16:10:57Z, base `main`; commits `e9dc86cc8`, `1a16ddc9d`, `a4fe930bc` map to this PR (`gh api .../commits/<sha>/pulls`). Tests: `tests/way-lookup.test.ts:482-496` (nine stop-production wordings must return `START_HERE.md#managed-production-the-standing-authorization` first). | The change merged and the tests assert it. The PR's own title cites Issue 2348, which is still open (`gh api repos/pmark/arcadia/issues/2348`, state open on 2026-11-17). This receipt did not run the test suite. |
| C17 | We re-ran the 30-question fixture on the main branch (revision 4c2cb0ee3). It again gives 16 of 30, with 20 matched and 8 of those matches missing the accepted material, down from 9. | Clara's re-run on 2026-11-17, using the same logic as `tests/way-lookup.test.ts:447-478` (script below). Output at `4c2cb0ee3`: accepted 16, matched 20, matched-but-missed 8 (Q5, Q6, Q13, Q14, Q15, Q22, Q25, Q29). Same script at `924f1cd5e` (commit that added the lookup): accepted 16, matched 20, matched-but-missed 9 (Q5, Q6, Q10, Q13, Q14, Q15, Q22, Q25, Q28). | Reproduces the probe's 16 / 20 / 9 on the original build, so the script matches the probe's method. The re-run is not a receipt on main; the reviewer should re-run the script. The 8-versus-9 change comes from different questions moving, not from a new question set. |
| C18 | Different questions moved and the total stayed at 16. (Detail kept here, not in the article: Q10 now hits and Q29 now misses; Q28 no longer matches and Q26 now does.) | Same two outputs. Accepted-set change between `924f1cd5e` and `4c2cb0ee3`: Q10 now accepted; Q29 now missed. Matched sets (Clara re-run, both revisions): Q28 matched at `924f1cd5e` and not at `4c2cb0ee3`; Q26 the reverse. Fact-checker confirmed the numbers. | Net accepted count unchanged at 16. |
| C19 | So the ranking fix did not raise the headline number. | C17. | Follows from 16 and 16. Says nothing about whether stop-related wording other than the fixture's improved. |
| C20 | The fixture still counts the stop question as a miss, because its accepted passages are not the one now returned first. | `tests/fixtures/way-lookup-golden.jsonl:15` (Q15 accepts `docs/agent-guidance/operator-actions.md#per-run-start-cards` and `docs/managed-production-readiness.md`). Re-run output for Q15 at `4c2cb0ee3`: matched, first result `START_HERE.md#managed-production-the-standing-authorization`, then `START_HERE.md#automatic-local-services`, then `docs/agent-guidance/production-24x7.md#9-no-silent-stall`. | None of the top three is in the accept list. |
| C21 | We did not judge whether that passage answers the question. | No file records a judgement of the current first result against Q15. | An absence claim; see "Not checked". |
| C22 | The judge gave a cause for each of the 10 file-search answers that fell short on correctness or citation: 5 retrieval failures, 4 problems in the answer itself, and 1 missing-guidance case. | probe:30; judgment:43 (retrieval 5: Q2, Q4, Q15, Q22, Q23; answer 4: Q11, Q21, Q26, Q29; guidance_gap 1: Q24). Ten questions carry a "Cause" in judgment:6-33. | The ten count is Clara's tally of the questions with a cause. "Retrieval" here is about the file-search agent, not the lookup command. |
| C23 | The probe's author says the judge's defect list ties four of the five retrieval failures to defects in the guidance. That is the probe's reading; we did not re-derive it. | probe:49-50. | The probe's statement, not re-derived. The probe says this means "1 missing guidance" understates the gap. |
| C24 | A retrieval miss (Q15): asked how to stop everything, the agent said the material had no one-press stop. The judge marked the answer partial: a STOP button on the actions page exists, and the main operator guide did not mention it at the time. | answers:61-64 (agent's answer); judgment:19 (partial, cause retrieval, STOP button named in `scripts/start-run.sh`, `docs/agent-guidance/operator-actions.md`, `docs/managed-production-readiness.md`); judgment:50 (defect 3: `START_HERE.md` names the Off control but never mentions the Actions-page STOP button). | State of the guide when judged. On current main `START_HERE.md:1679-1683` now says Off is the stop and names the STOP button; that paragraph first appears in commit `924f1cd5e` (`git log -S`). The article says "at the time" for this reason. |
| C25 | A guidance gap (Q24): asked whether the system can generate images, the agent answered honestly that nothing explains how an operator asks for one. The judge found the same: the guidance has the engineering description and no plain-words path. | answers:97-99; judgment:28 ("Cause guidance_gap ... The answer was honest about this."). | As stated by the judge. |
| C26 | Eight guidance defects from the probe were filed as Issue 2013, which is still open. | judgment:46-54 (eight numbered defects); probe:45-47; `gh issue view 2013` on 2026-11-17: title "Fix guidance gaps a first-time operator hits, found by the Relay probe", state OPEN, created 2026-11-02. | Open as of 2026-11-17. Some listed defects may have been fixed since (for example item 3, see C24); the issue is still open. |
| C27 | Our reading, not a measurement: a better search cannot find a passage that does not exist. | Reasoning; no file. | Stated as opinion in the article. |
| C28 | 📐 Proposed method (four steps). | None. A proposal derived from this probe's design. | Not tested by anyone outside this probe. |
| C29 | No held-out question set for this lookup is recorded. Someone other than the tool's author has to write it. | Nadia's fix brief (R1 section, item b, BLOCKED); questions:5-6 (these are "not the graded set REQ-001 will finally use"). | Absence claim; a full-repository search for such a set was not made. See "Not checked". |
| C30 | Limits recorded in the probe: no real first-time operator took part; a frontier model with full file search is probably an upper bound, and a local model was not tried; the judge had no fixed answer key, so another judge may grade differently. | probe:75-79. | Paraphrase of the probe's Limits section. |
| C31 | The agent ran without the lookup, so the lookup's effect on answer quality is unmeasured. | answers:3 ("No arcadia command was run"). | The agent ran without the lookup in this probe. No other run is known to me; see "Not checked". |
| C32 | Title: "Keyword search over agent rule files: the right passage in the top three for 16 of 30 questions". Summary: "We tested a keyword search over the rule files our coding agents follow on 30 newcomer questions. It reached the right passage in its top three for 16; one author, one judge, no held-out set." | C4, C5, C6. | Revised after fact-check and critic edit (22-of-30 comparison now only in paragraph one; baseline is an LLM agent using rg plus bounded reads (answers:3), not plain grep): the baseline is an LLM agent using rg plus bounded reads (answers:3), not plain grep, and 16 and 22 are unlike measures, as the article says in its second paragraph. |
| C33 | Front matter: original date 2026-11-03 and slug kept. | `docs/articles/2026-11-03-way-lookup-finds-words-not-answers.md` on `origin/main` (front matter). | Metadata. |

## Reproduction script for C17 to C20

Export the revision to check (`git archive <rev> | tar -x -C <dir>`), then run with Node 22 or later (`node measure.mts <dir>`). It imports only `src/way/lookup.ts`, which has no imports beyond Node built-ins (`src/way/lookup.ts:1-4`).

```ts
import { readFileSync } from "node:fs";
import { lookup } from "<dir>/src/way/lookup.ts";
const root = "<dir>/";
const rows = readFileSync(root + "tests/fixtures/way-lookup-golden.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
let acc = 0, matched = 0; const mm: string[] = [], missed: string[] = [];
for (const row of rows) {
  const r: any = lookup(root, row.question, { limit: 3, budget: 1_000_000 });
  const addrs = (r.matched ? r.results : r.nearest).map((h: any) => h.address);
  const hit = addrs.some((a: string) => row.accept.some((p: string) => a.startsWith(p)));
  if (r.matched) matched++;
  if (hit) acc++; else { missed.push(row.id); if (r.matched) mm.push(row.id); }
}
console.log(rows.length, "accepted", acc, "matched", matched, "matchedButMissed", mm.length, mm.join(","));
```

## Not checked

- The full test suite was not run; only the fixture logic above was re-run.
- Whether any later run applied the lookup to the 30 questions or gave an agent the lookup. C31 rests on the probe's own method statement.
- Whether any held-out or other-author question set exists elsewhere in the repository (C29 rests on the brief and the probe).
- Who wrote the fixture's accept lists and the 17 off-topic queries, and whether the accept lists were set after the lookup's author saw results.
- Whether the current first result for the stop question answers it (C21).
- The printed human output of the command was not run on the live checkout (C14 rests on the documentation).
- The original draft's claims about commit `74dc1f07c`, timings (about 150 to 320 ms), output size (about 1.7 KB) and the independent reviewer's reproduction were cut from the article and are not asserted.
- The original article's other claims (for example the Relay skill instruction and package scoping) were cut and are not asserted.

## Independent review

- Reviewer: a separate read-only Claude Code subagent (Sonnet 5.5, role fact-checker), not the author and not Flynn. It checked every sentence against `origin/main` (the revision pinned above) and did not take the author's draft receipt on trust.
- Rounds: Round 1: FAIL on five sentences (the headline comparison, the attribution of a defect-list claim, the scope of the judge, the questions that moved, and an unlabelled absence claim). The reviewer re-ran the 30-question fixture on a clean copy of origin/main and confirmed 16 accepted, 20 matched and 8 matched-but-missed on main, and 16, 20 and 9 at the original commit; all numbers reproduced. The author corrected all five. Round 2: PASS. The critic's later mechanical edit (new title and summary, a shortened moved-questions sentence) added no claims and was not re-run through the fact-check.
- Findings: none outstanding at the last reviewed revision; the receipt's Not checked list states what was not verified.
- Verdict: PASS

## Editorial review

- Critic: Nadia (Arcadia's critic role, a separate read-only subagent) applied the Field Notes interest gate: a stranger can state the claim without Arcadia terms, a real result with its limits, a reusable method, a distinct angle, a searchable title, and a headline that survives its own caveats.
- Editorial verdict: APPROVE; placement: home page.
- Release approval: the operator's chat instructions of 2026-11-17: "I want Field Notes to only publish articles that Nadia approves. Have Clara rewrite all articles that Nadia thinks need work. ... Then one more review and publish." Merging this change is the release; set `status: withdrawn` in a reviewed change to unpublish.

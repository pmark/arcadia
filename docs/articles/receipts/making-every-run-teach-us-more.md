# Draft claims receipt: Replay your agent harness, not the model

- Article draft: `R6-replaying-an-agent-run.md` (slug `making-every-run-teach-us-more`, date 2026-11-09 kept). Revision 3, after Nadia's REVISE.
- Evidence read at `origin/main` 4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2 (fetched 2026-11-17), written "commit `4c2cb0e`" in the article. Pre-fix lines are read from `76209f55e^` (the parent of the PR 1684 merge commit `76209f55ea3c0dfbec326017a359c753e3548d6d`, an ancestor of origin/main). The README link in the article is pinned to the same commit.
- Draft status: not approved. Nothing here is a ✅ Done claim.
- "At 4c2cb0e" and "main" below both mean that pinned revision.

## Claims

| ID | Exact factual sentence | Evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | When we replayed a coding-agent run with a scripted failing code review, the replay tool itself had two bugs. | PR 1684 body (`gh pr view 1684 --json body`): "reused a completion request ID when it launched repair, then exhausted its budget; its simulated reviewer also failed every head." | 🔎 Checked: the PR author states two defects. "Two" is my count of that sentence. |
| C2 | After the failed review it launched a repair that reused a completion request ID, then ran out of its retry allowance. | PR 1684 body (same sentence). README:49-54 ("budget exhaustion"). | 🔎 Checked as the PR author's wording. "Retry allowance" is my plain word for the PR's "budget" (README calls it the repair budget). I did not run the pre-fix code. |
| C3 | A completion request ID is the unique ID under which a finished task's completion is recorded. | `src/operatorActions/rehearsalChain.ts:192` ("The fresh completion request id one chain Action records its completion under: unique per run and Action"); `docs/agent-guidance/agent-asks.md:27` ("Use a fresh request id for each distinct request"; "changed content under that id is refused"); `docs/agent-guidance/agent-asks.md:203` (`complete` settlement of an Action). | 🔎 Checked, with a limit: `agent-asks.md` defines the general request ID of an Agent Ask, and the `complete` intent is the completion record. The exact phrase "completion request ID" is defined by the rehearsal code comment, not by that guidance file. |
| C4 | When set to fail once, its fake reviewer failed every version, so no repair could ever pass. | PR 1684 body ("its simulated reviewer also failed every head"); `scripts/production-replay.ts:968` at `76209f55e^`: `const fail = simulated === "fail-repairable" && role === "code-review";` (no head check). | 🔎 Checked in code: the mode named for one repairable failure failed every code review, so a repair could not pass. "Fail once" paraphrases the mode's documented intent (README:50-52). QA was not failed. |
| C5 | Both are described in pull request 1684, which merged on 2026-10-22 (UTC); the request-ID description is the PR's own wording. | `gh pr view 1684 --json state,mergedAt`: MERGED, `2026-10-22T06:42:27Z`; merge commit is an ancestor of origin/main. | 🔎 Checked. |
| C6 | The main limit: no real agent and no real reviewer took part; the edits and verdicts are scripts we wrote. | `tests/fast-rehearsal/README.md:47-63` ("This exercises one recovery, not a real reviewer's judgment"; "Provider execution, reviewer verdicts and GitHub writes remain simulated"); `docs/managed-production-readiness.md:337` ("Reviewers and GitHub writes were simulated; edits were trusted scripted fixtures"). | 🔎 Checked. |
| C7 | PR 1684 reports the repair case passing on macOS; I did not re-run it. | PR 1684 body ("real macOS Seatbelt fixture chains 9 passed during implementation before the final one-condition guard change, including fail → changed repair → fresh code-review/QA → simulated merge → next Action"). | 🔎 Checked as the PR author's report. The PR notes the nine passes came before a final guard change. ❓ Not proved by me: I ran nothing. |
| C8 | The test does not show that any agent repairs code well, or that a real reviewer would fail the same change. | README:52-53 ("not a real reviewer's judgment"); C6. | 🔎 Checked as a limit stated by the README. |
| C9 | The replay copies state from a source workspace and runs our real orchestration code over the copy. | `scripts/production-replay.ts:1874` (usage: `--source-workspace <workspace>`); README:61-63 ("validation and the worker's transitions are real"). | 🔎 Checked. "Copies" is read from the replay design; I did not run it. |
| C10 | The test notes say validation and the code's state transitions are real. The coding agent, the reviewer verdicts and the writes to GitHub are simulated (README, lines 47-63 at that commit). | README:61-63; readiness:337. | 🔎 Checked. |
| C11 | You tell the replay what the agent writes: one set of files for the first launch and a different set for the repair. | README:56-61 (`--executor-files`, `--executor-repair-files`); `scripts/production-replay.ts:1173-1188` (`scriptedReplayFiles`). | 🔎 Checked. |
| C12 | You also choose a review script. In `fail-repairable` mode the first reviewed version fails, retrying that same version still fails, and later versions pass. | `scripts/production-replay.ts:121-124, 179, 1041-1047`; README:50-53; `tests/production-replay.test.ts:415-417`. | 🔎 Checked by reading; I did not run it. |
| C13 | `fail-always` fails every code review, to test what happens when the repair budget runs out. | `scripts/production-replay.ts:121-124, 1040`; README:53-54. | 🔎 Checked by reading. QA still passes in that mode. |
| C14 | The PR body states the first failure: the replay "reused a completion request ID when it launched repair, then exhausted its budget." | PR 1684 body, first sentence. | 🔎 Checked, exact words. |
| C15 | Before the fix, the replay built a new scripted executor on every launch (`scripts/production-replay.ts`, line 1492 at the parent of commit `76209f55e`). | `git show 76209f55e^:scripts/production-replay.ts` line 1492: `const executor = new ScriptedExecutor(...)` inside `runExecutor`. | 🔎 Checked. "The matching code change" is my linking of this to the PR's description; I did not trace the failure at runtime. |
| C16 | After the fix, one executor lasts for the whole replay, with the comment "completion request ids survive repair launches" (line 1603 at commit `4c2cb0e`). | `scripts/production-replay.ts:1603-1613` at 4c2cb0e (`// One executor owns the whole replay so completion request ids survive repair launches.`; `scriptedExecutor ??= new ScriptedExecutor(...)`). | 🔎 Checked. README:49-50 gives the same purpose. |
| C17 | Before the fix the reviewer script failed every code review in `fail-repairable` mode (line 968 at the same parent). After the fix it remembers the first failed version and passes later ones. | `76209f55e^:scripts/production-replay.ts:968`; `scripts/production-replay.ts:1041-1047` at 4c2cb0e (`failed-review-head.json` state file). | 🔎 Checked. |
| C18 | A repair launch used to write the same default files as the first launch. | `git show 76209f55e -- scripts/production-replay.ts`: the removed `files` line was the same for every launch of an Action. | 🔎 Checked in the diff; inferred from code, not run. |
| C19 | Now the replay refuses a repair that has no repair files, or whose files change nothing. | `scripts/production-replay.ts:1181, 1183-1185`; `tests/production-replay.test.ts:71-83`. | 🔎 Checked by reading. |
| C20 | The code block is the full-chain test, `tests/production-replay.test.ts` lines 899-909 at commit `4c2cb0e`, dedented and cut at line 909. | `git show 4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2:tests/production-replay.test.ts \| sed -n 899,909p`, dedented by two spaces only. Line 910 (`}`) closes the `if (repair) {` and is not quoted. | 🔎 Checked: text copied by command, not retyped. |
| C21 | It is a macOS-only test, skipped unless `ARCADIA_PRESERVATION_HOST_TEST` is set to 1. I did not run it. | `tests/production-replay.test.ts:899` (`it.skipIf(process.env.ARCADIA_PRESERVATION_HOST_TEST !== "1" \|\| process.platform !== "darwin")`). | 🔎 Checked the gate. ❓ Not proved: that it currently passes. |
| C22 | In the repair case it expects the first task to launch twice, then the second task, three accepted completions, and simulated reviewer outcomes in this order: code review fail, code review pass, QA pass, code review pass, QA pass. | `tests/production-replay.test.ts:901-902, 909` (launch list `[A, A, B]` when repair; `accepted_completion` length 3; reviewer effects list). | 🔎 Checked by reading. "First task" = `source.actionA`. |
| C23 | A smaller test checks that our fake reviewer fails the first version, passes the repair and keeps failing the first version if retried; it tests the stub, not the recovery. | `tests/production-replay.test.ts:407-418` (`review("a")` fail, `review("b")` pass, `review("a")` fail). | 🔎 Checked by reading. "It tests the stub, not the recovery" is my characterization: the `codex` there is the replay's stand-in. |
| C24 | (REMOVED from the article after the critic's final check) PR 1684's body also records two source-state replays (a copy of the live workspace): one stopped at a time cap, and a later combined run finished with three accepted completions. | PR 1684 body ("reached its unchanged 90-minute cap (exit 124)"; "completed successfully in **19m49s**: three accepted completions..."). | 🔎 Checked as the PR author's report. The article gives no time figures. The cap and exit code are in the PR body only (readiness:337 does not contain them). "Copy of the live workspace" is my gloss of source-state replay. Receipts in the linked PR comment were not opened. |
| C25 | (REMOVED from the article) No claim here depends on those times. | Editorial statement. | 📐 Editorial; true of this article as written. |
| C26 | The numbered steps under "Try it yourself" and the sentence "A pass then says more than 'the recovery code ran.'" | The original article's closing advice. | 📐 Proposed editorial advice, not a factual claim. |
| C27 | The fixtures were written in PR 1684 itself, by the same change that fixed the replay; nobody independent wrote them. | PR 1684 changed three files: `scripts/production-replay.ts`, `tests/production-replay.test.ts`, `tests/fast-rehearsal/README.md` (`git show --stat 76209f55e`); the fixtures are in the test file. | 🔎 Checked. No claim about who wrote the worker repair logic (`src/commands/worker.ts`, not in this PR). |
| C28 | Not proved: that a live run has ever sent a real failed review through this repair path. This article cites no such run. | Absence of citation only. | ❓ Not proved. A limit, not a finding. |
| C29 | Not compared: I read no other replay tool's documentation, so this article does not place the test beside any. | Statement about my reading. | ✅ true of this revision: the VCR sentence and the 19m49s paragraph were removed. |

## Changes in this revision

- Removed: VCR section and name (no unverified external citation); the 90-minute and 19m49s figures; the header summary now starts with the result and carries no mode names.
- Swapped: the reviewer-stub excerpt (lines 407-418) for the full-chain assertions (lines 899-909), the stub kept as one sentence.
- Paragraph one: plain-language rewrite; `fail-repairable` appears only later.

## Not checked

- I did not run `tests/production-replay.test.ts`, the replay, or any code. All behavior statements are from reading source and PR text.
- I did not open the PR 1684 comment holding the run receipts, nor the CI results.
- I did not read PR 1684's commit-by-commit review thread. The runtime failure behind the reused request ID rests on the PR body and a code comment; it was not traced.
- The definition of "completion request ID" is assembled from `rehearsalChain.ts:192` and `agent-asks.md`; no single document defines the phrase.
- I did not check whether `76209f55e` equals the final CI-tested head `e7979f11c`; the article does not claim it.
- Whether the Field Notes site renders the code block or the front matter fields `writer`, `operator_suggestion` and `last_modified_at` was not tested.

## Independent review

- Reviewer: a separate read-only Claude Code subagent (Sonnet 5.5, role fact-checker), not the author and not Flynn. It checked every sentence against `origin/main` (the revision pinned above) and did not take the author's draft receipt on trust.
- Rounds: Round 1: FAIL on nine sentences (corrected). Round 2: PASS. After the critic's edits (a plain-language opening, the full-chain assertions at lines 899-909 of the replay test quoted exactly, the comparison section and the timing paragraph cut) Round 3: PASS, with the excerpt diffed byte for byte against the pinned commit. Two final mechanical edits (deleting a one-sentence section and adding a cut-line comment to the code block) were applied after the critic's last check and were not re-run.
- Findings: none outstanding at the last reviewed revision; the receipt's Not checked list states what was not verified.
- Verdict: PASS

## Editorial review

- Critic: Nadia (Arcadia's critic role, a separate read-only subagent) applied the Field Notes interest gate: a stranger can state the claim without Arcadia terms, a real result with its limits, a reusable method, a distinct angle, a searchable title, and a headline that survives its own caveats.
- Editorial verdict: APPROVE; placement: archive and the testing topic page.
- Release approval: the operator's chat instructions of 2026-11-17: "I want Field Notes to only publish articles that Nadia approves. Have Clara rewrite all articles that Nadia thinks need work. ... Then one more review and publish." Merging this change is the release; set `status: withdrawn` in a reviewed change to unpublish.

## Changes after the critic's final check

- The section 'What else the pull request records' (and the claims it carried about two source-state replays and a time cap) was deleted; any receipt row that cites it (for example C24) no longer applies to the article.
- The code block now ends with the comment `// … (excerpt cut at line 909)`, because the excerpt stops inside an unclosed `if (repair) {`; the quoted lines themselves are unchanged from 899-909 at commit 4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2.

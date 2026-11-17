---
title: "Replay your agent harness, not the model: a bad-verdict regression test"
date: 2026-11-09
type: essay
slug: "making-every-run-teach-us-more"
summary: "Found two bugs in our own replay tool by replaying a coding-agent run against a scripted failing code review; the test code is shown, with its limits."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "Pick one failure your agent harness has already hit, script the bad review that causes it, and assert the head it reviews, the effects it attempts and where it stops."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/making-every-run-teach-us-more.md"
canonical: "https://pmark.github.io/arcadia/posts/making-every-run-teach-us-more/"
channels: [site, rss]
tags: [testing, reliability]
last_modified_at: "2026-11-17"
---

# Replay your agent harness, not the model: a bad-verdict regression test

When we replayed a coding-agent run with a scripted failing code review, the replay tool itself had two bugs. After the failed review it launched a repair that reused a completion request ID (the unique ID under which a finished task's completion is recorded), then ran out of its retry allowance. And when set to fail once, its fake reviewer failed every version, so no repair could ever pass. Both are described in [pull request 1684](https://github.com/pmark/arcadia/pull/1684), which merged on 2026-10-22 (UTC); the request-ID description is the PR's own wording.

The main limit: no real agent and no real reviewer took part. The edits and the review verdicts are scripts we wrote. PR 1684 reports the repair case passing on macOS; I did not re-run it. The test does not show that any agent repairs code well, or that a real reviewer would fail the same change.

## What is replayed and what is scripted

The replay copies state from a source workspace and runs our real orchestration code over the copy. The test notes say validation and the code's state transitions are real. The coding agent, the reviewer verdicts and the writes to GitHub are simulated ([README](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/tests/fast-rehearsal/README.md), lines 47-63 at that commit).

You tell the replay what the agent writes: one set of files for the first launch and a different set for the repair. You also choose a review script. In `fail-repairable` mode the first reviewed version fails, retrying that same version still fails, and later versions pass. `fail-always` fails every code review, to test what happens when the repair budget runs out.

## What it found

The pull request body states the first failure: the replay "reused a completion request ID when it launched repair, then exhausted its budget." The matching code change: before the fix, the replay built a new scripted executor on every launch (`scripts/production-replay.ts`, line 1492 at the parent of commit `76209f55e`). After the fix, one executor lasts for the whole replay, with the comment "completion request ids survive repair launches" (line 1603 at commit `4c2cb0e`).

The second failure was in the reviewer script. Before the fix it failed every code review in `fail-repairable` mode (line 968 at the same parent). After the fix it remembers the first failed version and passes later ones.

A third change closes a loophole. A repair launch used to write the same default files as the first launch. Now the replay refuses a repair that has no repair files, or whose files change nothing.

## The test

This is the full-chain test from `tests/production-replay.test.ts`, lines 899-909 at commit `4c2cb0e`, dedented and cut at line 909. It is a macOS-only test, skipped unless `ARCADIA_PRESERVATION_HOST_TEST` is set to 1. I did not run it. In the repair case it expects the first task to launch twice, then the second task, three accepted completions, and simulated reviewer outcomes in this order: code review fail, code review pass, QA pass, code review pass, QA pass.

```ts
it.skipIf(process.env.ARCADIA_PRESERVATION_HOST_TEST !== "1" || process.platform !== "darwin")("runs the whole chain: preservation, simulated PR, review, simulated merge, the next Action, all merged", () => {
  if (process.env.REPLAY_DEBUG_FILE) writeFileSync(process.env.REPLAY_DEBUG_FILE, printed.join("\n"));
  expect(report.ticks.filter((tick) => tick.launch?.outcome === "launched").map((tick) => tick.launch!.actionKey)).toEqual(repair ? [source.actionA, source.actionA, source.actionB] : [source.actionA, source.actionB]);
  expect(report.ticks.flatMap((tick) => tick.reconciled).filter((entry) => entry.outcome === "accepted_completion")).toHaveLength(repair ? 3 : 2);
  expect(report.ticks.flatMap((tick) => tick.log).join("\n")).not.toContain("repair_budget_exhausted");
  expect(report.ticks.map((tick) => tick.executor ?? "").join("\n")).not.toContain("FAILED");
  if (repair) {
    const logs = report.ticks.flatMap((tick) => tick.log).join("\n");
    expect(logs).toContain("round 1 of 3");
    const reviewerEffects = report.ticks.flatMap((tick) => tick.effects).filter((effect) => effect.kind === "simulated:reviewer");
    expect(reviewerEffects.map((effect) => effect.detail)).toEqual(["code-review fail", "code-review pass", "qa pass", "code-review pass", "qa pass"]);
    // … (excerpt cut at line 909)
```

A smaller test checks that our fake reviewer fails the first version, passes the repair and keeps failing the first version if retried; it tests the stub, not the recovery.

## Try it yourself

1. Pick one failure your harness has already hit.
2. Script the bad verdict that causes it.
3. Assert which version it reviews, which outside effects it attempts, and where it stops.

A pass then says more than "the recovery code ran."

## What is not done

- No real agent or reviewer has been run against this repair path. The README says the test exercises one recovery, not a real reviewer's judgment.
- The full-chain test is gated to macOS and an environment variable, and I did not run it.
- The fixtures were written in PR 1684 itself, by the same change that fixed the replay; nobody independent wrote them.
- Not proved: that a live run has ever sent a real failed review through this repair path. This article cites no such run.
- Not compared: I read no other replay tool's documentation, so this article does not place the test beside any.

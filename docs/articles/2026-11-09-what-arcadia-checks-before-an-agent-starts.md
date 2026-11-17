---
title: "Lint the task before the agent starts: how an example filename caused retries"
date: "2026-11-09"
type: essay
slug: "what-arcadia-checks-before-an-agent-starts"
summary: "An example test filename in a task description made an unattended coding agent run 26 sessions that were each refused, so we added a pre-flight check on task text; it has not yet been shown to reduce retries."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "Before your next unattended batch, run your completion validator's file detection over each task twice, once on the raw text and once with example data masked, and read every difference by hand."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/what-arcadia-checks-before-an-agent-starts.md"
canonical: "https://pmark.github.io/arcadia/posts/what-arcadia-checks-before-an-agent-starts/"
channels: [site, rss]
tags: [agent-workflows, testing, reliability]
last_modified_at: "2026-11-17"
---

# Lint the task before the agent starts: how an example filename caused retries

On 2026-11-07, an unattended coding agent ran 26 sessions for one task, and each was refused and retried. The task text mentioned an example test filename, and the completion check (the automated check that decides whether a session's work is complete) read that filename as a file the agent had to create. We then added a check that reads task text before any agent starts. It warns when an example path may be read as a required file, and it refuses text that contains certain invisible characters.

🔎 Checked: the check exists and is merged. ❓ Not proved: that it reduces retries. ❓ Not proved: that the check would have flagged the criterion that caused the 26 refusals; the validator was fixed first, and the test suite expects no warning for a similar phrasing ([test](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/tests/start-run-pins.test.ts#L270-L278)). No live catch is recorded. Every real input examined so far produced no warning, so the check has only been seen firing on test fixtures.

## What happened

One acceptance criterion for a test-only task listed `tests/x.test.ts` as a value the new test should assert to be false. The completion check treated every test-file-shaped path in the criteria as a file the change must contain. From 20:11Z to 21:26Z, 26 sessions finished their work and were each refused with `tests/x.test.ts (missing)` ([PR #2241](https://github.com/pmark/arcadia/pull/2241)). The run report records this run as "26 Sessions (52 launches by the Keeper's count)" without defining the difference between a session and a launch, so this article uses the session count ([run report, row 49](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/docs/reports/relay-record-run-night-2026-11-07.md#L35)).

The same night, in a second task, a session wrote an invisible U+200B character where the criterion and the QA step expected the ASCII escape written out, so the QA match failed ([Issue #2272](https://github.com/pmark/arcadia/issues/2272)).

Both instances were fixed for those tasks. For the first, the criterion was reworded ([PR #2236](https://github.com/pmark/arcadia/pull/2236)) and the completion check now skips paths that are data, such as a source location or an item in a true/false value list ([PR #2241](https://github.com/pmark/arcadia/pull/2241), [code](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/src/sessions/completionValidation.ts#L141-L175)). The second was landed by hand ([PR #2260](https://github.com/pmark/arcadia/pull/2260)). Issue #2272 recorded the remaining gap: nothing at plan intake or in the pre-run review caught such text.

## The check

[PR #2287](https://github.com/pmark/arcadia/pull/2287), merged 2026-11-08 at 21:06Z, adds the check to the read-only command that pins the selected tasks at a fixed revision before a run is started. For each selected task it does two things:

1. **Refuses invisible characters.** A listed set of non-printing characters, including U+200B and U+2060, stops preparation. The message tells the author to spell out the escape ([code](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/src/commands/startRun.ts#L146-L151)).
2. **Warns on ambiguous paths.** It finds the test files the completion check would require, then finds them again after masking text that looks like example data. A file that appears only in the first list produces a warning: "would require tests/example.test.ts as a test file; clarify if it is example data." It is a warning because an assertion can legitimately name a real file ([code](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/src/commands/startRun.ts#L164-L167)).

The check is text pattern matching. The function makes no model call and reuses the existing test-file parser ([code](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/src/commands/startRun.ts#L143-L169)). It cannot tell an example from a real file: the test suite expects a warning for both `classify(repo, "tests/example.test.ts")` and `existsSync("tests/real.test.ts")` ([test](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/tests/start-run-pins.test.ts#L281-L292)). A person decides.

## What the evidence shows

| Measurement | Result (as reported) | Source |
| --- | --- | --- |
| Pre-merge sweep of existing unfinished tasks | 248 tasks in 38 plans, zero findings | [PR #2287 description](https://github.com/pmark/arcadia/pull/2287) (author's report) |
| Tasks delivered in four batches after the merge | 15 tasks, 18 build sessions | [receipt](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/docs/articles/receipts/what-arcadia-checks-before-an-agent-starts.md#follow-up-run-evidence) |
| Sessions per task | 14 tasks took one session; one took four | same receipt |
| Replay of the pinned criteria for those batches | 0 warnings, 0 refusals | same receipt |

The one task that took four sessions was held up by a different error. A later step, the generated QA plan, read path-like strings quoted as test input as changed files ([Issue #2324](https://github.com/pmark/arcadia/issues/2324)). [PR #2325](https://github.com/pmark/arcadia/pull/2325) fixed that separately and states that it does not reuse the pre-flight check. The replay for the batch containing that task reported 0 warnings, so the check, replayed on its criteria, did not flag it.

## What to copy

You can try the method without our tooling:

1. Run your completion validator's file detection on the task text.
2. Run it again after masking anything labelled as example data.
3. Treat any difference as a question for the author, not an error.

For invisible characters, Issue #2272 suggested `rg -nP '[^\x00-\x7F]'`. This is proposed, not what we shipped. It also matches harmless visible Unicode such as accented letters. I ran it on a scratch file and it matched both an accented letter and a zero-width space.

## What is not done

- ❓ Not proved that the check reduces retries. The saved records omit its live output, and the replay covers only cards that succeeded, so it cannot reveal a warning or edit that left no retained record ([receipt](https://github.com/pmark/arcadia/blob/4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2/docs/articles/receipts/what-arcadia-checks-before-an-agent-starts.md#follow-up-run-evidence)).
- ❓ Not exercised before merge: the installed runtime and a live start ([PR #2287 description](https://github.com/pmark/arcadia/pull/2287)).
- ❓ The 18-session count, the 14-and-4 split and the replay result come from the earlier receipt; I did not re-derive them.
- The 15 tasks were serial and test-only. They say nothing about other kinds of work.

---
title: "Five rounds of independent review on one agent-written change: what the reviewer kept finding"
date: 2026-11-09
type: essay
slug: "why-agent-roles-make-collaborative-work-easier"
summary: "Five rounds, three blocking findings in round one: a summary comment lists the same approval check as still open in each of the first three rounds; this note relays it and states what that does not prove."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
operator_suggestion: "On your next agent-written change that touches permissions, start a separate read-only reviewer on the exact commit and post each round's findings as a pull request comment when they happen."
status: approved
not_done: true
claims_receipt: "docs/articles/receipts/why-agent-roles-make-collaborative-work-easier.md"
canonical: "https://pmark.github.io/arcadia/posts/why-agent-roles-make-collaborative-work-easier/"
channels: [site, rss]
tags: [agent-workflows, review]
last_modified_at: "2026-11-17"
---

# Five rounds of independent review on one agent-written change: what the reviewer kept finding

🔎 **Checked.** A coding agent wrote a change in pull request 1171, and, according to a summary comment, a separate read-only reviewer reviewed it. The comment says the review took five rounds, with three blocking findings in round one. Read in order, its lines show the approval check still open in each of the first three rounds: first reading local files, then steerable through environment settings, then through the search path and home directory. Round 4 is the first it reports with no blocking findings. That sequence is my reading of the list, not a statement in it. In pull request 1296, the same kind of comment says a round with no blocking defect was followed by a list of bypass phrasings that still get through. The reviewer's own reports are not in either pull request.

❓ **Main limit.** There was no control without review, and the findings are relayed from a summary comment posted under the project account. These threads do not show that the author would have missed the flaws.

## Pull request 1171, round by round

The change lets a session start work on a disposable test repository without a person confirming at a terminal. The comment lists each round and the commit the reviewer examined.

| Round | Commit | Blocking finding? | Class of finding, in plain words |
| --- | --- | --- | --- |
| 1 | 51899711d | Yes, three | The approval check read local files (the comment calls it a "forgeable Decision gate (working-tree read)"). The check of where code would be pushed could change between the check and its use, and missed rewritten remote addresses. One branch skipped the remote check. |
| 2 | 0535d5d29 | A fix for two accepted; one still open | The approval check was still forgeable, through environment settings that steer which workspace is read and through local references an agent can write. |
| 3 | 52b02c1eb | One still open | The approval record was now fetched from the hosting service's main branch, but the fetch could still be steered through the search path (a fake `gh` program) or the home directory. |
| 4 | 143feab9e | No | `gh` pinned to absolute trusted paths, home directory taken from the system user record, search path fixed, tokens dropped, file hash verified. The summary says this holds under the project's stated threat model, which accepts tampering by a deliberately misbehaving process running as the same user. |
| 5 | 8a720629d | No | A type fix only. |

A sixth check, on commit c6f613e88 after an automated reviewer commented, also reported no blocking findings. The comment does not use the word "blocking" for rounds 2 and 3; the table states what it says remained open.

Today's code states the result. A doc comment in the launch module says the approval is fetched from the main branch of the repository itself, with no local reference, working tree, workspace database or user config consulted, and that any fetch failure refuses.

## Pull request 1296: a clean last round, then a list

Pull request 1296 changed a validator; its description says it "judges an approval-contradiction per sentence". According to the summary comment on that pull request, round 1 reported five bypasses of the validator plus a task owned by a person that was routed to Codex, a coding agent. Round 2 reported seven classes of bypass, such as "does not need an approved goal" and "pre-approved". Round 3 reported no blocking defect for a first slice. The same comment then lists further bypass phrasings that still get through, such as "Approval is waived." A clean final round was not proof of completeness. Several of the round 2 phrasings are now test cases in the repository, for example "Implementation is pre-approved."

## What to do with this

1. Give the reviewer the failure classes to attack. The repository's review procedure names data loss, broader authority, handing the same work to two agents, races, regressions, and differences between the author's host and the build server.
2. Review each new commit afresh. In pull request 1171, a fix to one flaw was followed by a new review, and, per the summary comment, the next round found the check still open.
3. Post each round's findings as a pull request comment as they happen. This is our lesson, proposed and not a measured result: here the findings were only summarized afterwards, so a reader cannot check what the reviewer wrote.

## What is not done

- No control: nobody wrote the same change without a reviewer, so the value of review is not measured.
- The reviewers' own reports are not in either pull request; the findings come from a summary comment posted under the project account.
- No acceptance-test finding appears in these threads (PR bodies, comments and reviews only were searched). Pull request 1171 used the generic read-only pull-request reviewer (a "read-only subagent" per its summary comment), which the procedure says is not admission to a registered code-reviewer role; the comment on 1296 does not say how its reviewer ran.
- The remaining validator bypasses in pull request 1296 are listed there as follow-up; this note does not check whether they were fixed.

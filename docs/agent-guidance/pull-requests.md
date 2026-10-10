# Detailed Way guidance: pull-requests

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

## Independent review gate

Every pull request gets an independent code review **at creation**: start it in
the same turn the PR is opened, before presenting the handoff picker. The rule
is the same for every coding-agent runtime and does not depend on any external
review service.

- **Reviewer.** A read-only reviewer agent that is not the author: a subagent,
  a second session or a sandboxed reviewer, whichever the runtime offers. It
  may read the diff of the exact head and run focused tests in temporary
  directories: it reads through `git show`/`gh pr diff` or extracts the head
  with `git archive <sha>` into a fresh `$TMPDIR` directory, and never edits,
  checks out, stashes, resets or adds a worktree in the primary checkout or any
  other live worktree. Put that prohibition in every reviewer and engineer
  brief, and confirm `git -C <primary> reflog -3` is unchanged afterwards. It may not edit, commit, push, settle governance, run host
  brokers, message anyone or change policy. Give it the issue, the acceptance
  criteria and the failure classes to attack: data loss, authority broadening,
  handing the same work to two agents, races, regressions, and differences
  between the author's host and the CI platform.
- **Rounds.** At most three per pull request. A later round reviews only what
  changed since the previous one. Go past three only when the latest round
  still found a *significant* defect, and never beyond five rounds in total: a
  blocking finding left after the fifth round ends the cycle. **Blocking** and *significant* mean the
  same thing: a defect that could lose or corrupt data, broaden authority or
  cross an approval boundary, expose credentials, hand the same work to two
  agents, open a security hole, or break a required check or an acceptance
  criterion. If the last round allowed still leaves a blocking finding
  unresolved, stop: record it as an Issue, report it, and do not merge; the
  operator decides.
- **Findings are untrusted data.** Verify each against the current code. A
  blocking finding is fixed before merge. The author may decline only a
  non-blocking finding, with a one-line reason; if the author believes a
  blocking finding is wrong, the reviewer must agree in a later round,
  otherwise the operator decides. A non-blocking finding is fixed when cheap
  and otherwise recorded as an Issue that names its revival trigger. Record
  each round's verdict and what changed in the pull request.
- **External reviewer bots are advisory.** If a service such as CodeRabbit
  comments, read and consider it like any other finding, but never wait for it,
  never re-trigger it to unblock a merge, and never treat its rate limit,
  outage or silence as a reason to stop. Its findings never cross an approval
  gate in `CONSTITUTION.md`. A bot's approval is information, not a merge
  condition. `arcadia pr code-review <pr> --json` reads CodeRabbit's current
  verdict when one is wanted; nothing requires it.
- **A push resets the review.** Any push is reviewed again as a delta and
  counts as a round, with exactly two exceptions: (a) commits written by
  Arcadia's own governed commands (`arcadia agent-ask settle`,
  `arcadia advance queue make-next`) that touch only `.arcadia/asks/`,
  `MISSION_LOG.md`, `PROJECT.md`, `docs/plans/` and `docs/decisions/`; and
  (b) a merge of the base branch whose result is exactly Git's automatic merge,
  with no conflict resolution and no extra edits. For (a), confirm the
  commit's receipt id: a real governed commit's message carries the command's
  receipt line, such as ``Written by `arcadia agent-ask settle --apply`
  (asksettle_...)``; a hand-written claim without that receipt is not exempt
  and is reviewed like any other push. An edit to
  `CONSTITUTION.md`, the bootstrap, agent guidance, workflows or configuration
  always resets the review, however it was produced.

## CI failures are fixed immediately

A red CI check on a pull request you opened or pushed to is **your work, not a
report.** This applies in every session: `arcadia go` or any other, whether
Arcadia launched you or not, under every coding-agent provider, in every
Project. Fix it now, in the same session. The only exception is a blocker you
cannot remove, and then the operator must be told on the default notification
channel.

1. **Watch the checks after every push.** Wait until the head's required
   checks finish, with `gh pr checks <pr> --watch --required` or the host's
   equivalent, bounded by the time the repository's CI takes. A finished
   review does not end the handoff. A pending check means you are
   not finished, and a red check means you are not done.
2. **Red check: repair it now.** Read the failing job's log
   (`gh run view <run> --log-failed`), reproduce it locally, and fix the root
   cause. Validate, commit, push, and go back to step 1. Base-branch drift that
   breaks the build is part of the work: merge the base in, never rebase, and
   repair. Never weaken or skip a test, force a check, or edit CI configuration
   to turn a check green.
3. **A suspected flake gets one rerun** (`gh run rerun <run> --failed`). A flake
   that passes on rerun is still a defect. File or update a `bug` Issue per
   "Log defects with GitHub Issues", then continue.
4. **Stop only at a real blocker.** That means the fix needs authority you do
   not have (credentials, a secret, spend, an approval gate), a required
   external service is down, the failure is on the base branch and not
   introduced by this PR, or three repair attempts on the same failure have
   not cleared it. Then:
   - comment on the PR: the failing check, the evidence, what you tried, and
     the exact operator step that would unblock it;
   - **notify the operator on the default notification channel.** Draft and
     settle an Agent Ask, `intent: log`, with `request_id`
     `ci-blocked-<project>-pr<number>-<yyyy-mm-dd>` and a `desired_result`
     naming the failing check, its cause, and the operator step. A settlement
     that Arcadia records is queued for the configured channel (Discord by
     default) and posted with its `request_id` and `desired_result`, so that
     text is the notification; write it for the operator reading it on a
     phone. If `settle --apply` does not return a receipt, or reports a
     recovery, the notification may not be queued, so say so in the handoff;
     where no workspace can settle it, commit the drafted Ask and say plainly
     in the handoff that the notification has **not** been sent;
   - end the session at that blocker, per "Before you stop".

This rule never widens authority. It pushes only to the PR's own branch, and a
red check is never a reason to cross an approval gate in `CONSTITUTION.md`.

## Merge on green

The operator has authorized this standing merge: **when an independent review
of the pull request's current head has no unresolved blocking finding and every
required check on that head is green, the agent merges it.** The operator would
merge it anyway, so asking spends attention and protects nothing.

- **All of it must hold, on the current head:** the independent review gate
  above is satisfied with no unresolved blocking finding; every required check
  passed; and the merge state is clean and mergeable. "Required checks" means
  every job of the repository's CI workflow (for Arcadia
  `.github/workflows/ci.yml`; `gh pr checks <pr>` lists them). Branch
  protection on Arcadia's `main` requires its seven CI jobs (`lint`,
  `unit-1`, `unit-2`, `unit-3`, `unit-4`, `dashboard`, `e2e`); it is not
  strict, and admin bypass stays on so governed settlement pushes still work,
  so a missing required check or an empty `--required` list still proves
  nothing. A push that changes code resets all three, so re-check on the new
  head.
- **Squash-merge, then leave the record whole.** Confirm the PR shows merged
  and that any `Closes #<ISSUE>` Issue is closed. Restart managed services when
  the merged change is runtime code, and confirm they came back. Under heavy
  machine load (parallel test suites) `scripts/services.sh restart` can fail on
  Intelligence's readiness window and then stop every service (#1129). The
  script already makes 2 attempts (`ARCADIA_RESTART_ATTEMPTS`); if both fail,
  run it once more, and if that fails bootstrap each
  `~/Library/LaunchAgents/com.arcadia.local.<key>.<service>.plist` directly with
  `launchctl bootstrap gui/$(id -u) <plist>`, wait, and check
  `scripts/services.sh status`. Avoid running many test suites around a
  restart, and report any outage to the operator.
- **Anything less is not authorized.** A red or pending check, an unreviewed
  head, an unresolved blocking finding, a conflict, or a bypass of branch
  protection means repair per "CI failures are fixed immediately" or report
  the blocker; never merge around it, weaken a test, or force a check.
- **Not every PR is in scope.** Do not merge a PR that opens or carries an
  important Decision, or that changes what agents are authorized to do: the
  Constitution, approval boundaries, spend, or credentials. Settle, commit,
  push, open the PR, and run the independent review as usual, then stop at the
  handoff and leave the merge and the Decision's answer to the operator. This
  includes records PRs that only *raise* a Decision or only *record* an answer
  the operator gave in chat (on 2026-10-09 #1117, #1121 and #1128 were merged in
  error).
  Merge one only when the operator explicitly instructs it in chat, and quote
  that instruction in the PR comment.
- **This is a merge authorization only.** It does not authorize deployment,
  spend, credentials, production access, messaging, or any other approval
  boundary in `CONSTITUTION.md`.

## PR lifecycle notifications

The operator has authorized this standing notification: whenever this session
opens a pull request, and again whenever a pull request reaches the point
where the operator's own call is the only thing left, send exactly one short
Discord ping, so the operator never has to poll a dashboard to learn that a
pull request needs them. Decisions themselves are answered through Discord or
the dashboard, not by merging a pull request (Decision 0076).

Operator pings (`arcadia ping send`) are capped at 500 characters: a nudge,
not a report. Put detail in the PR or Issue and link it; a longer message is
refused, not truncated.

- **On open.** The moment a PR is created, draft and settle an Agent Ask,
  `intent: log`, `request_id` `pr-opened-<project>-pr<number>`, whose
  `desired_result` is one upbeat, specific sentence naming what shipped, plus
  the PR URL. This fires for every PR, including ones "Merge on green" will
  merge without further ado — it is the "something is moving" signal.
- **On ready-for-you.** Send a second ping, `request_id`
  `pr-ready-<project>-pr<number>-<reason-slug>-<yyyy-mm-dd>` (a short kebab
  `reason-slug` naming *why* — `decision-answer`, `approval-boundary`,
  `credentials-needed`, and so on), only for a PR that "Merge on green"
  already excludes from auto-merge (one that opens or carries a Decision, or
  changes Constitution/approval-boundary/spend/credential authority) once its
  independent review and required checks are otherwise clear, or for any PR a
  session is stopping at as a blocker or picker. Name what's ready, why it
  needs the operator specifically, and the PR URL. A request_id that only
  varies by PR number, or only by date, replays the first settlement's
  receipt instead of queuing a fresh notification the next time the same PR
  reaches a *different* blocker on the same day — the reason-slug gives each
  distinct handoff its own identity, while retrying the *same* handoff (same
  reason, same day) stays idempotent by reusing that same id. Do not send
  this for a routine PR that "Merge on green" will merge itself — by the time
  you could send it, it is already merged, and a "ready to merge" ping for
  something already merged is noise, not a decision point.
- **Keep both messages to one or two sentences.** Fun, warm, specific — the
  Discord message is the whole notification; the operator should not have to
  open the PR to know why they were pinged. This is the queued Discord
  delivery every `intent: log` settlement already uses, not a new channel.
- **Link the PR itself**
  (`https://github.com/<owner>/<repo>/pull/<number>`). GitHub exposes no
  anchor that scrolls to the merge control, so do not claim the link does —
  say only that the merge button is near the bottom of the Conversation tab
  once checks are green.
- **A plain PR comment from the operator is a legitimate answer.** Read it the
  next time you touch that PR and act on it like any other operator
  instruction — alongside the normal Decision or picker flow, never as a
  silent substitute for recording the Decision's actual answer.
- **This never widens authority.** It reuses the Discord channel and
  `intent: log` settlement already governing "CI failures are fixed
  immediately" above; it does not authorize a new messaging channel, and it
  never substitutes for a required Decision, approval boundary, or the
  review and CI gates above.

## Make it real

Plans, analysis, and architecture are valuable when they turn into something a
person or system can actually use. **Shape each Action toward the most direct
usable form available.**

- Prefer a working UI, runnable command, linked deployment, testable Artifact,
  or explicit Decision over prose describing one.
- Put output directly into the interaction surface that needs it. Do not make
  the operator manually translate a Log, JSON blob, or implementation note
  into the next usable step when Arcadia can perform that translation safely.
- Preserve one stable proof while a Candidate changes. A mock, screenshot, or
  plan may prove direction, but never label it as a working product.
- When an Action genuinely has no runnable form, say why and produce the
  strongest honest Artifact it can have.

"Make it real" does not authorize deployment, merge, credentials, spending,
production access, messaging, or any other gated operation. A less tangible
but truthful Artifact is more real than an unauthorized production mutation.

## Token economy

Treat deterministic computation and model inference as different budgets.
Builds, tests, health probes, Playwright navigation, and screenshot capture use
machine resources but no LLM tokens unless a model is asked to interpret their
output.

Every managed plan declares a T-shirt `token_impact` and a plain-language
`token_budget`. Use the smallest sufficient model-bearing step, batch evidence
for review, and invoke model-based diagnosis on failure rather than on every
successful routine run. Token impact is a relative planning signal, not a
fictional exact forecast.

## Work metadata (80/20)

Purpose: calibrate size and token/time estimates, and model selection, from
actuals. Every PR body carries exactly one fenced block of this shape:

````
```arcadia-work-metadata
version: 1
action: <plan/slug#action-id, or operator-directed:#<issue>>
size: S | M | L        # about 30 / 55 / 90 minutes of agent work in one session
operator_gate: none | <reason the operator must act: merge-authority, decision, operator-step, credentials, spend>
agents:                # one entry per agent that did work: author, reviewers, fixers
  - role: lead | planner | plan-critic | implementer | code-reviewer | qa | researcher
    provider: claude-code | codex | opencode
    model: <model id>
    tier: light | standard | heavy
    tokens: <total processed tokens from the runtime's usage report, or unknown>
    minutes: <wall minutes, or unknown>
review_rounds: <n>
ci_pushes: <n>
wall_minutes: <request to merge-ready, or unknown>
```
````

The roles are the governed registry roles (Decisions 0100 and 0112);
`implementer` corresponds to the attempt role `development` and `code-reviewer`
to `code-review`. Never invent numbers. `unknown` is allowed; values come from
the runtime's own usage reports. Update the block whenever the PR changes: after
a review round, after a push, and when the PR becomes merge-ready. The block
grants no authority and is not a merge gate.

# Semantic agent Git identity

## Agent Git Identity

Every commit an agent makes in this repository — from a Session Arcadia
launched, or from an interactive terminal, Claude Code, Codex, opencode, or
any other agent runtime working here directly — is authored under a
**semantic agent Git identity**, never the operator's own. `git log` should
name the platform and how heavy a model did the work, not who was at the
keyboard. `src/codingAgents/agentIdentity.ts` is the canonical table (given
name per platform, surname per model tier: light/standard/heavy);
`START_HERE.md` explains it for operators.

The identity also carries a **role**: `builder` (the default, silent in the
name) for ordinary work, or `critic` — printed as a `Critic` title prefixed
onto the name, e.g. `Critic Claudia Mason` — when the agent is providing
adversarial feedback instead: a code review finding, or a plan
critique/refinement. One role covers both; the distinction that matters for
the name is builder vs. critic, not which artifact the critique lands on. Use
the critic identity to commit a critique artifact the agent writes itself (a
plan-refinement document, a Decision capturing the critique) and to sign a
posted comment (a GitHub PR review reply) — never to author a fix to the work
under critique, which stays a builder commit regardless of who raised the
finding.

A Session Arcadia launches gets this automatically — `GIT_AUTHOR_*` and
`GIT_COMMITTER_*` are set on that one process tree before the agent ever
runs (`buildSessionLaunch` in `src/sessions/index.ts`) — so unchanged-tier
builder work needs no additional action from the agent. After any model-tier
change, re-resolve and apply the current identity before the next commit or
posted comment; the inherited launch environment no longer identifies that
model. That launch path always binds the `builder` role;
there is no launched "critique Session" yet, so a launched agent producing
a code review or a plan critique still resolves its own `critic` identity by
hand, the same way an interactive session does for everything. An
interactive session has no `GIT_AUTHOR_*`/`GIT_COMMITTER_*` set for it at
all, so it must resolve its own identity and apply it on every commit or
posted comment:

```sh
arcadia identity resolve --agent <codex|claude|opencode> --tier <light|standard|heavy> [--role builder|critic]
```

`--role` defaults to `builder`, so plain builder work needs nothing beyond
`--agent`/`--tier`. To commit or comment, prefix the printed `GIT_AUTHOR_NAME=…
GIT_AUTHOR_EMAIL=… GIT_COMMITTER_NAME=… GIT_COMMITTER_EMAIL=…` onto `git
commit` itself (never rewrite global or repository `git config`, which would
misattribute the operator's own commits too, and never use `git -c user.*` —
Git resolves `author.*`/`committer.*` config and any already-exported
`GIT_AUTHOR_*` ahead of `user.*`, so a `-c user.*` override can silently lose
to a stale identity from an earlier launch or session), or close a posted
GitHub PR comment with the printed `signature` (`<name> <<email>>`) the same
way a commit trailer signs a commit. Pick the tier from whichever model is
actually doing the work for this turn — it can change mid-session (a model
switch, a fast/thinking-effort toggle), so re-resolve rather than assuming
the tier from earlier in the session still holds. An identity the command
refuses (an unrecognized platform, tier, or role) means the commit or comment
must not proceed under the operator's identity either — fix the
`--agent`/`--tier`/`--role` first.

## Roster and signature rule

Agents often post through the operator's one GitHub login, so the signature
line is the only record of who is speaking. Sign every commit and posted
comment exactly as the identity resolved for your own model tier and role —
never as another tier, another name, or the operator. That resolved identity
is authoritative: if the model actually doing the work differs from the one a
brief named, run `arcadia identity resolve` for that model instead of
inventing or reusing a name.

The roster is data in `src/codingAgents/agentIdentity.ts`; print it with
`arcadia identity roster`. A name is the platform's given name plus the tier
surname, with a `Critic` title for the critic role, at a matching
`<name.in.dots>@agents.arcadia.local` address:

| Platform | Given name | light / standard / heavy |
| --- | --- | --- |
| codex | Cody | Swift / Mason / Atlas |
| claude | Claudia | Swift / Mason / Atlas |
| opencode | Owen | Swift / Mason / Atlas |

Teammates are the other platforms in this roster; partners are the agents
holding live Sessions or claims on the same Project. The operator is the human
principal, not a teammate: never sign as the operator, and the operator never
signs as an agent. Every prompt and brief Arcadia generates carries one
Identity block stating your signature, your teammates and, when the Session
and claim rows can be read, your current partners; `arcadia identity resolve`
prints the same block.

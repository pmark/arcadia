# Detailed Way guidance: native-app sessions

Read this procedure before running a session the operator opened directly in a
native coding-agent app. The compact bootstrap and CONSTITUTION.md still bind.
This playbook grants no new authority; every gate it names lives in the cited file.

## 1. What it is: a simulation of the unattended run

A native-app session is one the operator starts in the Claude Code iOS or Mac
app, the Codex app or the OpenCode app instead of through Arcadia's launcher.
It behaves exactly as an unattended Lead would; only the transport differs.
Anything the session needs that an unattended run could not have (a typed
answer, a host step, a pasted log) is a gap: record it as friction (section 7).

## 2. Roles and supervision

Canonical roles, defaults and dispatch: [session-roles-and-briefs.md](session-roles-and-briefs.md),
`config/defaults/agent-roles.json` (`arcadia roles --json`) and
[arcadia-role](../../.agents/skills/arcadia-role/SKILL.md). Read them before launch;
use the installed skill in adopting Projects. Historical Driver/Reviewer names
are descriptions, not additional role IDs.

- **Lead** = the top-level app Session, depth 0. Owns one Action or direct
  request and its gates. This native-app convention keeps the Lead from writing
  product code; the implementer (historical Driver) is the sole code writer.
  Decision 0112 permits routine Lead development outside this scoped convention.
- **Implementer** = the sole writer when the Lead delegates implementation.
  The Lead pauses edits, supervises its budget and hand-back, and preserves its
  candidate on replacement. Other native delegate roles are planner,
  plan-critic and researcher; each is depth 1 and cannot delegate further.
- **Code-reviewer / QA** = separate independent Sessions under Decision 0114
  and `pull-requests.md`, never native children. Plan critique uses plan-critic
  independently of the planner whose output it judges.
- **Replayer** = a deterministic script; no model. Observer automation is
  deferred, not a registered role. Supervision is an assigned relationship.
- **Operator** = the decider through the existing cards and approval gates.

Native delegation needs explicit operator or existing launch authorization.
Prepare with `arcadia role brief --role <id> --agent <agent> --tier <tier>
--requested-by lead --depth 0`, then pass the complete result and bounded
assignment to the existing Codex `spawn_agent` or Claude `Agent`. Require the
child to read arcadia-role, declare role/depth and return help requests to the
Lead. The command validates supplied labels only; actual lineage, launch and
host authorization need separate evidence. Missing tools/skills stop dispatch
with a preserved assignment. Governed capacity admission remains unavailable;
native dispatch is not a broker, enrollment or slot reservation.

The existing PR procedure permits a fresh read-only reviewer context (including a
sandboxed reviewer or subagent) for generic current-head verification. This is
not admission to the registered code-reviewer or qa role and proves no governed
attempt lineage. Requests for those registered roles still require separate
independent Sessions under Decision 0114; native role dispatch refuses them.

## 3. Start protocol

1. Name the app and surface (iOS thin client, Mac with host) in the first reply.
2. Resolve identity per `git-identity.md` for this app and tier.
3. Bounded reads: `PROJECT.md` pointer, the active Plan's `current_action`,
   open blockers on /todo, the last three rows of the ledger
   (`readSessionLedger`: `docs/reports/session-ledger.jsonl`, then `session-ledger/*.json`), and a targeted `rg` of
   `docs/notes-to-self.md`.
4. State the budget and each role's model and effort before launching anything.
5. Classify the request: the governed current Action (`continuation.md`),
   operator-directed work (`operator-directed-work.md`: Issue + PR, no fake
   Action), or a question (answer it; do not start work).

## 4. The working loop

brief -> implementer (when needed) -> deterministic checks -> separate independent review Session -> repair -> merge or card.

- Brief with the template in `session-roles-and-briefs.md`; name the branch.
- Deterministic checks first: focused tests, eslint on touched files,
  `node scripts/fast-rehearsal.mjs` when relevant. Driver test counts are not evidence.
- Review and merge per `pull-requests.md` (Decision 0060/0080). A PR that
  carries a Decision, changes authority or moves the active Plan waits for the
  operator as a `merge` card.
- Settlement is an Agent Ask (`agent-asks.md`); never hand-edit pointers.
- Ping only when the operator must act: one `arcadia ping --kind attention
  --link <card>` per needed action (Decision 0084, read-only). Never ask the
  operator to type a command, path or value.

## 5. Per-app notes

| App | Known | Unknown / verify |
|---|---|---|
| Claude Code iOS | Thin client: no host for the operator. Remote surfaces only; short replies, no logs; the session can pause between turns. | Whether subagents and worktrees run in the paired environment; verify before launching a Driver. |
| Claude Code Mac | Host access under a per-command sandbox. Sandboxed shells block `mise`/`pnpm`: use `node_modules/.bin/*`; `gh`, `git push` and the `arcadia` CLI need the sandbox disabled per command. Subagents in worktrees; run `node scripts/bridge-worktree-deps.mjs` first. CI auto-fix monitor events arrive as messages: act on them, do not poll. | None recorded. |
| Codex app | Worktrees; sandbox limits writes outside them. Run the in-Session environment probe before claiming a write path works. | Subagent support and spend meter in the app; Decision 0123 (attended first run) applies. |
| OpenCode app | Identity resolves with `--agent opencode`. | No allowance probe exists (`docs/managed-production-readiness.md`): spend headroom is unknown; say so. |

Known pitfalls in every app: Drivers must create the named branch and lint
touched files; settle commits are authored as the operator and must be
re-authored with the resolved identity before the PR.

## 6. Operator communication contract

- A ping says the exact click, its consequence and the link; detail lives in the PR.
- Batch: one ping per distinct action; group same-surface cards into one message.
- Where a default-and-veto rule exists for a card kind, state the default, the
  deadline and how to veto. None exists yet; do not invent one.
- End every stop with a PR or a numbered picker (`continuation.md`, "Before you
  stop"): each option states its consequence, the next model/effort, and
  whether to end the session and open the next with `arcadia go`.

## 7. Close-out

- Add one ledger row as a new file `docs/reports/session-ledger/<YYYYMMDDTHHMMZ>-<session_id>.json`; `null` for anything unmeasured.
- Record each friction as `docs/reports/frictions/<YYYYMMDD>-<slug>.md`; hand-off updates go in `docs/reports/handoffs/`.
  A friction is not closed until it names a test or rule id.
- Retitle on every state change; verify the claim first.
- Hand off: the next session starts with `arcadia go`, not a named task.

## 8. Flexibility and refusal

- **Ad-hoc requests** run the same loop: Issue + PR + fresh Reviewer
  (`operator-directed-work.md`). Large or unclear requests go to planning first.
- **Refuse to proceed** (stop with a card, not a workaround) on authority
  changes, credentials, Grants, spend or cap changes, deploy, publish, delete
  or messaging beyond standing pings.

### Progression ladder

Tighten this playbook as the ladder in
`docs/strategy/autonomous-production-strategy.md` advances:

- **L1, cards:** every operator touch in a native session is a decision card;
  zero host touches, zero copy/paste. A chat answer counts as a defect.
- **L2, policies:** routine merges and settlements run under approved
  delegation policies; native sessions ping only for authority-related cards.
- **L3, handoff:** select, preflight, activate and close-out are scripts; the
  native Lead only briefs Drivers and Reviewers and reads the close-out.
- **L4, stretch:** orchestration is a script; a native session is only an
  observation window on an unattended run, and the app is no longer a Lead.

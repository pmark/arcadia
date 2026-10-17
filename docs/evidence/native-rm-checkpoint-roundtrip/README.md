# native-rm-checkpoint-roundtrip: partial evidence and blockers (2026-10-17)

Plan: `docs/plans/enable-bounded-local-native-release-manager-coordination-with-durable-addressed.md`,
Action `native-rm-checkpoint-roundtrip` (current, open). Base revision `4ac57593d`.
Produced by a Release Manager session (Claude Code 2.1.302, cloud container
`claude.ai/code`). **This is partial evidence. The Action is not complete and
was not settled.** The three adapter Actions stay blocked on it.

## Environment observed (LOCAL ONLY: cloud container, not the operator host)

| Item | Observed |
|---|---|
| Claude Code | `2.1.302`, `claude auth status`: loggedIn, `oauth_token`, firstParty |
| Codex CLI | not installed (`codex: command not found`); `@openai/codex@0.163.0` exists on npm; no OpenAI credential present |
| OpenCode CLI | not installed; `opencode-ai@1.19.3` exists on npm; no provider configuration present |
| Arcadia workspace | `arcadia workspace resolve --json` → `source: missing`, `workspacePath: null`; the live `martianrover` workspace is on the operator host |
| `arcadia work monitor --no-pull-requests` | refused: workspace not configured |

## Per-criterion status

| # | Criterion (short) | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Bridge + two isolated native managers reach the same configured workspace | **externally blocked** | No configured workspace in this container. Experiment workspaces cannot substitute: `src/workspace/experimentGuard.ts` refuses every native-mail write in them. Needs the operator host with `martianrover`. |
| 2 | Nonce → ack → transform → reply across fresh Claude and Codex managers, plus wrong-Plan/changed-replay/closed/stale cases | **externally blocked** | Same workspace blocker, and Codex is absent here. Synthetic CLI coverage of the refusal cases already exists in `tests/native-mail.test.ts` (53/53 with the two guidance test files, run in this session at base `4ac57593d` plus this diff; no log is committed). That is synthetic and is **not** native process proof. |
| 3 | One indexed checkpoint instruction | **proven (source only)** | `docs/agent-guidance/native-mail-checkpoints.md`, indexed as `native-mail-checkpoints` in `docs/agent-guidance/index.json`; `pnpm check:agent-guidance` exit 0 with no problems for codex, claude and opencode. Not installed anywhere. |
| 4 | Roundtrip transcripts, receipts, unchanged state, leak check | **externally blocked** | Depends on 1–2. A leak check has no live workspace to compare here. The measurement transcripts below are retained. |
| 5 | Measured per-provider empty-inbox hook-check token cost | **Claude Code: measured. Codex: blocked. OpenCode: blocked** | See below. No adapter code ships. |

## Criterion 5: Claude Code measurement (measured, not assumed)

Fixture: `claude-code-hook-cost/`. A headless run (`--print --output-format
stream-json --verbose --setting-sources "" --settings <file>`, model `haiku`
→ `claude-haiku-5-5`) is prompted to run one allowed Bash command and then
answer. There are three variants:

- `baseline`: no hooks.
- `empty`: a SessionStart hook and a PostToolUse (`*`) hook that read stdin,
  log that they fired, print **zero bytes** and exit 0. This stands in for the
  empty-inbox branch.
- `control`: the same two hooks, emitting a fixed `additionalContext`
  payload. This is a positive control, proving the instrument detects
  injected context.

Prompt tokens = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
per distinct API request (`summary.json`, reproduced by `summarize.cjs`):

| Run | Hooks fired | Turn-1 prompt | Turn-2 prompt | Turn-2 growth |
|---|---|---|---|---|
| baseline ×3 | 0 | 19050, 19050, 19050 | 19173, 19169, 19169 | 123, 119, 119 |
| empty ×3 | 2 per run (log + stream `hook_response`, `stdout: ""`, exit 0) | 19050, 19050, 19050 | 19169 ×3 | 119 ×3 |
| control ×2 | 2 per run | 19099, 19099 | 19462, 19498 | 363, 399 |

Result: on Claude Code 2.1.302 headless, an empty-output SessionStart plus
PostToolUse hook pair added **no measurable prompt tokens**: identical to the
baseline at session start (19050) and within baseline run-to-run noise (119 vs
119–123) after a tool call. Sample: n=3, one trivial prompt, one model. The positive control added
49 tokens at session start and visibly more after the tool call, so a
non-empty hook is detected. Hook events appear in the stream-json transport
but not in the model's prompt. Total measured spend: about $0.008 (8 runs).

Limits, stated rather than assumed:

- **Headless `--print` only.** The interactive TUI and desktop app were not
  measured. Unverified observation, not in the committed data: the parent
  cloud session showed its own SessionStart hook output to the model as a
  `SessionStart:startup hook success: <stdout>` line. Any hook that prints
  costs tokens; the measured claim is limited to zero-byte output.
- The hook here is a stand-in, not the real two-tier script. The
  `build-claude-code-native-mail-hook` Action must re-verify this against its
  exact built hook (its criterion 1 already requires that).
- The nested run inherited this session's `session_id` (visible in the
  stream). It ran with `--setting-sources ""` in a scratch directory and
  touched no repository or workspace.

## Criterion 5: Codex and OpenCode blockers (precise, per provider)

- **Codex**: blocked. The CLI is not installed in this container and no OpenAI
  credential exists. Installing it without a credential cannot produce a real
  token count, and supplying one is a credential/spend boundary. It needs a
  host where Codex is installed and logged in (the operator host has run
  `codex exec` before; see `docs/notes-to-self.md`). The run must record the
  version, confirm that the installed version actually has SessionStart and
  PostToolUse hooks (never assumed from docs), and repeat the
  baseline/empty/control design. Blocks `build-codex-native-mail-hook` only.
- **OpenCode**: blocked for the same reason (not installed, no provider
  configured). The operator host has OpenCode 1.16.2 configured
  (`docs/agent-guidance/session-roles-and-briefs.md`). Use `opencode run` with
  a plugin on `session.created` / `tool.execute.after` that emits nothing,
  against the same baseline/control. Blocks `build-opencode-native-mail-hook`
  only.

## Findings for the adapter Actions (not acted on)

- **There is no non-mutating existence probe.** `native-mail inbox` is
  classified as a write (`experimentGuard.ts`: it records exposure and a
  receipt), and `native-mail status` needs a `--message-id`. The adapter
  criterion "cheap non-mutating existence probe" has no command today. A
  read-only count command would have to be added first, or the adapter Action
  amended. This is a capability gap to capture as a proposal (see below).

## Not done here, and why

- No Agent Ask, `arcadia learn` capture or settlement: each needs the
  configured workspace, which is missing in this container. On the host,
  capture the existence-probe gap with
  `arcadia agent-ask preview` (`intent: proposal`).
- No adapter dispatch: the adapters depend on this unfinished Action.
- No live roundtrip: needs the operator host, `martianrover`, and an explicit
  live-call/access gate, as the Action title says.

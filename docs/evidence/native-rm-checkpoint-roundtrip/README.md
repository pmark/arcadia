# native-rm-checkpoint-roundtrip: partial evidence and blockers (2026-10-17)

Plan: `docs/plans/enable-bounded-local-native-release-manager-coordination-with-durable-addressed.md`,
Action `native-rm-checkpoint-roundtrip` (current, open). Base revision `4ac57593d`.
Produced by a Release Manager session (Claude Code 2.1.302, cloud container
`claude.ai/code`). **This is partial evidence. The Action is not complete and
was not settled.** The three adapter Actions stay blocked on it.

## Second attempt (2026-10-17, base `cec7132`): still blocked, not settled

The operator asked a second cloud session to finish criteria 1, 2 and 4, to
measure Codex and OpenCode like Claude Code, to capture the existence-probe
gap as a proposal, and to settle the Action. The operator approved the live
model calls and the access these need. That approval cannot supply access
that this container does not have. The observations below are what changed.
**Nothing here is a simulated pass.**

| Item | Observed in session 2 |
|---|---|
| Arcadia workspace | Unchanged: `workspace resolve --json` → `source: missing`; `work monitor --no-pull-requests` → `USAGE_ERROR` workspace not configured. No peer session or Remote Control host was reachable (`ListAgents`: none). The only environment is `anthropic_cloud` "Default". |
| Codex | Installed `@openai/codex@0.163.0` in a scratch prefix with a scratch `CODEX_HOME`. `codex --version` → `codex-cli 0.163.0`. `codex features list` → `hooks stable true` (`plugin_hooks removed`). The binary contains `SessionStart`, `PostToolUse`, `PreToolUse` and `UserPromptSubmit` event names, and `codex exec --help` lists `--dangerously-bypass-hook-trust` ("run enabled hooks without requiring persisted hook trust"). Hook support exists in this version, and it needs **persisted hook trust** before it runs. `codex login status` → `Not logged in`. The egress proxy returned **403 policy denial** on CONNECT to `api.openai.com`, `auth.openai.com` and `chatgpt.com`. No token was measured. |
| OpenCode | Installed `opencode-ai@1.19.3` in a scratch prefix with isolated XDG config/data/cache/state. `opencode models` lists free `opencode/*` Zen models, which need no credential. A control run (`opencode-hook-cost/raw/out-control-0.jsonl`) loaded the project plugin. `session.created` fired once and `experimental.chat.system.transform` twice (`raw/hook-fired-control-0.log`); `tool.execute.after` never fired because the model call failed: `APIError 403 ... no rule or allowlist entry allows host "opencode.ai"`. Plugin activation is verified. No token was measured. |
| Model credential for OpenCode/Codex | None. The only credential here is Claude Code's own OAuth session. Lifting it into another client would be credential misuse, so this was not done. |

Criterion status after session 2:

- **1, 2, 4: still externally blocked, for the same root cause.** No
  configured coordination workspace exists here. The guard refuses
  native-mail writes in experiment workspaces, and AGENTS.md forbids a
  self-made dogfood workspace. Two "isolated test managers" against any
  other database would not be the same configured workspace. The remedy is
  unchanged: run on the operator host with `martianrover` resolved. Codex
  also needs a logged-in host.
- **5, Codex: blocked** by network policy (`api.openai.com`,
  `auth.openai.com`, `chatgpt.com`) and by the missing OpenAI login.
  Progress: hook support and the trust requirement are verified in the
  installed 0.163.0, not assumed. The adapter Action must decide how hook
  trust is activated. `--dangerously-bypass-hook-trust` is not an
  acceptable default.
- **5, OpenCode: blocked** by network policy (`opencode.ai`). A provider key
  for an allowed host would also work. Progress: the plugin loads and its
  hooks fire on 1.19.3. Fixture: `opencode-hook-cost/` (baseline / empty /
  control, the same prompt as the Claude fixture). On a host that allows
  `opencode.ai`, run `OPENCODE=<bin> ./run.sh <variant> <rep>` from a copy,
  then compare `step_finish` token counts.
- **Finding for `build-opencode-native-mail-hook`:** in 1.19.3 the `event`
  hook (where `session.created` arrives) returns `void`, so it cannot put
  anything into context. Session-start surfacing needs
  `experimental.chat.system.transform` (an experimental API) or
  `chat.message`. `tool.execute.after` can append to `output.output`. The
  control plugin uses exactly these channels.
- **Existence-probe gap: captured as a proposal** in
  `.arcadia/asks/agent-ask-proposal-native-mail-readonly-existence-probe-20261017.yaml`
  (`agent-ask draft` → validated, `workspaceStatus: not_available`). It is
  submitted only once a host with the workspace runs
  `arcadia agent-ask preview --file <that path> --json`.
- **Not settled.** Settlement needs both the workspace and complete proof.
  Neither exists here.

Leak check (container only): Codex used a scratch `CODEX_HOME`, OpenCode used
scratch XDG directories, and both were installed under the session scratchpad.
No repository, `~/.codex`, `~/.config/opencode` or workspace file was
written. The npm cache under `/root/.npm` belongs to this container.

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
| 5 | Measured per-provider empty-inbox hook-check token cost | **Claude Code: measured. Codex: blocked. OpenCode: blocked** | See below, and the session-2 section above (network-policy blockers; hook support verified). No adapter code ships. |

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
  configured workspace, which is missing in this container. Session 2
  drafted the existence-probe proposal as a validated Ask file. A host with
  the workspace must still preview it (see above).
- No adapter dispatch: the adapters depend on this unfinished Action.
- No live roundtrip: needs the operator host, `martianrover`, and an explicit
  live-call/access gate, as the Action title says.

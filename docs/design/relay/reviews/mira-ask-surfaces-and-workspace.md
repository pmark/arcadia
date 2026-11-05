# Mira: Ask surfaces and the /workspace fit for Relay

Read-only investigation. Main revision read: `origin/main` at `40e361c26` (fetched 2026-11-03). Proposal read from `origin/claude/relay-proposal-20261103` at `6187334f4` (`docs/proposals/relay.md`). Paths below are on main unless stated.

## Five conclusions

1. **Almost every browser Ask already shares one path.** `/capture`, `/dashboard` and the `/workspace` composer all POST `/api/ask` (or `/api/ingress` when files are attached), which calls `runAsk`, which spawns `arcadia ask ... --source-ingress dashboard.ask --run-safe` (`apps/dashboard/app/api/ask/route.ts:41`, `apps/dashboard/lib/arcadia-cli.ts:1116-1150`, `apps/dashboard/app/capture/page.tsx:36`, `apps/dashboard/app/dashboard/page.tsx:52`, `apps/dashboard/components/workspace/workspace-ask.tsx:120`). Discord and the CLI reach the same `runAskCommand` through the CLI. So "which dashboard page" is a presentation choice, not a backend one.
2. **`/workspace` is shipped but is a scoped single-exchange composer, not a conversation.** It has scope from the URL, a layout-mounted Ask provider, a receipt loop, Go's next move, an Action Continue and an Artifact viewer. It holds one current exchange plus the last five in browser `localStorage`. No thread, no server-side history, and no views cued by what is said.
3. **The earlier "existing Ask surfaces, starting with the dashboard" needs refining to: Relay lands in `/workspace`, and `/capture` and `/dashboard` Ask stop being extended.** The proposal's first slice (compact answers, name matching, "Did you mean" menu, scorecard) is mostly server-side and surface-neutral. It becomes workspace-first only if the answer and menu renderers are built as workspace components over the shared Ask result.
4. **Production control cannot move yet.** `/todo`, `/review` (Decisions), `/actions`, `/production`, `/now` and `/mission-control` post to their own `/api/*` routes that do not go through Ask. The workspace has no Decision-answer or operator-action control. Relay must read these but not replace them in the first slice.
5. **XR readiness is cheap to keep open but not yet true.** Scope parsing and Ask state are separable (`parseWorkspaceScope`, `AskContext`), but the workspace is a 170-line React/CSS view with DOM-bound sky and `localStorage` state. Server-side thread state and a renderer-neutral "view intent" payload are the two cheap things to keep open now.

## 1. Inventory of ways to send input

Legend: **shares runAsk** = reaches `arcadia ask` via `runAsk` or the CLI's `runAskCommand`.

| Surface | Entry point | Path into Ask | Accepts | Shows back | State | Phone | Marked deprecated/preferred | Use signs |
|---|---|---|---|---|---|---|---|---|
| `/workspace` composer | `components/workspace/workspace-ask.tsx` | `POST /api/ask` -> `runAsk` (shares). Direction mode calls `captureOperatorDirection` instead (`app/api/ask/route.ts:29-33`) | Text; Project/Plan/Action scope from navigation (`workspace-ask.tsx:6-8`); no files, no voice | Receipt trail via `GET /api/ask/show`, Artifact viewer, Direction view | Server for the Ask; **browser-local** for draft, target, last 5 exchanges (`storageKey arcadia.workspace.ask.v1`, line 11/72/135) and `?receipt=` in URL | Yes: layout has `max-width:760px` rules and safe-area padding (`workspace.css:46,66,101`) | Design says it is the destination (`docs/design/arcadia-conversational-workspace.md`, "working design draft") | Commits through 2026-10-29 (see section 2); browser tests cited in `docs/design/workspace-ask-receipt-loop.md:31` |
| `/capture` | `app/capture/page.tsx` | `fetch(files.length>0 ? "/api/ingress" : "/api/ask")` (line 36) (shares for text) | Text and files; no Project scope found in the page state | Ask result, feedback buttons, capture envelope, link to `/api/ask/show` (line 140) | Component state only (`useState`, lines 12-22) | Yes, in the mobile nav | In sidebar as "Capture"; no deprecation marker in code | Unknown |
| `/dashboard` ("Full Dashboard") | `app/dashboard/page.tsx` | Same `fetch` choice (line 52) | Text and files | Ask result; also posts `/api/review-action` (line 94) | Component state | Mixed (a dashboard layout) | Sidebar last item | Unknown |
| `/ingress` | `app/ingress/page.tsx` | `GET/POST /api/ingress`, `POST /api/ingress/file` (lines 44, 91, 114) | Folder-based requests and files | Ingress list | Server (the Ingress folder) | Usable | Listed in sidebar | `docs/demo/ingress-findings.md` exists |
| `/momentum` | `app/momentum/page.tsx` | None found. It reads `/api/feedback` and a snapshot | None; display only | Metrics, activity, artifacts, feedback | Server snapshot | Built on `MobileShell` | Not in the sidebar list I read | Unknown |
| `/now` | `app/now/page.tsx` | `/api/now`, `/api/now/gate`; no Ask | Gate answers | Narrated "now" view | Server | Yes | Sidebar | Unknown |
| `/todo` | `app/todo/` | Own routes, no Ask found in my grep | Operator to-do answers | To-do list and items | Server | Yes | Sidebar first item | Unknown |
| `/review` (Decisions) | `app/review/page.tsx:93,142` | `POST /api/review-action` | Decision answers | Decision cards | Server | Yes | Sidebar "Decisions" | Unknown |
| `/actions` | `app/actions/page.tsx` | `/api/operator-script`, `/api/run-action` | Operator-script runs | Script state | Server | Yes | Sidebar "Operator actions" | Unknown |
| `/mission-control` | `app/mission-control/page.tsx:586` | `/api/review-action`, `/api/mission-control/*/reply`, `/effort` | Replies to Sessions; review actions | Sky/timeline | Server | Yes | Sidebar | Unknown |
| `/flight-deck` | `app/flight-deck/page.tsx` | Display only (`buildFlightDeck`) | None | Kanban columns | Server snapshot | Poor for a board | Still in sidebar; I did not verify any supersession in code | Unknown |
| Discord messages | `apps/discord-bot/src/events/messageCreate.ts:27-36` | `cli.ask(request, {sourceIngress:"discord.request"})` (`commands/request.ts:11`) (shares) | Text in the configured channel; reply-to-review and `0132 A` shorthand answer Decisions | Formatted reply, reactions, Ask corrections | Server; message state files | Excellent | Decision 0076 answers Decisions via Discord | `docs/evidence/agent-ask-work-queue-discord-dogfood-2026-09-01.md` |
| Discord slash `/arcadia` | `apps/discord-bot/src/commands/register.ts` | Subcommands `status`, `review`, `request`, `runs`, `codex`... (`requiresReview.ts`) | Typed options | Status and reviews | Server | Excellent | Same | Same |
| CLI `arcadia ask` | `src/cli.ts:964` -> `runAskCommand` | Native (shares by definition) | Text, flags (`--project`, `--request-id`, `--source-ingress`) | Receipt, trail, `ask show/correct/report/coverage` (`cli.ts:992-1056`) | Server | No | Primary for agents | Heavy |
| Apple Share Sheet / Voice Memos / Shortcuts | `docs/APPLE_INGEST.md` | iCloud folder -> `arcadia ingress process` (not the dashboard path) | Text, links, photos, files, Voice Memos | Whatever Ingress shows | Server (folder) | Excellent capture | Described as a recommended architecture | Unknown |
| Agent Asks | `arcadia agent-ask preview` | Separate governed path (`AGENTS.md`, `docs/agent-guidance/agent-asks.md`) | Proposals from agents | Receipt | Server | n/a | Agents only | Heavy |
| Voice / read-aloud | `components/read-aloud.tsx`, `/api/read-aloud`, `/api/pull-requests/audio` | Output only | Output audio; voice **input** only via Voice Memos files | Audio | Server | Good | n/a | Present on PR pages |

Not verified: real-use counts for each page. `arcadia ask report` and `ask coverage` exist (`cli.ts:992,1044`) and are the right way to measure it; I did not run commands.

## 2. /workspace in depth

**Verified shipped (routes and components):**
- Routes: `/workspace/[[...scope]]` (portfolio, Project, Plan, Action by URL), `/workspace/feed`, shared `layout.tsx`. `/workspace/moonlet` appeared only as a scaffold commit (`292c86798`); no `moonlet` route exists on main.
- Layout mounts `WorkspaceBackdrop` (sky), `PresenceMenu`, `WorkspaceAskProvider`, `WorkspaceGoProvider`.
- `workspace-view.tsx` (170 lines): breadcrumbs, up-link, Go's next move, Ask, Project/Plan/Action lists, Plan summaries.
- `workspace-ask.tsx`: receipt loop, pinned draft and target across navigation, uncertain-state recovery, retry only after a confirmed missing receipt, direction mode.
- `workspace-next-move.tsx`, `workspace-continue.tsx` (one protected Action Continue), `workspace-action-session.tsx` (open the exact Session), `workspace-artifact-viewer.tsx` (modal for linked images and text, `/api/workspace/artifacts/[id]`).
- Feed (`feed/feed-view.tsx`), presence (`presence/presence-menu.tsx`), sky (`sky/*`) are visual and personal layers.

**Browser-local:** Ask draft, target, last 5 exchanges, `?receipt=` (`workspace-ask.tsx`); Presence custom states (`presence-menu.tsx:19,97`); feed preferences (`feed-view.tsx:22`); sky phase in `sessionStorage` (`sky/controller.ts`). No server thread.

**Designed, not shipped (from the design docs):** the conversation as the primary canvas with views cued by it, a spatial hierarchy and "pull back" camera (`docs/design/arcadia-conversational-workspace.md:47-51`, marked "working design draft"), Downlink Stage lift/dock (`docs/design/downlink.md`, prototype in `docs/design/prototypes/downlink.html`), operator moonlet (`operator-presence.md`). Design concepts are explicitly "not screenshots of shipped features" (line 7).

**Recent commits touching it (newest first):** `d08201e2c` 2026-10-29 open exact Sessions; `12c2fb4ff` 2026-10-29 Continue feedback; `28ca8e107` 2026-10-28 change-aware cache; `0193492e4` 2026-10-28 protected Continue; `7d690f6ac` 2026-10-27 Plan summaries; `bf9ca82bd` 2026-10-27 direction receipts. Activity stopped 2026-10-29, before the Relay work.

**Open Plan/Issue about it:** I found no Plan under `docs/plans/` dedicated to Relay-in-workspace. The active Plan on main is the production-unattended Plan (`PROJECT.md:10`). I did not query GitHub Issues (no web/CLI use allowed here).

## 3. Fit with the vision

| Capability | Rating | Evidence |
|---|---|---|
| Conversation thread | **partial** | One exchange plus 5-item local history; each Ask is a request/receipt pair, not a thread (`workspace-ask.tsx:10,29-34`) |
| Views/controls cued by conversation | **missing** | Views are fixed regions (`workspace-view.tsx:139-163`); nothing renders in response to an Ask result beyond the receipt and Artifact modal |
| Scope from navigation | **exists** | URL scope parse, Ask target derived from it (`workspace-view.tsx:95,153`; design doc line 57) |
| Cross-device continuity | **partial** | Receipts and Asks are server-side and openable by `?receipt=`; draft/history are per-browser |
| Responsive phone to multi-monitor | **partial** | Breakpoints at 760 and 1100 px with a three-area grid; no wide multi-pane layout, no tested tablet/ultra-wide pass found |
| Input beyond text | **missing in workspace** | Text only; files are possible at `/capture`; voice only via Voice Memos files; read-aloud is output |
| Spatial/XR readiness | **missing, with seams** | Scope parser and Ask provider are UI-independent; sky is DOM/CSS; no 3D/WebXR code found (grep for WebXR/visionOS/glasses hit only Mission Control "spatial urgency" math, which is renderer-neutral pure functions) |

**What would block XR later:** conversation and receipt state living in browser storage; controls that exist only as DOM widgets with no declarative description; Decision answering and operator actions living in separate full-page apps. **Cheap to keep open now:** persist the thread server-side keyed by request id; return answers as typed data (kind, freshness, options) rather than HTML or formatted strings; keep scope as a URL/path value; keep a "view intent" vocabulary that any renderer can map.

## 4. Convergence options

| Surface | Option | Consequence |
|---|---|---|
| `/workspace` | Absorb and become the Relay surface | Needs server thread and answer/menu components; production control still elsewhere |
| `/capture`, Ask panel on `/dashboard` | Retire as Ask entry points after the workspace gains attachments | Removes duplicate renderers of "Status shown."; `/capture` is the only browser path with files today, so file upload must come first |
| `/ingress` | Keep as thin channel (folder intake and inspection) | Apple Share Sheet and Voice Memos depend on it |
| Discord | Keep as thin channel with the same typed answers and menus | Proposal already scopes it; phone-first today |
| CLI / Agent Asks | Keep unchanged | Agents depend on them; Relay must not touch Agent Asks (governance) |
| `/todo`, `/review`, `/actions`, `/production`, `/now`, `/mission-control` | **Must stay** until the workspace can answer Decisions and run operator scripts under the same gates | Absorbing them is a later slice and an authority-sensitive one |
| `/flight-deck`, `/momentum`, `/work-queue`, `/journey`, `/path`, `/reports`, `/clock`, `/qa` | Candidates to be reached from Relay as cued views; retirement is an operator decision | I found no in-code deprecation marker; usage unknown |

**Operator decisions flagged:** (a) whether `/capture` and the dashboard Ask panel are retired or merely frozen; (b) whether Decision answering moves into Relay (it touches authority, so it needs a Decision); (c) which of the display pages are retired versus cued views.

## 5. Conflicts with the proposal

From `docs/proposals/relay.md` on the proposal branch (section "The proposed first slice", lines 86-112; Decision 4 refined at 197-199; question 4 at 207):
- Item 1 says "the dashboard and Discord show only 'Status shown.'" The dashboard has at least three renderers of Ask results (`capture`, `dashboard`, workspace receipt). The first slice should add the answer renderer to `/workspace` first, as a typed answer component, and leave the other two unextended (or have them link to the workspace receipt).
- Item 3 (menu with ID and fingerprint) needs a server-side home for the menu state. Workspace state today is browser-local; menu IDs and taps must be server records (the proposal already says taps are recorded) so a phone and a laptop agree. A tap must reuse the workspace's existing request-id and receipt-loop idempotency.
- Question 4's recommendation "existing Ask surfaces, starting with the dashboard" should read "`/workspace`, with Discord as the thin channel", consistent with line 197.
- The workspace has no file or voice input, so the first slice should not claim parity with `/capture`.
- Items 1-2 are surface-neutral and need no change. The scorecard (item 4) sits in the existing Ask report, also neutral.

## Verified versus inferred

Verified in code: all `path:line` items above, route lists, shared `runAsk` path, local storage keys, sidebar entries, recent commits. Inferred: phone suitability from CSS rules and layout shells (no devices exercised), absence of a Relay Plan (searched file names in `docs/plans` only), "unknown" use (no ask-report run), XR blockers.

## Limits

About 20 tool calls, no tests, no web, no `arcadia` commands, no GitHub Issue query. I did not read `docs/design/operator-presence.md`, `conversational-ui-shell.md` or `workspace-artifact-opening.md` beyond status greps, nor the full sizes of `workspace-next-move.tsx`, `workspace-continue.tsx`, `workspace-action-session.tsx` and the feed/sky code. I did not read `.agents/skills/arcadia-release-investigator/SKILL.md` (budget). Nothing was edited, committed or posted.

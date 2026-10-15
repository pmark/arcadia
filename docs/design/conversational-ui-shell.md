# Conversational workspace shell

Operator-directed scaffold for [Issue 1426](https://github.com/pmark/arcadia/issues/1426).
No governed Action exists for this request. The existing active Plan, Action,
queue and authority rules are unchanged.

## Run and navigate

Run `pnpm dashboard` and open `http://127.0.0.1:3020/workspace` locally.
The ordinary dashboard routes and landing page retain their existing behavior.
The isolated QA test chooses its own localhost port; this document does not
claim that a shared preview or phone-reachable service has been launched.

- `/workspace`: portfolio of real Projects from `GET /api/plans`.
- `/workspace/projects/<project-slug>`: that Project's Plans.
- `/workspace/projects/<project-slug>/plans/<plan-slug>`: its recorded Actions.
- `/workspace/projects/<project-slug>/plans/<plan-slug>/actions/<action-id>`: Action context.

Links encode each identifier. Breadcrumbs and an explicit up link preserve the
hierarchy. Browser Back/Forward and direct URLs select the same context.
Malformed addresses and unknown records have a recovery link; read errors have
Refresh; empty records say what is absent. No writes or new schema are involved.
Some ungoverned Plans cannot be read by the existing detail API; their refusal
is displayed rather than inventing Action records.

## File seams

`app/workspace/layout.tsx` persists the sky and wordmark across context changes.
`components/workspace/workspace-view.tsx` owns read-only context loading, the
conversation extension region, History disclosure and results/preview region.
Add real Ask receipt cards and contextual previews there as bounded components.
`lib/workspace-scope.ts` owns the URL contract; it grants no Ask routing semantics.
`app/workspace/workspace.css` scopes all foreground and sky CSS to this surface.

There is no composer. Conversation capture, saved history, attachments and
Artifact previews are explicitly not connected. The next feature must connect
real Ask submission, receipts, references, status and recovery before offering
an active input; selected context is not yet an Ask API destination field.
No fabricated conversation, work state or authority is shown.

## Sky provenance and adaptation

Source: `pmark/mission-control-site` at
`c0347d93c964e50779ebb44b16e690642d857ebd` (read-only local source inspection).
The source footer identifies MPL 2.0; original source comments are retained.

- `components/workspace/sky/sol-phase.ts` and `sky-scroll.ts` are verbatim copies.
- `sky/controller.ts` retains Backdrop.astro's drawing routines, constants,
  seeded stars, colors, storage keys, 250ms publishing, display-rate rAF,
  hidden-tab behavior, debounce, and reduced-motion behavior.
- React supplies canvas refs and a workspace element instead of global queries.
  Cleanup cancels rAF, interval and debounce, removes all event listeners and
  disconnects the theme observer. An unused drawing parameter was removed.
- Saved theme and the five saved sky properties restore on the scoped element
  before renderer initialization. The source fallback gradients and fixed
  canvas positioning are scoped here. The global dashboard theme is untouched.
- The persistent layout prevents entity navigation from restarting the renderer.
  Document scrolling drives the original parallax; a future nested conversation
  scroll can use the preserved tiny `skyScroll` bridge.

Ground is not included. Exact source screenshot pixel parity, real-phone frame
cadence/CPU, blocked-storage and full StrictMode resource accounting remain
unverified. The integration preserves the renderer source; it does not claim
measured live-site equivalence.

## QA

Focused URL tests live in `apps/dashboard/lib/workspace-scope.test.ts`.
`tests/e2e/workspace-shell.spec.ts` runs a dedicated Next preview with intercepted
fixture APIs, an unconfigured temporary workspace and no live portfolio data.
It checks hierarchy navigation, persistence of the same sky canvas, deep-link
reload, Back/Forward, 390px and desktop overflow, explicit missing/error/empty
states, History and the absence of a fake input.

Phone and desktop screenshots in `assets/arcadia-conversational-workspace/`
are one-time viewport captures of fixture Moon garden records at 390×844 and 1440×900, a fixed browser clock,
`#dusk`, and reduced motion. They are implementation QA, not source-parity proof. Routine test captures go to
ignored test-results with attachments, so reruns do not dirty those assets.

Operator/end-user QA: start the dashboard, open `/workspace`, select a Project,
Plan and Action; check the breadcrumb and recorded status. Use Up, Back, Forward
and reload. Open History and inspect the clearly labeled future conversation
and result surfaces. Repeat at a narrow viewport and tab through ordinary links.
No Ask submission or operator approval is performed by this flow.

## Validation and assignment evidence

The operator explicitly requested an agent with appropriate role/model/effort. The native depth-one implementer was requested as `gpt-6.1-sol`, medium reasoning, sole writer. The standard registry profile resolved to `gpt-5.6-terra`, which this native spawn surface does not offer; the supported workhorse was prepared with its heavy-tier identity and e2_standard effort. No governed Session enrollment or production launch is claimed.

- Parent independently reran URL and Ask regression suites: 37 tests passed across four files, exit 0, 19.27s.
- Parent independently reran the final isolated Playwright navigation test: 1 passed, exit 0, 1.1m. No live portfolio data or shared services were used.
- Implementer repository and dashboard production builds passed; focused ESLint and diff checks passed. Direct standalone dashboard typecheck reported unrelated existing test diagnostics; the production dashboard build passed.
- Parent verified phase and scroll helper Git blobs match the pinned source: 2e577f294190dd2298b092c9e9172bdb4fc15883 and d29019aa5e26a2ab0ebb7b1c306bf91a2270690a.
- Root source discovery, role preparation and work monitor preceded edits. Main checkout design files and the source site were left untouched by the implementer.

Loaded guidance includes AGENTS.md, CONSTITUTION.md, PROJECT.md/current Action, context policy/index, arcadia-role/guardrail, operator-directed-work, session-roles-and-briefs, native-app-sessions, working-copy safety, learning/Notes To Self, PR/identity procedures and model-selection. Source and integration sections were retrieved in bounded reads. This record is implementation evidence, not acceptance of the later Ask feature or proof of visual parity.

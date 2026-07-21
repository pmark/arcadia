# Phase 2 — Admin Page

> Depends on Phase 1 schemas ([01](./01-phase-1-bounded-loop-primitive.md)).
> Specification only — not implemented.

## Scope

A Loop view in the dashboard: list Loops, watch one Loop's iterations live
(image thumbnails + evaluation rationale), submit feedback, and stop/accept. Per
conflict **C8/Q8**, this **extends the existing** `/admin/intelligence` surface
rather than standing up a new page.

## Non-goals

- No new persistence or state machine (Phase 1 owns them; this is read + a few
  write actions).
- No direct DB access from Next.js server code beyond the existing pattern (API
  routes shell out to the CLI).
- No Asset/R2 UI (Phase 3).

## Reuse vs. add

**Reuse as-is:**
- The existing admin surface: [app/admin/intelligence/page.tsx](../../../apps/dashboard/app/admin/intelligence/page.tsx)
  with `RequestForm`, `JobPanel`, `RecentHistory`, `UsageSummary`, and the hooks
  `use-intelligence-*`.
- The API-route → CLI pattern: routes under
  [app/api/admin-intelligence/](../../../apps/dashboard/app/api/admin-intelligence)
  call `lib/arcadia-cli` (`export const runtime = "nodejs"`,
  `dynamic = "force-dynamic"`), returning `ArcadiaCliError` on failure.
- The image byte endpoint pattern
  ([app/api/admin-intelligence/artifacts/[id]/route.ts](../../../apps/dashboard/app/api/admin-intelligence/artifacts/[id]/route.ts))
  for rendering iteration images.
- Polling hooks (`use-intelligence-job` already polls until terminal).

**Add:**
- CLI commands consumed by the routes: `arcadia playground loop list --json`,
  `… show <id> --json`, `… feedback <id> <text> --source admin --json`,
  `… stop <id> --json`, `… accept <id> --json`.
- API routes: `app/api/admin-playground/loops/route.ts` (list),
  `.../loops/[id]/route.ts` (show, polled), `.../loops/[id]/feedback/route.ts`,
  `.../loops/[id]/stop/route.ts`, `.../loops/[id]/accept/route.ts`.
- A `LoopPanel` component + `use-playground-loop` hook (mirrors
  `use-intelligence-job`'s poll-until-terminal shape).
- A route in the app under `/admin/intelligence` (new tab/section) or
  `/admin/playground`.

## Concrete types

Reuse Phase 1's `PlaygroundLoop` / `PlaygroundLoopIteration`. Dashboard-side:

```ts
// lib/playground-types.ts (mirrors lib/intelligence-types.ts)
export interface LoopListItem {
  id: string;
  prompt: string;
  status: PlaygroundLoopStatus;
  iterationCount: number;
  maxIterations: number;
  updatedAt: string;
}

export interface LoopDetail {
  loop: PlaygroundLoop;
  iterations: Array<PlaygroundLoopIteration & {
    // artifact URIs already resolve to /api/intelligence/artifacts/:id
    imageUris: string[];
  }>;
  feedback: Array<{ id: string; text: string; source: string; createdAt: string }>;
}
```

Each API route returns the CLI's `data` payload directly (as the existing
`admin-intelligence/usage` route does), so the response shapes are owned by the
CLI command, not re-modeled in Next.

## Behavior & states

- **List:** newest-first, status badge per Loop (`running`/`completed`/
  `stopped`/`failed`), iteration count `n/max`.
- **Detail (polled while `running`):** each iteration as a card — image
  thumbnail(s), `iterationIndex`, status, `evaluation.score`/`rationale`, and any
  `error`. Feedback box (POST → feedback route) and Stop/Accept buttons enabled
  only while `status === "running"`. Poll stops when the Loop is terminal
  (reuse the `pollingStopped` idea from `use-intelligence-job`).
- No new server state: the page reflects Phase 1's tables.

## Error handling

Follow the existing admin route pattern exactly: catch `ArcadiaCliError`, return
`{ error, details }` with `statusCode`. UI shows `ErrorState` /`LoadingState`
(existing components). Terminal-loop writes (feedback/stop on a finished loop)
surface the CLI's `PLAYGROUND_LOOP_NOT_RUNNING` message inline; buttons are
already disabled in that state as defense-in-depth.

## Test plan

- **Component (unit):** `LoopPanel` renders iterations, disables Stop/Accept when
  terminal, shows evaluation rationale, and renders the image via the artifact URI.
- **Hook:** `use-playground-loop` polls until terminal then stops; surfaces
  errors.
- **API routes:** given a stubbed `lib/arcadia-cli`, each route returns the CLI
  `data` on success and maps `ArcadiaCliError` to the right status.
- **Playwright e2e** (tests/e2e, excluded from vitest): load `/admin` loop view
  against a seeded temp workspace, assert a completed Loop's iterations and images
  render. (Matches the existing dashboard e2e approach.)

## Open questions (this phase)

- **Q8:** new tab inside `/admin/intelligence`, or a sibling `/admin/playground`
  route? (Recommend a sibling route reached from the intelligence admin nav.)
- Should the admin page be able to **start** a Loop (a create form), or only
  observe/steer? (Starting is arguably a Phase 1 CLI concern first; the form is a
  thin add if desired.)
- Live updates: is polling (reusing the existing hook pattern) acceptable, or is
  a push/SSE channel wanted? Polling recommended — no streaming infra exists and
  `V0_1_SCOPE` explicitly excludes it.

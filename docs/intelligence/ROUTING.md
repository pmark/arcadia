# Arcadia Intelligence Routing

Companion apps express *what they need*, never *which model serves it*.

## `operationId` vs `capability`

A request carries two distinct identity fields — do not confuse them:

- **`operationId`** — the *companion app's own* identifier for this
  workflow, e.g. `"rebuster.generate-strict-spec"`. Arcadia never interprets
  its domain meaning and **never routes on it**. It exists purely for the
  caller's own provenance, logging, and prompt/template selection. Stored
  as-is in the job record.
- **`capability`** — Arcadia's *routing* operation class, e.g.
  `"text.generate"`. This, together with `execution` and `profile`, is what
  Arcadia resolves to exactly one configured LiteLLM route.

A companion app typically owns many `operationId` values (one per distinct
workflow/prompt) that all map onto the same handful of `capability` values.

## Routing fields

A request carries three routing fields, plus the existing
`executionPolicy.allowPaidUsage` gate:

- **`capability`** — the operation needed: `text.generate`, `text.classify`,
  `text.extract`, `text.reason`, `vision.analyze`, `image.generate`,
  `image.edit`, `audio.transcribe`, `audio.synthesize`, `video.generate`.
  Only `text.generate` and `image.generate` have a default route configured
  today; the rest are typed for forward-compatibility and resolve as a typed
  `route_not_configured` failure until a transport and registry entry exist.
- **`execution`** — where the request is allowed/preferred to run:
  - `local-required`: only a local route may resolve.
  - `local-preferred`: use local when configured and available; **never**
    silently escalate to cloud. A missing local route is a typed failure,
    not an automatic cloud fallback. This guarantees the request either runs
    locally or fails clearly — it never spends money on the companion app's
    behalf.
  - `cloud-required`: only a cloud route may resolve.
- **`profile`** — the optimization target: `economy`, `fast`, `standard`,
  `quality`. Arcadia resolves this deterministically; it never
  auto-upgrades or auto-downgrades a profile. Not every profile is
  configured for every capability/location — see the route matrix below.

`executionPolicy.allowPaidUsage` is an authorization gate, not a routing
preference — a route configured with `requiresPaidUsage: true` cannot
resolve unless this is `true`, regardless of `execution`/`profile`. This is
how paid (cloud) usage is authorized: explicitly, per request, by the
companion app, never inferred or escalated by Arcadia.

Arcadia resolves every accepted request to exactly **one** configured
execution route (see `src/intelligence/routing/resolveRoute.ts`). Companion
apps never name a LiteLLM route, Codex command, provider, model, or executor
directly — the registry mapping from semantic route to executor detail is
entirely internal and can change without companion apps noticing.

## The default route matrix

A configured route means: *this exact (capability, location, profile)
combination is intentionally supported, has an executable transport, and is
tested today* — not "this alias could theoretically also serve this
profile." The default registry (`buildDefaultRoutes` in
`src/intelligence/config/defaults.ts`) only ever produces:

| Route ID                                   | Capability       | Location | Profile  | Paid usage required |
| ------------------------------------------- | ---------------- | -------- | -------- | -------------------- |
| `arcadia.text.generate.local.fast`          | `text.generate`  | local    | fast     | no                    |
| `arcadia.text.generate.local.standard`      | `text.generate`  | local    | standard | no                    |
| `arcadia.text.generate.cloud.fast`          | `text.generate`  | cloud    | fast     | yes                   |
| `arcadia.text.generate.cloud.standard`      | `text.generate`  | cloud    | standard | yes                   |
| `arcadia.text.generate.cloud.quality`       | `text.generate`  | cloud    | quality  | yes                   |
| `arcadia.image.generate.local.quality`      | `image.generate` | local    | quality  | no                    |
| `arcadia.image.generate.cloud.quality`      | `image.generate` | cloud    | quality  | yes                   |

Every other (capability, location, profile) combination — `text.generate`
local/cloud `economy`, any image profile other than `quality`,
`text.classify`/`text.extract`/`text.reason`, `vision.analyze`,
`image.edit`, audio, video — is a **valid enum value with no configured
route**. Requesting one resolves as a typed `route_not_configured` (or
`*_route_unavailable`) failure rather than guessing a route name or falling
back to a different combination. Expanding this matrix is a deliberate
per-route decision (new config + an executable transport + a test), not a
side effect of adding an enum value or an environment alias.

## No automatic fallback

If resolution fails — capability not configured, route disabled, paid usage
not authorized, or the requested location unavailable — the job is marked
`blocked` with a typed error code:

- `ROUTE_NOT_CONFIGURED`
- `ROUTE_DISABLED`
- `PAID_USAGE_NOT_ALLOWED`
- `LOCAL_ROUTE_UNAVAILABLE`
- `CLOUD_ROUTE_UNAVAILABLE`

These codes, and the `message` alongside them, never include a provider,
model, or LiteLLM alias name — only semantic route IDs and capability/
execution/profile values.

Arcadia never picks a different location or profile on the companion app's
behalf. A blocked `local-preferred` job that has no local route configured
stays blocked — it does not run against cloud. The companion app can resolve
this by deliberately resubmitting with `execution: "cloud-required"` once it
has decided that's acceptable (for example, presenting the user with a
separate, explicit "use cloud generation" action).

## Handling a typed failure

A companion app gets two kinds of typed failure, both without ever seeing a
provider/model/LiteLLM detail:

1. **Synchronous 400** from `POST /api/intelligence/jobs` (or the client's
   `submit()` throwing) when the request shape itself is invalid — missing
   required fields, an unsupported `capability`/`execution`/`profile` enum
   value, or an unsupported `requirements` combination (see below).
2. **A `blocked` or `failed` terminal job status**, discovered via
   `getJob`/`waitForCompletion`, when the request shape was valid but could
   not run — route resolution failed (`job.error.code` is one of the five
   route codes above), LiteLLM was unreachable (`LITELLM_UNAVAILABLE`),
   Codex CLI was unavailable (`CODEX_CLI_UNAVAILABLE`), Codex image output
   was invalid (`CODEX_*` failure codes), or the result failed schema
   validation (`VALIDATION_FAILED`).

In both cases, `error.message`/the thrown error's message is safe to log or
show to a developer; it never contains a route alias or provider name.

## Requirements

`requirements` is an optional, narrow set of fields Arcadia validates and
honors today — not a generic capability-negotiation system:

| Field                  | Supported values | Applies to                       |
| ----------------------- | ----------------- | --------------------------------- |
| `structuredOutput`      | `true`            | `text.*` capabilities only         |
| `imageSize`             | `"1024x1024"`     | `image.generate`/`image.edit` only |
| `transparency`          | `false`           | `image.generate`/`image.edit` only |

`structuredOutput: true` is not a second validation mechanism — every
request already supplies `outputContract`, and Arcadia always validates the
result against it. The flag only asserts that the request's `capability`
is one that supports structured output; setting it on an image capability is
rejected.

Any other `requirements` value (an unsupported `imageSize`, `transparency:
true`, `structuredOutput` on an image capability, or any of these fields on
an unsupported capability) is rejected with a typed validation error before
the job is queued — never silently ignored.

## Configuration

The route registry is built from the configured LiteLLM aliases plus an
optional local Codex image route, configured via environment variables
(`src/intelligence/config/defaults.ts`):

| Variable                          | Default            | Used for                                   |
| ---------------------------------- | ------------------- | -------------------------------------------- |
| `ARCADIA_LITELLM_LOCAL_TEXT_ROUTE`  | `arcadia-default`   | `text.generate`, local, fast + standard      |
| `ARCADIA_LITELLM_CLOUD_TEXT_ROUTE`  | *(unset = disabled)* | `text.generate`, cloud, fast + standard + quality |
| `ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE` | *(unset = disabled)* | `image.generate`, cloud, quality             |
| `ARCADIA_CODEX_IMAGE_ROUTE`         | *(unset = disabled)* | `image.generate`, local, quality             |
| `ARCADIA_CODEX_CLI_COMMAND`         | `codex`             | Codex CLI executable                         |
| `ARCADIA_CODEX_CLI_ARGS`            | JSON args for `codex exec` | Codex invocation; `{workspace}` is replaced with the isolated job workspace |
| `ARCADIA_CODEX_CLI_TIMEOUT_MS`      | `120000`            | Codex CLI timeout for one image job          |

Leaving an alias unset omits its entries entirely; requests targeting it get
a typed failure rather than a guessed route name.

This stays a small, explicit, in-code registry (`buildDefaultRoutes`) rather
than a generic rules engine or one environment variable per route.

### Example: this repo's current local LiteLLM setup

```sh
ARCADIA_LITELLM_LOCAL_TEXT_ROUTE=arcadia-default   # local text generation
ARCADIA_LITELLM_CLOUD_TEXT_ROUTE=arcadia-cloud      # GPT-4o Mini
ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE=arcadia-image     # GPT Image
ARCADIA_CODEX_IMAGE_ROUTE=codex-cli                 # local Codex image generation
```

With that configuration, here are four representative requests and the route
each resolves to:

| Request (capability / execution / profile)             | Resolves to                                  |
| -------------------------------------------------------- | ---------------------------------------------- |
| `text.generate` / `local-required` / `fast`              | `arcadia.text.generate.local.fast` → `arcadia-default` |
| `text.generate` / `local-preferred` / `standard`          | `arcadia.text.generate.local.standard` → `arcadia-default` |
| `text.generate` / `cloud-required` / `quality` (paid usage allowed) | `arcadia.text.generate.cloud.quality` → `arcadia-cloud` |
| `image.generate` / `local-required` / `quality`           | `arcadia.image.generate.local.quality` → Codex CLI |
| `image.generate` / `cloud-required` / `quality` (paid usage allowed) | `arcadia.image.generate.cloud.quality` → `arcadia-image` |

## What Rebuster should send

See `docs/intelligence/examples/rebuster-example.ts` for the full, runnable
shapes. In short:

- **Idea candidate generation**: `capability: "text.generate"`,
  `execution: "local-preferred"`, `profile: "fast"`,
  `requirements: { structuredOutput: true }`. Resolves to
  `arcadia.text.generate.local.fast` when local is configured; never
  escalates to cloud if it isn't.
- **Strict spec generation**: `capability: "text.generate"`,
  `execution: "cloud-required"`, `profile: "quality"`,
  `requirements: { structuredOutput: true }`,
  `executionPolicy.allowPaidUsage: true`. Resolves to
  `arcadia.text.generate.cloud.quality`; fails with `PAID_USAGE_NOT_ALLOWED`
  if paid usage isn't authorized, never falls back to local or a cheaper
  cloud profile.
- **Image candidate generation, local**: `capability: "image.generate"`,
  `execution: "local-required"` or `"local-preferred"`, `profile:
  "quality"`, `requirements: { imageSize: "1024x1024", transparency:
  false }`, `executionPolicy.allowPaidUsage: false`. Resolves to
  `arcadia.image.generate.local.quality` when `ARCADIA_CODEX_IMAGE_ROUTE`
  is set.
- **Image candidate generation, cloud**: `capability: "image.generate"`,
  `execution: "cloud-required"`, `profile: "quality"`, `requirements:
  { imageSize: "1024x1024", transparency: false }`,
  `executionPolicy.allowPaidUsage: true`. Resolves to
  `arcadia.image.generate.cloud.quality`.

## Migration from the v0.1 single-route shape

Earlier v0.1 builds had a single `defaultLiteLlmRoute` (text) and optional
`defaultLiteLlmImageRoute` (image), and requests carried a free-form
`capability: string` plus optional `modality?: "text" | "image"`. This has
been replaced directly (no compatibility shim, since there were no external
consumers yet):

- `capability: string` → renamed to `operationId` (the companion app's own
  free-form identifier, unrelated to routing; it was briefly called
  `capabilityId` before `capability` gained a formal routing meaning).
- `modality` → removed. Use `capability: "text.generate"` /
  `"image.generate"` instead; Arcadia dispatches transport from the
  capability prefix.
- `executionPolicy.allowedRoutes` → removed (it was vestigial). Routing is
  now `capability` + `execution` + `profile`.
- `ARCADIA_LITELLM_ROUTE` → `ARCADIA_LITELLM_LOCAL_TEXT_ROUTE`.
- `ARCADIA_LITELLM_IMAGE_ROUTE` → `ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE`.
- The default route registry was narrowed from "every text.* capability ×
  every profile, per location" to the explicit route matrix above —
  unconfigured combinations now fail the same way unconfigured capabilities
  always did, instead of silently existing as untested routes.

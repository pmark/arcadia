# Arcadia Intelligence Routing

Companion apps express *what they need*, never *which model serves it*.

A request carries three routing fields, plus the existing
`executionPolicy.allowPaidUsage` gate:

- **`capability`** — the operation needed: `text.generate`, `text.classify`,
  `text.extract`, `text.reason`, `vision.analyze`, `image.generate`,
  `image.edit`, `audio.transcribe`, `audio.synthesize`, `video.generate`.
  Only `text.*` and `image.generate` are wired to an executable transport
  today; the rest are typed for forward-compatibility and resolve as a typed
  `route_not_configured` failure until a transport and registry entry exist.
- **`execution`** — where the request is allowed/preferred to run:
  - `local-required`: only a local route may resolve.
  - `local-preferred`: use local when configured and available; **never**
    silently escalate to cloud. A missing local route is a typed failure,
    not an automatic cloud fallback.
  - `cloud-required`: only a cloud route may resolve.
- **`profile`** — the optimization target: `economy`, `fast`, `standard`,
  `quality`. Arcadia resolves this deterministically; it never
  auto-upgrades or auto-downgrades a profile.

`executionPolicy.allowPaidUsage` is an authorization gate, not a routing
preference — a route configured with `requiresPaidUsage: true` cannot
resolve unless this is `true`, regardless of `execution`/`profile`.

Arcadia resolves every accepted request to exactly **one** configured LiteLLM
route (see `src/intelligence/routing/resolveRoute.ts`). Companion apps never
name a LiteLLM route, provider, or model directly — the registry mapping
from semantic route to LiteLLM alias is entirely internal and can change
(swap providers, rename aliases) without companion apps noticing.

## No automatic fallback

If resolution fails — capability not configured, route disabled, paid usage
not authorized, or the requested location unavailable — the job is marked
`blocked` with a typed error code:

- `ROUTE_NOT_CONFIGURED`
- `ROUTE_DISABLED`
- `PAID_USAGE_NOT_ALLOWED`
- `LOCAL_ROUTE_UNAVAILABLE`
- `CLOUD_ROUTE_UNAVAILABLE`

Arcadia never picks a different location or profile on the companion app's
behalf. A blocked `local-preferred` job that has no local route configured
stays blocked — it does not run against cloud. The companion app can resolve
this by deliberately resubmitting with `execution: "cloud-required"` once it
has decided that's acceptable.

## Configuration

The route registry is built from at most three LiteLLM aliases, configured
via environment variables (`src/intelligence/config/defaults.ts`):

| Variable                          | Default            | Used for                                   |
| ---------------------------------- | ------------------- | ------------------------------------------- |
| `ARCADIA_LITELLM_LOCAL_TEXT_ROUTE`  | `arcadia-default`   | all `text.*` capabilities, local, free      |
| `ARCADIA_LITELLM_CLOUD_TEXT_ROUTE`  | *(unset = disabled)* | all `text.*` capabilities, cloud, paid      |
| `ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE` | *(unset = disabled)* | `image.generate`, cloud, paid               |

Each configured alias is registered for every profile (`economy`, `fast`,
`standard`, `quality`) at that capability set and location — there's only
one model per location in this milestone, so it serves whichever profile is
requested. Leaving a cloud alias unset omits its entries entirely; requests
targeting it get a typed failure rather than a guessed route name.

This stays a small, explicit, in-code registry (`buildDefaultRoutes`) rather
than a generic rules engine or one environment variable per route.

### Example: this repo's current local LiteLLM setup

```sh
ARCADIA_LITELLM_LOCAL_TEXT_ROUTE=arcadia-default   # local text generation
ARCADIA_LITELLM_CLOUD_TEXT_ROUTE=arcadia-cloud      # GPT-4o Mini
ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE=arcadia-image     # GPT Image
```

With that configuration, here are four representative requests and the route
each resolves to:

| Request (capability / execution / profile)             | Resolves to                                  |
| -------------------------------------------------------- | ---------------------------------------------- |
| `text.classify` / `local-required` / `fast`              | `arcadia.text.classify.local.fast` → `arcadia-default` |
| `text.generate` / `local-preferred` / `standard`          | `arcadia.text.generate.local.standard` → `arcadia-default` |
| `text.generate` / `cloud-required` / `quality` (paid usage allowed) | `arcadia.text.generate.cloud.quality` → `arcadia-cloud` |
| `image.generate` / `cloud-required` / `quality` (paid usage allowed) | `arcadia.image.generate.cloud.quality` → `arcadia-image` |

## Migration from the v0.1 single-route shape

Earlier v0.1 builds had a single `defaultLiteLlmRoute` (text) and optional
`defaultLiteLlmImageRoute` (image), and requests carried a free-form
`capability: string` plus optional `modality?: "text" | "image"`. This has
been replaced directly (no compatibility shim, since there were no external
consumers yet):

- `capability: string` → renamed to `capabilityId` (still the companion
  app's own free-form identifier, unrelated to routing).
- `modality` → removed. Use `capability: "text.generate"` /
  `"image.generate"` instead; Arcadia dispatches transport from the
  capability prefix.
- `executionPolicy.allowedRoutes` → removed (it was vestigial). Routing is
  now `capability` + `execution` + `profile`.
- `ARCADIA_LITELLM_ROUTE` → `ARCADIA_LITELLM_LOCAL_TEXT_ROUTE`.
- `ARCADIA_LITELLM_IMAGE_ROUTE` → `ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE`.

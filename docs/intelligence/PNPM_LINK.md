# Linking Arcadia Intelligence into Rebuster (local dev)

Arcadia exposes a stable Node package, `@pmark/arcadia`, with two public
subpaths for companion apps:

- `@pmark/arcadia/intelligence/client` — `ArcadiaIntelligenceClient` and its
  options type.
- `@pmark/arcadia/intelligence/contracts` — the generic request/job/result
  types (`IntelligenceRequest`, `IntelligenceJob`, `OutputContract`,
  `PromptTemplateRef`, `ExecutionPolicy`, `IntelligenceJobStatus`,
  `IntelligenceUsage`, `ValidationResult`, and friends).

No other subpath is exported. The service implementation, worker, SQLite
repository, LiteLLM integration, config loading, and CLI stay private to this
repo and may be refactored freely as long as these two subpaths keep their
shape. Rebuster talks to the running Arcadia Intelligence service over HTTP
through `ArcadiaIntelligenceClient` — it never imports the server.

This is local-only `pnpm link` wiring. Nothing here is published to npm or any
registry, and Rebuster must not depend on a relative filesystem path to this
repo.

## From Arcadia

```sh
pnpm install
pnpm build                 # emits dist/src/intelligence/{client,contracts,types}
# pnpm link --global       # Do NOT run `pnpm link` from here -- deprecated
arcadia intelligence serve # start the local HTTP service Rebuster will call
```

Run `pnpm build` again after any change under `src/intelligence/` before
Rebuster picks it up — the package exports point at `dist/`, not `src/`.

## From Rebuster

```sh
pnpm link /PATH/TO/ARCADIA/ROOT
```

Verify the link resolved to this repo (not a registry copy):

```sh
node -e "console.log(require.resolve('@pmark/arcadia/package.json'))"
# or, in an ESM project:
node -e "import('node:module').then(m=>console.log(m.createRequire(import.meta.url).resolve('@pmark/arcadia/package.json')))"
```

The path it prints should point into your local Arcadia checkout.

In Rebuster's TypeScript code, import only the documented subpaths:

```ts
import { ArcadiaIntelligenceClient } from "@pmark/arcadia/intelligence/client";
import type {
  IntelligenceRequest,
  IntelligenceJob,
} from "@pmark/arcadia/intelligence/contracts";

const client = new ArcadiaIntelligenceClient({
  baseUrl: process.env.ARCADIA_INTELLIGENCE_BASE_URL ?? "http://localhost:4500",
});
```

Configure the base URL through Rebuster's own environment/config, not through
the linked package — `ArcadiaIntelligenceClient` takes `baseUrl` as a
constructor option and has no knowledge of Rebuster's runtime config.

Any other import path (e.g. reaching into
`@pmark/arcadia/intelligence/service` or `dist/src/intelligence/db/...`) is
not part of the contract and will fail to resolve, since Node enforces the
package's `exports` map for both linked and installed dependencies.

## Unlinking

```sh
# In Rebuster
pnpm unlink @pmark/arcadia
pnpm install   # restore whatever Rebuster's own package.json declares, if anything

# In Arcadia
pnpm unlink --global
```

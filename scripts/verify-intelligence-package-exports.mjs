#!/usr/bin/env node
// Verifies the @pmark/arcadia public package boundary: the documented
// subpaths resolve via Node's package "exports" map, and undocumented
// internal paths do not. Run after `pnpm build`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

assert.equal(pkg.name, "@pmark/arcadia", "package name must be stable for linking");

const exportKeys = Object.keys(pkg.exports ?? {});
assert.deepEqual(
  exportKeys.sort(),
  ["./intelligence/client", "./intelligence/contracts"].sort(),
  "exports map must expose only the documented client and contracts subpaths",
);

const clientModule = await import("@pmark/arcadia/intelligence/client");
assert.equal(
  typeof clientModule.ArcadiaIntelligenceClient,
  "function",
  "client subpath must export the ArcadiaIntelligenceClient class",
);

const contractsModule = await import("@pmark/arcadia/intelligence/contracts");
assert.equal(typeof contractsModule, "object", "contracts subpath must resolve");

await assert.rejects(
  () => import("@pmark/arcadia/intelligence/service"),
  "the service implementation must not be importable through the package name",
);

await assert.rejects(
  () => import("@pmark/arcadia/intelligence/db/sqliteRepository"),
  "the sqlite repository must not be importable through the package name",
);

console.log("OK: @pmark/arcadia public package boundary verified.");

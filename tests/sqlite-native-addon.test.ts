import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeError } from "../src/cli/errors.js";
import { openDatabase } from "../src/db/connection.js";
import {
  SqliteNativeAddonAbiError,
  SqliteWorkspaceWriteDeniedError,
  withSqliteNativeAddonPreflight,
  withSqliteWorkspaceWriteDiagnostics
} from "../src/db/nativeAddon.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

describe("SQLite native addon ABI preflight", () => {
  it("turns Node's raw addon-loader mismatch into an actionable error", () => {
    const addonAbi = String(Number(process.versions.modules) - 1);
    const loaderError = new Error(
      `The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION ${addonAbi}. This version of Node.js requires NODE_MODULE_VERSION ${process.versions.modules}.`
    );

    expect(() => withSqliteNativeAddonPreflight(() => {
      throw loaderError;
    })).toThrow(SqliteNativeAddonAbiError);

    try {
      withSqliteNativeAddonPreflight(() => {
        throw loaderError;
      });
    } catch (error) {
      const normalized = normalizeError(error);
      expect(normalized.code).toBe("SQLITE_NATIVE_ABI_MISMATCH");
      expect(normalized.details).toMatchObject({
        runtimeAbi: process.versions.modules,
        addonAbi,
        remediation: "mise install && mise exec -- pnpm rebuild better-sqlite3",
        runtimeExecutable: process.execPath
      });
      expect(normalized.message).toContain(process.execPath);
      expect(normalized.message).toContain("relaunch Arcadia through mise");
    }
  });

  it("preserves non-ABI database errors", () => {
    const original = new Error("unable to open database file");

    expect(() => withSqliteNativeAddonPreflight(() => {
      throw original;
    })).toThrow(original);
  });
});

describe("SQLite workspace write-denial diagnostics", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      try {
        chmodSync(root, 0o755);
      } catch {
        // best-effort: directory may already be writable
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names the exact database file when better-sqlite3 reports SQLITE_READONLY", () => {
    const databaseFile = "/Users/pmark/workspace/database/arcadia.sqlite3";
    const sqliteError = Object.assign(new Error("attempt to write a readonly database"), {
      name: "SqliteError",
      code: "SQLITE_READONLY"
    });

    expect(() => withSqliteWorkspaceWriteDiagnostics(databaseFile, () => {
      throw sqliteError;
    })).toThrow(SqliteWorkspaceWriteDeniedError);

    try {
      withSqliteWorkspaceWriteDiagnostics(databaseFile, () => {
        throw sqliteError;
      });
    } catch (error) {
      const normalized = normalizeError(error);
      expect(normalized.code).toBe("SQLITE_WORKSPACE_WRITE_DENIED");
      expect(normalized.message).toContain(databaseFile);
      expect(normalized.message).toContain("additionalDirectories");
      expect(normalized.details).toMatchObject({ databaseFile });
    }
  });

  it("preserves unrelated database errors instead of misreporting them as write-denials", () => {
    const original = new Error("no such table: projects");

    expect(() => withSqliteWorkspaceWriteDiagnostics("/tmp/does-not-matter.sqlite3", () => {
      throw original;
    })).toThrow(original);
  });

  it("turns a real OS-level permission denial on the workspace directory into a named diagnostic", () => {
    if (process.getuid && process.getuid() === 0) {
      return; // root ignores directory write permissions; this fixture cannot force a denial
    }
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-write-denied-"));
    roots.push(root);
    initWorkspace(root);
    const paths = getWorkspacePaths(root);
    openDatabase(root).close(); // create the database once, while the directory is still writable

    chmodSync(path.dirname(paths.databaseFile), 0o555); // deny writes to the containing directory
    try {
      expect(() => openDatabase(root)).toThrow(SqliteWorkspaceWriteDeniedError);
      try {
        openDatabase(root);
      } catch (error) {
        const normalized = normalizeError(error);
        expect(normalized.code).toBe("SQLITE_WORKSPACE_WRITE_DENIED");
        expect(normalized.message).toContain(paths.databaseFile);
      }
    } finally {
      chmodSync(path.dirname(paths.databaseFile), 0o755);
    }
  });
});

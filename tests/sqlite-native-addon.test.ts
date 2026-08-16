import { describe, expect, it } from "vitest";
import { normalizeError } from "../src/cli/errors.js";
import { SqliteNativeAddonAbiError, withSqliteNativeAddonPreflight } from "../src/db/nativeAddon.js";

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

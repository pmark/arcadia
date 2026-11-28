import { describe, expect, it } from "vitest";

import {
  SqliteNativeAddonAbiError,
  SqliteWorkspaceWriteDeniedError,
  isSqliteNativeAddonAbiError,
  isSqliteWorkspaceWriteDeniedError
} from "../src/db/nativeAddon.js";

describe("isSqliteNativeAddonAbiError", () => {
  it("recognises an ABI mismatch error and names both ABIs", () => {
    const error = new SqliteNativeAddonAbiError("115", "108", "/bin/node");

    expect(isSqliteNativeAddonAbiError(error)).toBe(true);
    expect(error.message).toContain("/bin/node is running Node ABI 115, but better-sqlite3 was built for ABI 108");
  });

  it("rejects a plain Error and null", () => {
    expect(isSqliteNativeAddonAbiError(new Error("boom"))).toBe(false);
    expect(isSqliteNativeAddonAbiError(null)).toBe(false);
  });
});

describe("isSqliteWorkspaceWriteDeniedError", () => {
  it("recognises a write denial and names the database file and cause", () => {
    const error = new SqliteWorkspaceWriteDeniedError("/ws/db.sqlite3", "SQLITE_READONLY");

    expect(isSqliteWorkspaceWriteDeniedError(error)).toBe(true);
    expect(error.message).toContain("SQLite could not write to the workspace database: /ws/db.sqlite3 (SQLITE_READONLY).");
  });

  it("rejects an ABI error and a string", () => {
    expect(isSqliteWorkspaceWriteDeniedError(new SqliteNativeAddonAbiError("115", "108", "/bin/node"))).toBe(false);
    expect(isSqliteWorkspaceWriteDeniedError("x")).toBe(false);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { singleActionPath } from "./actionRedirect";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("singleActionPath", () => {
  const root = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "arcadia-redirect-")); roots.push(dir);
    writeFileSync(path.join(dir, "grant-example.json"), "{}");
    writeFileSync(path.join(dir, "grant-example.sh"), "#!/bin/sh\n");
    return dir;
  };

  it("sends an exact script id to its own page", async () => {
    expect(await singleActionPath("grant-example", root())).toBe("/actions/grant-example");
    expect(await singleActionPath([" grant-example "], root())).toBe("/actions/grant-example");
  });

  it("leaves search words, unknown ids and unsafe values on the list", async () => {
    const dir = root();
    expect(await singleActionPath("grant", dir)).toBeNull();
    expect(await singleActionPath("../grant-example", dir)).toBeNull();
    expect(await singleActionPath("grant example", dir)).toBeNull();
    expect(await singleActionPath(undefined, dir)).toBeNull();
    expect(await singleActionPath("", dir)).toBeNull();
  });
});

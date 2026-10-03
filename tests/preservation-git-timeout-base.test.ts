import { describe, expect, it } from "vitest";
import { fixtureGit } from "../scripts/preservation-fixture.js";
import { expectTypedTimeout, installTimeoutFixtureHooks, mockValidationWithRealGit, timeoutFixture } from "./preservationTimeoutFixture.js";

installTimeoutFixtureHooks();

describe("preservation timeouts after the base advanced", () => {
  it("never reads an ancestry or merge-tree timeout as a rewritten or conflicting base", () => {
    mockValidationWithRealGit();
    const { f, observe, preserve, timeoutAt } = timeoutFixture({ advanceBase: true });
    const before = observe();
    const newBase = fixtureGit(f.repo, ["rev-parse", "main"]);
    for (const [stage, arg] of [
      ["binding.manual", "--is-ancestor"], ["binding.manual", "merge-tree"],
      ["preserve.preconditions", "--is-ancestor"], ["preserve.preconditions", "merge-tree"]
    ] as const) {
      const error = timeoutAt(stage, arg);
      expectTypedTimeout(error, stage, { subcommand: arg === "--is-ancestor" ? "merge-base" : arg, arg, cwds: [f.repo] });
      if (arg === "--is-ancestor") expect(error.details.args).toEqual(["merge-base", "--is-ancestor", f.base, newBase]);
      expect(observe()).toEqual(before);
    }
    expect(preserve().data.receipt.baseRevision).toBe(f.base);
    expect(observe()).toMatchObject({ status: "", lock: false, ahead: "1" });
  }, 120_000);
});

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUN7, git, sandbox, afterRun5, resetEnv, chainG6Replies } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain G6 coherence guard", () => {
  it("refuses a fixture head whose PROJECT.md states another Action count than this run's N, naming file, line and text, while every other check still passes", { timeout: 600_000 }, () => {
    const box = sandbox(RUN7, { clone: true });
    const state = afterRun5(box, { actionCount: 9, runId: RUN7 });
    expect(box.run(box.ids.reset, resetEnv).status).toBe(0);
    // Tamper as a hand edit would: amend the pushed reset commit with the stale outcome and re-point the reset receipt at it, so only the coherence check can notice.
    const goal = readFileSync(path.join(box.fixture, "PROJECT.md"), "utf8");
    writeFileSync(path.join(box.fixture, "PROJECT.md"), goal.replace("Demonstrate nine dependent Actions", "Demonstrate three dependent Actions"));
    git(box.fixture, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "--amend", "-a", "--no-edit"]);
    const tampered = git(box.fixture, ["rev-parse", "HEAD"]);
    const receiptFile = path.join(box.receipt(box.ids.reset).dir, "receipt.json");
    writeFileSync(receiptFile, JSON.stringify({ ...JSON.parse(readFileSync(receiptFile, "utf8")), newHead: tampered, remoteMainAfter: tampered }));
    const head = git(box.checkout, ["rev-parse", "HEAD"]);
    box.setReplies(chainG6Replies(box, state, tampered, head));
    const g6 = box.run(box.ids.preflight);
    expect(g6.status).not.toBe(0);
    const checks = box.receipt(box.ids.preflight).json.checks as Array<{ name: string; status: string; detail: string }>;
    expect(checks.filter((c) => c.status !== "pass").map((c) => c.name)).toEqual(["fixture_coherence"]);
    const detail = checks.find((c) => c.name === "fixture_coherence")!.detail;
    expect(detail).toContain("contradicts itself about the chain's size");
    expect(detail).toContain("PROJECT.md:8: states 3 Actions but this run's chain has 9 (\\\"three dependent Actions\\\"): outcome: Demonstrate three dependent Actions preserved");
  });
});

import { describe, expect, it } from "vitest";
import { chainActionIds, chainQueueKeys } from "../src/operatorActions/rehearsalChain.js";
import { RUN7, type Reply, git, sandbox, type Box, ok, afterRun5, resetEnv, CODEX_ANSWER, liveRead, chainG6Replies } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain G6: the operational queue and a live Codex capacity read (Issues #1015, #1016)", () => {
  const detail = (box: Box, name: string) => box.receipt(box.ids.preflight).json.checks.find((c: { name: string }) => c.name === name) as { status: string; detail: string };
  const queueReply = (data: Record<string, unknown>): Reply => ok({ revision: 7, nextActionKey: null, ordered: [], ...data });
  const failedRead = (...failures: Array<{ kind: string; exitStatus: number | null; detail: string }>) => ({
    ok: false, maxAttempts: 3, deadlineMs: 20_000, attempts: failures.map((failure, i) => ({ attempt: i + 1, ok: false, failure: { signal: null, ...failure } }))
  });

  it("refuses an invalid queue (orderValid false or any unpositioned Action) or an unreadable one, and names the cause; a valid queue and a live capacity read pass", { timeout: 900_000 }, () => {
    const box = sandbox(RUN7, { clone: true });
    const state = afterRun5(box, { actionCount: 9, runId: RUN7 });
    const reset = box.run(box.ids.reset, resetEnv);
    expect(reset.status, reset.stdout + reset.stderr).toBe(0);
    const newHead = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    const head = git(box.checkout, ["rev-parse", "HEAD"]);
    const replies = chainG6Replies(box, state, newHead, head);
    const refusals = (box: Box) => box.receipt(box.ids.preflight).json.checks.filter((c: { status: string }) => c.status !== "pass").map((c: { name: string }) => c.name);

    // Baseline: the real queue the reset left is valid, and a capacity read that answered on its second attempt passes.
    box.setReplies({ ...replies, "arcadia advance queue": { passthrough: "cli" }, "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_review"], liveRead: liveRead(2), codex: { admitted: true, freshness: "fresh", confidence: "observed", usagePolicy: "included", evidence: "real", availability: "available", unattendedProof: "observed" } }) } });
    const ready = box.run(box.ids.preflight);
    expect(ready.status, ready.stdout + ready.stderr).toBe(0);
    expect(detail(box, "action_queue")).toMatchObject({ status: "pass", detail: expect.stringContaining("orderValid true, 0 unpositioned") });
    expect(detail(box, "codex_capacity")).toMatchObject({ status: "pass", detail: expect.stringContaining("read live on attempt 2 of 3") });
    expect(box.receipt(box.ids.preflight).json.actionQueue).toMatchObject({ orderValid: true, unpositionedCount: 0, unpositioned: [] });

    // The queue is not valid: refused whichever way it says so, naming the unpositioned keys.
    for (const data of [
      { orderValid: false, unpositionedCount: 7, ordered: chainQueueKeys(chainActionIds(9)).map((key) => ({ orderKey: key, orderStatus: "unpositioned" })).slice(0, 7) },
      { orderValid: true, unpositionedCount: 1, ordered: [{ orderKey: "three-action-rehearsal/chain-step-09", orderStatus: "unpositioned" }] },
      { orderValid: false, unpositionedCount: 0, ordered: [] }
    ]) {
      box.setReplies({ ...replies, "arcadia advance queue": queueReply(data) });
      expect(box.run(box.ids.preflight).status).not.toBe(0);
      expect(refusals(box)).toEqual(["action_queue"]);
      expect(detail(box, "action_queue").detail).toContain("the Action queue order is invalid");
      expect(detail(box, "action_queue").detail).toContain(`"unpositionedCount":${data.unpositionedCount}`);
    }
    expect(detail(box, "action_queue").detail).toContain("advance queue arrange");
    // A queue that cannot be read, or one without the fields, is not known to be valid.
    for (const reply of [{ status: 1, stderr: "boom" }, { stdout: "{\"ok\":true,\"data\":{}}" }] as Reply[]) {
      box.setReplies({ ...replies, "arcadia advance queue": reply });
      expect(box.run(box.ids.preflight).status).not.toBe(0);
      expect(refusals(box)).toEqual(["action_queue"]);
      expect(detail(box, "action_queue").detail).toContain("could not be read");
    }

    // Issue #1016: when no live read answered, the refusal names each failure and says no cache was judged.
    box.setReplies({ ...replies, "arcadia advance queue": { passthrough: "cli" }, "probe capacity": { stdout: JSON.stringify({
      readOnlyReviewers: ["codex_review"], codex: null,
      liveRead: failedRead({ kind: "timeout", exitStatus: null, detail: "the Codex app-server query did not answer within 20000 ms" }, { kind: "exit", exitStatus: 2, detail: "the Codex app-server query failed with exit status 2: Command failed" }, { kind: "no_response", exitStatus: 0, detail: "exited without answering" })
    }) } });
    expect(box.run(box.ids.preflight).status).not.toBe(0);
    expect(refusals(box)).toEqual(["codex_capacity"]);
    const named = detail(box, "codex_capacity").detail;
    expect(named).toContain("failed on every attempt");
    expect(named).toContain("no cached observation was used");
    expect(named).toContain("attempt 1: timeout: the Codex app-server query did not answer within 20000 ms");
    expect(named).toContain("attempt 2: exit (exit status 2)");
    expect(named).toContain("attempt 3: no_response (exit status 0)");
    // A reading that did answer but is not fresh, included and available is still refused on its own evidence.
    box.setReplies({ ...replies, "arcadia advance queue": { passthrough: "cli" }, "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_review"], liveRead: liveRead(), codex: { admitted: false, freshness: "fresh", confidence: "observed", usagePolicy: "included", evidence: "real", availability: "usage_limited", reason: "weekly window spent" } }) } });
    expect(box.run(box.ids.preflight).status).not.toBe(0);
    expect(refusals(box)).toEqual(["codex_capacity"]);
    expect(detail(box, "codex_capacity").detail).toContain("weekly window spent");
  });

  it("the real probe, with a fake codex app server on PATH: a fresh answer is judged; a failing server is retried and named by exit status", { timeout: 900_000 }, () => {
    const box = sandbox(RUN7, { clone: true });
    const state = afterRun5(box, { actionCount: 9, runId: RUN7 });
    expect(box.run(box.ids.reset, resetEnv).status).toBe(0);
    const newHead = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    const head = git(box.checkout, ["rev-parse", "HEAD"]);
    const real = { ...chainG6Replies(box, state, newHead, head), "arcadia advance queue": { passthrough: "cli" as const }, "probe capacity": { passthrough: "probe" as const } };
    box.setReplies({ ...real, "codex app-server": { stdout: CODEX_ANSWER } });
    const ok = box.run(box.ids.preflight);
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(detail(box, "codex_capacity")).toMatchObject({ status: "pass", detail: expect.stringContaining("included capacity read live on attempt 1 of 3") });
    expect(box.keys().filter((key) => key.startsWith("codex app-server"))).toHaveLength(1);
    // The server fails with exit status 3 on every attempt: three bounded attempts, each named, nothing judged from a cache.
    box.setReplies({ ...real, "codex app-server": { status: 3, stderr: "boom" } });
    const before = box.keys().filter((key) => key.startsWith("codex app-server")).length;
    const failed = box.run(box.ids.preflight);
    expect(failed.status).not.toBe(0);
    expect(box.keys().filter((key) => key.startsWith("codex app-server")).length - before).toBe(3);
    const named = detail(box, "codex_capacity");
    expect(named.status).toBe("refuse");
    expect(named.detail).toContain("failed on every attempt");
    for (const attempt of [1, 2, 3]) expect(named.detail).toContain(`attempt ${attempt}: exit (exit status 3)`);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAdvanceQueueArrangeCommand, runAdvanceQueueCommand } from "../src/commands/advance.js";
import { chainActionIds, chainQueueKeys, chainQueueRequestId } from "../src/operatorActions/rehearsalChain.js";
import { RUN6, RUN7, REPO, A1_BRANCH, A2_BRANCH, type Reply, sandbox, type Box, ok, afterRun5, resetReplies, resetEnv, unchanged } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain reset: stacked candidates and the operational queue (Issues #987, #1015)", () => {
  const miseCalls = (box: Box) => readFileSync(path.join(box.root, "calls.log"), "utf8").split("\n").filter((line) => line.startsWith("mise ")).map((line) => JSON.parse(line.slice(5)) as string[]);
  const arrangeCalls = (box: Box) => miseCalls(box).filter((args) => args.includes("arrange"));
  const after = (args: string[], flag: string) => { const out: string[] = []; for (let i = args.indexOf(flag) + 1; i > 0 && i < args.length && !args[i].startsWith("--"); i++) out.push(args[i]); return out; };
  const queueReply = (keys: string[], extra: Record<string, unknown> = {}): Reply => ok({ revision: 2, orderValid: true, unpositionedCount: 0, nextActionKey: null, ordered: keys.map((key) => ({ orderKey: key, orderStatus: "explicit" })), ...extra });
  const chain3 = chainQueueKeys(chainActionIds(3));
  const stacked = (box: Box, state: { base: string; a1Tip: string; a2Tip: string }, base: unknown, pr = 6) => box.setReplies({
    ...resetReplies(box, state),
    [`gh api repos/${REPO}/pulls/${pr}`]: { stdout: JSON.stringify({ state: "open", head: { ref: pr === 6 ? A2_BRANCH : A1_BRANCH, sha: pr === 6 ? state.a2Tip : state.a1Tip }, ...(base === undefined ? {} : { base: { ref: base } }) }) }
  });

  it("a candidate stacked on a pinned candidate it descends from (run 6's PR #8 on PR #7's branch) passes, and its base is recorded", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    stacked(box, state, A1_BRANCH);
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.stdout).toContain(`#6 ${A2_BRANCH}@${state.a2Tip.slice(0, 8)} (stacked on ${A1_BRANCH})`);
    expect(dry.stdout).toContain(`Step 1: move ONLY the clone's local main from ${state.a1Tip} back to GitHub main ${state.base}`);
    const evidence = readdirSync(box.tmp).filter((d) => d.startsWith("rehearsal-chain-dry-run."));
    const candidates = JSON.parse(readFileSync(path.join(box.tmp, evidence[0], "candidates-before.json"), "utf8"));
    expect(candidates.map((c: { pullRequest: number; prBase: string; stackedOn: string | null }) => [c.pullRequest, c.prBase, c.stackedOn])).toEqual([[5, "main", null], [6, A1_BRANCH, A1_BRANCH]]);
    unchanged(box, state.a1Tip);
  });

  it.each([
    ["a stack on a branch the parameter file does not pin", "claude/not-a-pinned-candidate", 6, "is stacked on claude/not-a-pinned-candidate, which is not a candidate the parameter file pins"],
    ["a pull request whose base cannot be read", undefined, 6, "could not read the base branch of pull request #6"],
    ["a pinned base the candidate does not descend from", A2_BRANCH, 5, "does not descend from it"]
  ])("refuses %s, moving nothing", { timeout: 240_000 }, (_label, base, pr, expected) => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    stacked(box, state, base, pr);
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain(expected);
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "candidates", localMainMoved: false, fixtureCommitted: false });
    expect(box.receipt(box.ids.reset).json.reason).toContain(expected);
    unchanged(box, state.a1Tip);
  });

  it("the dry run reads the queue read-only and names the arrangement it would make after docs sync", { timeout: 240_000 }, () => {
    const box = sandbox(RUN7);
    afterRun5(box, { actionCount: 9, runId: RUN7 });
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/Step 4: position the chain's Actions in the queue \(arcadia advance queue arrange, previewed then applied at the exact revision, refused unless orderValid with 0 unpositioned afterwards\): all 0 other key\(s\) keep their relative order, then three-action-rehearsal\/write-start-marker, /);
    expect(arrangeCalls(box)).toEqual([]);
    expect(box.keys().filter((key) => key.startsWith("arcadia advance queue"))).toEqual([]);
  });

  it("N=9: positions the reopened and created Actions in chain order through the governed arrange (preview, then apply at the exact revision), records the queue receipt, and leaves the queue valid", { timeout: 300_000 }, () => {
    const box = sandbox(RUN7);
    afterRun5(box, { actionCount: 9, runId: RUN7 });
    // An operator-arranged queue whose fixture Actions are positioned in the wrong order: the reset puts them in chain order.
    const before = runAdvanceQueueCommand({ workspace: box.workspace }).data;
    const keys = before.ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
    expect(keys.length).toBeGreaterThan(0);
    runAdvanceQueueArrangeCommand({ workspace: box.workspace, order: [...keys].reverse(), requestId: "pre-position-fixture", revision: before.revision, apply: true });
    const positioned = runAdvanceQueueCommand({ workspace: box.workspace }).data;
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const chain = chainQueueKeys(chainActionIds(9));
    const { json } = box.receipt(box.ids.reset);
    expect(json.queue).toMatchObject({
      state: "arranged", order: chain, othersUnpositioned: [],
      receipt: { applied: true, requestId: chainQueueRequestId(RUN7, positioned.revision), revisionBefore: positioned.revision, revisionAfter: positioned.revision + 1 },
      after: { revision: positioned.revision + 1, orderValid: true, unpositionedCount: 0 }
    });
    expect(json.receipt === undefined && json.queue.receipt.id).toMatch(/^qorder_/);
    // The governed command, twice: the preview first, then --apply, each with every key as its own argument at the exact revision.
    const calls = arrangeCalls(box);
    expect(calls).toHaveLength(2);
    expect(calls.map((args) => args.includes("--apply"))).toEqual([false, true]);
    for (const args of calls) {
      expect(after(args, "--order")).toEqual(chain);
      expect(after(args, "--revision")).toEqual([String(positioned.revision)]);
      expect(after(args, "--request-id")).toEqual([chainQueueRequestId(RUN7, positioned.revision)]);
      expect(after(args, "--workspace")).toEqual([box.workspace]);
    }
    // Read back from the real queue, not inferred from the exit code.
    const queue = runAdvanceQueueCommand({ workspace: box.workspace }).data;
    expect(queue).toMatchObject({ orderValid: true, unpositionedCount: 0 });
    expect(queue.ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : [])).toEqual(chain);
  });

  it.each([
    ["the queue does not list a chain Action docs sync was meant to create", () => ({ "arcadia advance queue": queueReply(chain3.slice(0, 2)) }), "does not list the chain's Actions", 0],
    ["the previewed arrangement is not the planned order", () => ({ "arcadia advance queue": { passthrough: "cli" as const }, "arcadia advance queue arrange": ok({ receipt: { id: "q1", applied: false, revisionBefore: 0, after: ["x"] } }) }), "preview is not the planned order", 1],
    ["the arrange command fails", () => ({ "arcadia advance queue": { passthrough: "cli" as const }, "arcadia advance queue arrange": { status: 1, stderr: "queue revision changed" } }), "arrange preview failed", 1],
    ["the queue is still invalid afterwards (orderValid false, unpositioned Actions)", () => ({
      "arcadia advance queue": [{ passthrough: "cli" as const }, queueReply(chain3, { orderValid: false, unpositionedCount: 2, ordered: chain3.map((key, i) => ({ orderKey: key, orderStatus: i < 2 ? "unpositioned" : "explicit" })) })],
      "arcadia advance queue arrange": { passthrough: "cli" as const } }), "not orderValid after the arrangement", 2]
  ])("refuses, naming it, when %s", { timeout: 300_000 }, (_label, overrides, expected, arranges) => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    box.setReplies({ ...resetReplies(box, state), ...overrides() });
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    const { json } = box.receipt(box.ids.reset);
    expect(json).toMatchObject({ outcome: "refused", stage: "queue_order", fixtureCommitted: true, githubRepositoryChanged: true });
    expect(json.reason).toContain(expected);
    expect(arrangeCalls(box)).toHaveLength(arranges);
    // Docs sync and the push had landed; nothing else was done, and no success receipt was written.
    expect(box.pushes()).toHaveLength(1);
    expect(box.receipts(box.ids.reset).filter((r) => r.json.outcome === "succeeded")).toEqual([]);
  });

  it("a rerun after a refusal resumes at docs sync and the queue: an already arranged queue is recognised, not arranged twice", { timeout: 300_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    box.setReplies({ ...resetReplies(box, state), "arcadia advance queue": [{ passthrough: "cli" as const }, queueReply(chain3, { orderValid: false, unpositionedCount: 1, ordered: chain3.map((key, i) => ({ orderKey: key, orderStatus: i === 0 ? "unpositioned" : "explicit" })) })], "arcadia advance queue arrange": { passthrough: "cli" as const } });
    expect(box.run(box.ids.reset, resetEnv).status).not.toBe(0);
    expect(arrangeCalls(box)).toHaveLength(2);
    box.setReplies(resetReplies(box, state));
    const again = box.run(box.ids.reset, resetEnv);
    expect(again.status, again.stdout + again.stderr).toBe(0);
    const { json } = box.receipt(box.ids.reset);
    expect(json).toMatchObject({ outcome: "succeeded" });
    expect(json.queue).toMatchObject({ state: "already_valid", orderValid: true, unpositionedCount: 0 });
    expect(arrangeCalls(box)).toHaveLength(2);
    expect(box.pushes()).toHaveLength(1);
  });
});

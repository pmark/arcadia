import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_COMMIT_FLOOR, chainActionIds } from "../src/operatorActions/rehearsalChain.js";
import { RUN7, type Replies, git, sandbox, ok, status, afterRun5, resetEnv, chainG6Replies } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain end to end (N=9): reset, then G6 and G7 bind its receipt", () => {
  it("the reset's receipt passes this run's G6, and G7 previews and activates exactly the nine Actions under its own request id", { timeout: 600_000 }, () => {
    const box = sandbox(RUN7, { clone: true });
    const state = afterRun5(box, { actionCount: 9, runId: RUN7 });
    const reset = box.run(box.ids.reset, resetEnv);
    expect(reset.status, reset.stdout + reset.stderr).toBe(0);
    const newHead = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    const head = git(box.checkout, ["rev-parse", "HEAD"]);
    const scoped = chainActionIds(9).map((id) => `three-action-rehearsal/${id}`);
    const g6Replies = chainG6Replies(box, state, newHead, head);
    box.setReplies(g6Replies);
    const g6 = box.run(box.ids.preflight);
    expect(g6.status, g6.stdout + g6.stderr).toBe(0);
    const preflight = box.receipt(box.ids.preflight).json;
    expect(preflight.checks.filter((c: { status: string }) => c.status !== "pass")).toEqual([]);
    expect(preflight.checks.find((c: { name: string }) => c.name === "fixture_coherence")).toMatchObject({ status: "pass", detail: expect.stringContaining("states another number of Actions than this run's 9") });
    const floorChecks = () => readFileSync(path.join(box.root, "floor.log"), "utf8").trim().split("\n");
    // G6 checked every floor commit against main (and nothing else was answered by the box git).
    expect([...new Set(floorChecks())].sort()).toEqual(Object.keys(REQUIRED_COMMIT_FLOOR).sort());
    const afterG6 = floorChecks().length;
    expect(preflight).toMatchObject({ outcome: "succeeded", chainRunId: RUN7, actionIds: chainActionIds(9), fixtureHead: newHead, arcadiaHead: head, brokerRevision: head, policyRevision: 33 });
    // The live `production preview` (run 6's first press, runs/20261006T151603Z-70938/preview.json) returned
    // scope.actions in Arcadia's own order, the integration grant's in the requested order.
    const liveOrder = ["transform-start-marker", "verify-final-rehearsal", "write-start-marker", ...chainActionIds(9).slice(3)].map((id) => `three-action-rehearsal/${id}`);
    expect([...liveOrder].sort()).toEqual([...scoped].sort());
    const preview = (actions: string[], grantActions: string[]) => ok({ preview: { expectedRevision: 33, scopeFingerprint: "fp-chain", unmatched: { projects: [], plans: [] }, scope: {
      projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions, providers: ["claude-code-cli"], maxConcurrentSessions: 1,
      mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"], remotePreservation: true, rehearsalException: null,
      packetApprovalExpiresAt: "{{arg:--packet-approval-expires-at}}", integrationGrant: { decisionRef: "0058", actions: grantActions, expiresAt: "{{arg:--integration-grant-expires-at}}" }
    } } });
    const g7Replies = (actions: string[], grantActions = scoped): Replies => ({
      ...g6Replies,
      "node preflight": { stdout: "Hermetic three-Action rehearsal passed\n" },
      "arcadia production preview": preview(actions, grantActions),
      "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 34, authority: { requestId: box.ids.grant, scopeFingerprint: "fp-chain" } } } })
    });
    const runs = { ARCADIA_OPERATOR_SCRIPT_ID: box.ids.grant, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${box.ids.grant}.json`) };
    const activateCalls = () => readFileSync(path.join(box.root, "keys.log"), "utf8").split("\n").filter((key) => key.startsWith("arcadia production activate"));
    // A preview with an extra, a missing or a duplicated Action (in the scope or the integration grant) still refuses, before any activation.
    const duplicated = [...liveOrder.slice(0, -1), liveOrder[0]];
    for (const [actions, grantActions] of [[[...liveOrder, "three-action-rehearsal/other-action"], scoped], [liveOrder.slice(1), scoped], [duplicated, scoped], [liveOrder, [...scoped, "three-action-rehearsal/other-action"]], [liveOrder, scoped.slice(0, -1)], [liveOrder, [...scoped.slice(0, -1), scoped[0]]]]) {
      box.setReplies(g7Replies(actions, grantActions));
      expect(box.run(box.ids.grant, runs).status).not.toBe(0);
      expect(box.receipt(box.ids.grant).json).toMatchObject({ outcome: "refused", stage: "preview", activated: false, offCleanup: "not_attempted" });
    }
    expect(activateCalls()).toEqual([]);
    box.setReplies(g7Replies(liveOrder));
    const g7 = box.run(box.ids.grant, runs);
    expect(g7.status, g7.stdout + g7.stderr).toBe(0);
    expect(box.receipt(box.ids.grant).json).toMatchObject({ outcome: "succeeded", activated: true, chainRunId: RUN7, actionIds: chainActionIds(9), fixtureHead: newHead, scopeFingerprint: "fp-chain", policyRevisionAfter: 34 });
    const calls = readFileSync(path.join(box.root, "calls.log"), "utf8").trim().split("\n").filter((line) => line.startsWith("mise ")).map((line) => JSON.parse(line.slice(5)) as string[]);
    const activations = calls.filter((args) => args.includes("activate"));
    expect(activations).toHaveLength(1);
    const values = (args: string[], flag: string) => args.flatMap((arg, i) => arg === flag ? [args[i + 1]] : []);
    expect(values(activations[0], "--action")).toEqual(scoped);
    expect(values(activations[0], "--integration-grant-action")).toEqual(scoped);
    expect(values(activations[0], "--request-id")).toEqual([box.ids.grant]);
    expect(values(activations[0], "--expected-revision")).toEqual(["33"]);
    expect(values(activations[0], "--concurrency")).toEqual(["1"]);
    expect(activations[0]).toContain("--remote-preservation");
    expect(box.pushes()).toHaveLength(1);
    // G7 checked every floor commit again.
    expect([...new Set(floorChecks().slice(afterG6))].sort()).toEqual(Object.keys(REQUIRED_COMMIT_FLOOR).sort());
    // G8 owns the policy Arcadia stores in its own Action order, and still refuses an extra, missing or duplicated Action.
    const policy = (actions: string[]) => status("active", {}, { authority: { requestId: box.ids.grant }, scope: { projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions } });
    const g8Runs = { ARCADIA_OPERATOR_SCRIPT_ID: box.ids.terminalOff, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${box.ids.terminalOff}.json`) };
    const deactivations = () => readFileSync(path.join(box.root, "keys.log"), "utf8").split("\n").filter((key) => key.startsWith("arcadia production deactivate"));
    for (const actions of [[...liveOrder, "three-action-rehearsal/chain-step-10"], liveOrder.slice(1), duplicated]) {
      box.setReplies({ ...g6Replies, "arcadia production status": policy(actions) });
      expect(box.run(box.ids.terminalOff, g8Runs).status).not.toBe(0);
      expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ outcome: "refused", offState: "not_owned" });
    }
    expect(deactivations()).toEqual([]);
    box.setReplies({ ...g6Replies, "arcadia production status": [policy(liveOrder), status("inactive")], "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }) });
    box.run(box.ids.terminalOff, g8Runs);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ offState: "confirmed", ownedActions: scoped });
    expect(deactivations()).toHaveLength(1);
  });
});

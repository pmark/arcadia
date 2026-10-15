import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { chainActionIds } from "../src/operatorActions/rehearsalChain.js";
import { impl, RUN7, type Replies, sandbox, type Box, ok, status, writeParams, writeG7Receipt } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain G8 is the emergency stop: drift never blocks this run's Off", () => {
  const runsEnv = (box: Box) => ({ ARCADIA_OPERATOR_SCRIPT_ID: box.ids.terminalOff, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${box.ids.terminalOff}.json`) });
  const scoped = chainActionIds(9).map((id) => `three-action-rehearsal/${id}`);
  const scope = { projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions: scoped };
  const offReplies = (box: Box): Replies => ({
    "arcadia production status": [status("active", {}, { authority: { requestId: box.ids.grant }, scope }), status("inactive")],
    "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }),
    "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
    "probe": { passthrough: "probe" }
  });
  const deactivations = (box: Box) => box.keys().filter((k) => k.startsWith("arcadia production deactivate"));

  it.each([
    ["a broken parameter file", (box: Box) => writeFileSync(path.join(box.scripts, "rehearsal-chain", "params", `${RUN7}.json`), "{ not json"), "does not name run"],
    ["an Action count edited after the press", (box: Box) => writeParams(box, RUN7, { ...JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")), actionCount: 3 }, false), null],
    ["a drifted launcher", (box: Box) => writeFileSync(path.join(box.scripts, `${box.ids.terminalOff}.sh`), readFileSync(path.join(box.scripts, `${box.ids.terminalOff}.sh`), "utf8") + "# drift\n"), "not published in this library"]
  ])("with %s, it still turns this run's Grant Off first (bound to the G7 receipt's Actions)", { timeout: 240_000 }, (_label, drift, refusal) => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")), false);
    initWorkspace(box.workspace);
    writeG7Receipt(box, chainActionIds(9));
    drift(box);
    box.setReplies(offReplies(box));
    expect(box.run(box.ids.terminalOff, runsEnv(box)).status).not.toBe(0);
    const { json } = box.receipt(box.ids.terminalOff);
    expect(deactivations(box)).toHaveLength(1);
    expect(json).toMatchObject({ outcome: "refused", offState: "confirmed", ownedActions: scoped });
    if (refusal) {
      expect(json.stage).toBe("parameters");
      expect(json.reason).toContain(refusal);
      expect(json.reason).toContain("production is Off (confirmed)");
    } else {
      // The edited count only shapes the later reconciliation record; it never decided ownership.
      expect(json.actionIds).toEqual(chainActionIds(3));
    }
  });

  it("a later refused G7 attempt with other Actions does not displace the activated Grant's scope: G8 still turns the run's Grant Off", { timeout: 240_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")), false);
    initWorkspace(box.workspace);
    const activated = writeG7Receipt(box, chainActionIds(9), "20261006T230000Z-1");
    // A second press refused (its one-shot or drift checks) after recording a different Action set.
    writeG7Receipt(box, chainActionIds(3), "20261006T231500Z-2", { outcome: "refused", stage: "production_state", activated: false, offCleanup: "not_attempted" });
    box.setReplies(offReplies(box));
    box.run(box.ids.terminalOff, runsEnv(box));
    const { json } = box.receipt(box.ids.terminalOff);
    expect(json).toMatchObject({ offState: "confirmed", ownedActions: scoped, ownershipBasis: `G7 receipt ${activated}` });
    expect(deactivations(box)).toHaveLength(1);
  });

  it("with only refused G7 attempts it falls back to the latest one with Actions (and refuses a scope that does not match it)", { timeout: 240_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")), false);
    initWorkspace(box.workspace);
    const latest = writeG7Receipt(box, chainActionIds(3), "20261006T231500Z-2", { outcome: "refused", stage: "preflight_receipt", activated: false });
    box.setReplies(offReplies(box));
    expect(box.run(box.ids.terminalOff, runsEnv(box)).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ offState: "not_owned", ownershipBasis: `G7 receipt ${latest}` });
    expect(deactivations(box)).toEqual([]);
  });

  it("with no G7 receipt (a G7 that vanished after activating) it owns its own request id over this fixture's chain Actions only", { timeout: 240_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")), false);
    initWorkspace(box.workspace);
    box.setReplies({ ...offReplies(box), "arcadia production status": status("active", {}, { authority: { requestId: box.ids.grant }, scope: { ...scope, actions: [...scoped, "three-action-rehearsal/other-action"] } }) });
    expect(box.run(box.ids.terminalOff, runsEnv(box)).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ offState: "not_owned", ownedActions: null });
    expect(deactivations(box)).toEqual([]);
    box.setReplies(offReplies(box));
    box.run(box.ids.terminalOff, runsEnv(box));
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ offState: "confirmed", ownedActions: null });
    expect(deactivations(box)).toHaveLength(1);
  });

  it("a launch naming no run owns nothing: it writes a receipt and runs no Arcadia command", { timeout: 120_000 }, () => {
    const box = sandbox(RUN7);
    const result = spawnSync("bash", [path.join(box.scripts, "rehearsal-chain", "restore-terminal-off.sh"), path.join(box.root, "elsewhere.json"), "run"], { encoding: "utf8", input: "", env: { ...process.env, PATH: `${path.join(box.root, "bin")}:${process.env.PATH}`, FAKE_ROOT: box.root, HOME: box.home } });
    expect(result.status).not.toBe(0);
    expect(box.receipt("restore-terminal-off-rehearsal-chain-unnamed-run").json).toMatchObject({ outcome: "refused", stage: "launch_context" });
    expect(box.keys()).toEqual([]);
  });
});

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { chainActionIds, chainLibraryIds } from "../src/operatorActions/rehearsalChain.js";
import { impl, RUN6, RUN7, sandbox, ok, status, unfilledRun7, writeParams, writeG7Receipt } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain G6, G7 and G8", () => {
  it("G6 refuses run 7's file while its run-6 bindings are UNFILLED, before any observation", { timeout: 120_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, unfilledRun7());
    box.setReplies({ "probe": { passthrough: "probe" } });
    expect(box.run(box.ids.preflight).status).not.toBe(0);
    const { json } = box.receipt(box.ids.preflight);
    expect(json).toMatchObject({ outcome: "refused", stage: "parameters", productionPreviewedOrActivated: false });
    expect(json.reason).toContain("params.previousRun.bindings.resetHead");
    expect(box.keys()).toEqual(["probe params"]);
  });

  it("G7 refuses outside /runs before any Arcadia command, and refuses unfilled parameters without attempting activation", { timeout: 120_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, unfilledRun7());
    box.setReplies({ "probe": { passthrough: "probe" } });
    expect(box.run(box.ids.grant).status).not.toBe(0);
    expect(box.receipt(box.ids.grant).json).toMatchObject({ outcome: "refused", stage: "launch_context", activated: false, offCleanup: "not_attempted" });
    expect(box.keys()).toEqual([]);
    const runs = { ARCADIA_OPERATOR_SCRIPT_ID: box.ids.grant, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${box.ids.grant}.json`) };
    expect(box.run(box.ids.grant, runs).status).not.toBe(0);
    expect(box.receipt(box.ids.grant).json).toMatchObject({ outcome: "refused", stage: "parameters", activated: false, offCleanup: "not_attempted" });
    expect(box.keys()).toEqual(["probe params"]);
  });

  it("G8 refuses a non-interactive shell, refuses a policy it does not own without turning it Off, and owns only this run's Grant with its exact N-Action scope", { timeout: 240_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")));
    expect(box.run(box.ids.terminalOff).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ outcome: "refused", stage: "launch_context" });
    expect(box.keys()).toEqual([]);
    const runs = { ARCADIA_OPERATOR_SCRIPT_ID: box.ids.terminalOff, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${box.ids.terminalOff}.json`) };
    const scoped = chainActionIds(9).map((id) => `three-action-rehearsal/${id}`);
    const scope = { projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions: scoped };
    // Run 6's Grant (another run) is not owned, even with a fixture scope.
    box.setReplies({ "arcadia production status": status("active", {}, { authority: { requestId: chainLibraryIds(RUN6).grant }, scope }) });
    expect(box.run(box.ids.terminalOff, runs).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ outcome: "refused", offState: "not_owned" });
    expect(box.keys().filter((k) => k.startsWith("arcadia production deactivate"))).toEqual([]);
    // This run's Grant with only three of the nine Actions its G7 receipt recorded is not owned either.
    writeG7Receipt(box, chainActionIds(9));
    box.setReplies({ "arcadia production status": status("active", {}, { authority: { requestId: box.ids.grant }, scope: { ...scope, actions: scoped.slice(0, 3) } }) });
    expect(box.run(box.ids.terminalOff, runs).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ outcome: "refused", offState: "not_owned" });
    // This run's exact Grant is turned Off, the worker logs are copied before any restart (here the
    // reviewed restart path is absent from the box library, so nothing restarts).
    initWorkspace(box.workspace);
    const logs = path.join(box.home, "Library", "Logs", "arcadia-services-1");
    mkdirSync(logs, { recursive: true });
    writeFileSync(path.join(logs, "worker.out.log"), "tick 1\ntick 2\n");
    writeFileSync(path.join(logs, "worker.err.log"), "");
    box.setReplies({
      "arcadia production status": [status("active", {}, { authority: { requestId: box.ids.grant }, scope }), status("inactive")],
      "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }),
      "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
      "probe": { passthrough: "probe" }
    });
    const result = box.run(box.ids.terminalOff, runs);
    expect(result.status).not.toBe(0);
    const { json, dir } = box.receipt(box.ids.terminalOff);
    expect(json).toMatchObject({ outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false, chainRunId: RUN7, actionIds: chainActionIds(9), scopedActions: scoped });
    expect(json.reason).toContain("recover-arcadia-host-services is missing");
    expect(json.workerLogs.map((entry: { source: string }) => path.basename(entry.source)).sort()).toEqual(["worker.err.log", "worker.out.log"]);
    expect(readFileSync(path.join(dir, "evidence", "worker-logs", "arcadia-services-1", "worker.out.log"), "utf8")).toBe("tick 1\ntick 2\n");
    expect(box.keys().filter((k) => k.startsWith("arcadia production deactivate"))).toHaveLength(1);
  });
});

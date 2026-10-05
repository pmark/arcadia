import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveNextOperatorAction, type SequencedScript } from "../../../lib/nextOperatorAction";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const base = { schema: "arcadia-operator-script-v1", problem: "Example problem", desired_effect: "Example effect", authority: { does: ["One action"], never_does: ["Broaden scope"] }, success: { effect: "Done", next: "Keep receipt" }, failure: { effect: "Refused", next: "Read the handoff" } };

function fixtureLibrary(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-next-action-route-")); roots.push(root);
  const entries = [
    { id: "check-host", title: "G6: Check the host", repeatable: true },
    { id: "grant-run", title: "G7: Grant the run", kind: "grant", repeatable: false, next_after: { id: "check-host", within_minutes: 30, voided_by: ["restore-off"], when_production: "inactive" } },
    { id: "restore-off", title: "G8: Restore Off", repeatable: true }
  ];
  for (const entry of entries) {
    writeFileSync(path.join(root, `${entry.id}.sh`), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(path.join(root, `${entry.id}.json`), JSON.stringify({ ...base, ...entry, script: `${entry.id}.sh` }));
  }
  const receipt = (dir: string, value: Record<string, unknown>) => {
    mkdirSync(path.join(root, "runs", dir), { recursive: true });
    writeFileSync(path.join(root, "runs", dir, "receipt.json"), JSON.stringify(value));
  };
  receipt("20261005T145520Z-94787", { id: "check-host", outcome: "succeeded", startedAt: "2026-10-05T14:55:20Z", finishedAt: "2026-10-05T14:55:36Z" });
  receipt("20261005T150228Z-19523", { id: "restore-off", outcome: "succeeded", startedAt: "2026-10-05T15:02:28Z", finishedAt: "2026-10-05T15:05:41Z" });
  receipt("20261005T150713Z-37240", { id: "check-host", outcome: "succeeded", startedAt: "2026-10-05T15:07:13Z", finishedAt: "2026-10-05T15:07:30Z" });
  mkdirSync(path.join(root, "runs", "20261005T150900Z-1"), { recursive: true });
  writeFileSync(path.join(root, "runs", "20261005T150900Z-1", "receipt.json"), "{not json");
  return root;
}

describe("GET /api/operator-script projects the next-action inputs", () => {
  it("returns each descriptor's next_after and its latest script-written run receipt, in run-directory order", async () => {
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", fixtureLibrary()); vi.resetModules();
    const { GET } = await import("./route");
    const { scripts } = await (await GET()).json() as { scripts: SequencedScript[] };
    const byId = Object.fromEntries(scripts.map((script) => [script.id, script]));
    expect(byId["grant-run"]).toMatchObject({ nextAfter: { id: "check-host", within_minutes: 30, voided_by: ["restore-off"], when_production: "inactive" }, lastRunReceipt: null });
    expect(byId["check-host"]).toMatchObject({ nextAfter: null, lastRunReceipt: { runDirectory: "runs/20261005T150713Z-37240", outcome: "succeeded", finishedAt: "2026-10-05T15:07:30Z" } });

    // The G8 that ran before the latest G6 does not void it; G7 is next until 15:37:30Z.
    const next = deriveNextOperatorAction(scripts, { active: false }, Date.parse("2026-10-05T15:10:00Z"));
    expect(next).toMatchObject({ status: "next", reason: "window_open", scriptId: "grant-run", deadline: "2026-10-05T15:37:30.000Z" });
  });

  it("keeps the latest succeeded receipt of a one-shot after a later refused run, so G7 stays consumed", async () => {
    const root = fixtureLibrary();
    const write = (dir: string, value: Record<string, unknown>) => { mkdirSync(path.join(root, "runs", dir), { recursive: true }); writeFileSync(path.join(root, "runs", dir, "receipt.json"), JSON.stringify(value)); };
    write("20261005T151511Z-65567", { id: "grant-run", outcome: "succeeded", startedAt: "2026-10-05T15:15:11Z", finishedAt: "2026-10-05T15:17:17Z" });
    write("20261005T153000Z-70000", { id: "grant-run", outcome: "refused", startedAt: "2026-10-05T15:30:00Z", finishedAt: "2026-10-05T15:30:05Z" });
    write("20261005T153100Z-70001", { id: "check-host", outcome: "succeeded", startedAt: "2026-10-05T15:31:00Z", finishedAt: "2026-10-05T15:31:20Z" });
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root); vi.resetModules();
    const { GET } = await import("./route");
    const { scripts } = await (await GET()).json() as { scripts: SequencedScript[] };
    expect(scripts.find((script) => script.id === "grant-run")?.lastRunReceipt).toMatchObject({ outcome: "refused", succeededAt: "2026-10-05T15:17:17Z" });
    expect(deriveNextOperatorAction(scripts, { active: false }, Date.parse("2026-10-05T15:32:00Z"))).toMatchObject({ status: "none", message: "Nothing needs you right now." });
  });

  it("never fails the whole listing when runs/ cannot be read", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-next-action-unreadable-")); roots.push(root);
    writeFileSync(path.join(root, "solo.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(path.join(root, "solo.json"), JSON.stringify({ ...base, id: "solo", title: "Solo", script: "solo.sh" }));
    writeFileSync(path.join(root, "runs"), "not a directory");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root); vi.resetModules();
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toHaveProperty("scripts");
    expect(logged).toHaveBeenCalledWith("Could not read operator run receipts; listing without them.", expect.anything());
    // The loader itself degrades to no receipts rather than throwing.
    const { loadLatestRunReceipts } = await import("../../../lib/operatorRunReceipts");
    await expect(loadLatestRunReceipts(root)).resolves.toEqual(new Map());
    logged.mockRestore();
  });

  it("lists normally when the library has no runs directory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-next-action-empty-")); roots.push(root);
    writeFileSync(path.join(root, "solo.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(path.join(root, "solo.json"), JSON.stringify({ ...base, id: "solo", title: "Solo", script: "solo.sh" }));
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root); vi.resetModules();
    const { GET } = await import("./route");
    const { scripts } = await (await GET()).json() as { scripts: SequencedScript[] };
    expect(scripts).toHaveLength(1);
    expect(deriveNextOperatorAction(scripts, { active: false }, Date.now())).toMatchObject({ status: "none", message: "Nothing needs you right now." });
  });
});

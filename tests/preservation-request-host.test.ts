import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manualPreservationFixture, fixtureGit } from "../scripts/preservation-fixture.js";
import { executeHostPreservation } from "../src/sessions/preservationRequestExecutor.js";

const fixtures: ReturnType<typeof manualPreservationFixture>[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const f of fixtures.splice(0)) { rmSync(f.candidate, { recursive: true, force: true }); rmSync(f.root, { recursive: true, force: true }); } });

describe.skipIf(process.env.ARCADIA_PRESERVATION_HOST_TEST !== "1")("real host preservation child", () => {
  it("kills a real post-validation capture stall, retaining the passing Seatbelt receipt", async () => {
    const f = manualPreservationFixture(); fixtures.push(f);
    const bin = path.join(f.root, "host-bin"); mkdirSync(bin);
    const shim = path.join(bin, "git.mjs");
    const evidenceRoot = path.join(f.workspace, "artifacts/preservation");
    const pidFile = path.join(f.root, "stuck-pid");
    writeFileSync(shim, `
      import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process';
      const root = ${JSON.stringify(evidenceRoot)};
      let passed = false;
      try { for (const id of fs.readdirSync(root)) for (const dir of fs.readdirSync(path.join(root,id))) {
        try { const proof = JSON.parse(fs.readFileSync(path.join(root,id,dir,'validation.json'),'utf8'));
          passed ||= proof.complete === true && proof.results.every(r => r.exitStatus === 0);
        } catch {}
      } } catch {}
      if (process.argv[2] === 'hash-object' && passed) {
        fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
      }
      const result=spawnSync('/usr/bin/git',process.argv.slice(2),{stdio:'inherit'}); process.exit(result.status ?? 1);
    `);
    writeFileSync(path.join(bin, "git"), `#!/bin/sh\nexec '${process.execPath}' '${shim}' "$@"\n`); chmodSync(path.join(bin, "git"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    const result = await executeHostPreservation({ source: f.candidate, workspace: f.workspace, attemptFile: path.join(f.workspace, "stalled.json") }, { total: 25000, stage: 6000 });
    expect(result).toMatchObject({ ok: false, error: { details: { stage: "validation.recheck-snapshot", evidenceRef: expect.any(String) } } });
    if (result.ok) throw new Error("Stalled capture unexpectedly succeeded");
    const proof = JSON.parse(readFileSync(String(result.error.details.evidenceRef), "utf8"));
    expect(proof.complete).toBe(true); expect(proof.results.every((r: { exitStatus: number }) => r.exitStatus === 0)).toBe(true);
    const stuckPid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(stuckPid, 0)).toThrow();
    vi.unstubAllEnvs();
    expect(fixtureGit(f.candidate, ["rev-parse", "HEAD"])).toBe(f.base);
    expect(readFileSync(path.join(f.candidate, "marker.txt"), "utf8")).toBe("ready\n");
  }, 30000);
  it("preserves and replays one manual candidate using real Seatbelt evidence", async () => {
    const f = manualPreservationFixture(); fixtures.push(f);
    const input = { source: f.candidate, workspace: f.workspace, attemptFile: path.join(f.workspace, "attempt.json") };
    const first = await executeHostPreservation(input);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(JSON.stringify(first));
    const receipt = (first.response as { data: { receipt: { commitSha: string; candidateFingerprint: string; validationEvidenceRef: string } } }).data.receipt;
    expect(fixtureGit(f.candidate, ["rev-parse", "HEAD^{tree}"])).toBe(receipt.candidateFingerprint);
    expect(JSON.parse(readFileSync(receipt.validationEvidenceRef, "utf8")).results[0].exitStatus).toBe(0);
    const replay = await executeHostPreservation({ ...input, attemptFile: path.join(f.workspace, "replay.json") });
    expect(replay).toMatchObject({ ok: true, response: { data: { receipt: { commitSha: receipt.commitSha, replayed: true } } } });
    writeFileSync(path.join(f.candidate, "marker.txt"), "wrong\n");
    const refused = await executeHostPreservation({ ...input, attemptFile: path.join(f.workspace, "failure.json") });
    expect(refused).toMatchObject({ ok: false, error: { details: { stage: "validation.evidence", evidenceRef: expect.any(String), checks: [{ status: "failed" }] } } });
    expect(fixtureGit(f.candidate, ["rev-list", "--count", "main..HEAD"])).toBe("1");
  }, 30_000);
});

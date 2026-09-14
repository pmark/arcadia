import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureGit, preservationFixture } from "../scripts/preservation-fixture.js";
import { withDatabase } from "../src/db/connection.js";
import { preservationAuthority, validatePreservationCandidate } from "../src/sessions/preservationValidation.js";
import { materializeCandidateTree, snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { runPreserveCommand } from "../src/commands/preserve.js";

const fixtures: ReturnType<typeof preservationFixture>[] = [];
const fixture = (command?: string) => { const f = preservationFixture(undefined, command); fixtures.push(f); return f; };
afterEach(() => { for (const f of fixtures.splice(0)) { rmSync(f.candidate, { recursive: true, force: true }); rmSync(f.root, { recursive: true, force: true }); } });

describe("preservation authority and content", () => {
  it("binds the configured checks to the approved packet and rejects changed definitions, packet and authority", () => {
    const f = fixture();
    withDatabase(f.workspace, db => {
      expect(preservationAuthority(db, f.workspace, f.lease).commands).toEqual(["node check.mjs"]);
      db.prepare("UPDATE project_metadata SET validation_commands = ? WHERE project_id = ?").run('["true"]', f.lease.project_id);
      expect(() => preservationAuthority(db, f.workspace, f.lease)).toThrow(/definitions differ/);
      db.prepare("UPDATE project_metadata SET validation_commands = ? WHERE project_id = ?").run('["node check.mjs"]', f.lease.project_id);
      const packet = path.join(f.workspace, f.lease.packet_path); const original = readFileSync(packet);
      writeFileSync(packet, "forged"); expect(() => preservationAuthority(db, f.workspace, f.lease)).toThrow(/packet is stale/); writeFileSync(packet, original);
      db.prepare("UPDATE review_items SET status = 'rejected'").run();
      expect(() => preservationAuthority(db, f.workspace, f.lease)).toThrow(/no longer approved/);
    });
  });
  it("exports exact Git bytes despite export attributes, excludes transport and refuses symlink escapes", () => {
    const f = fixture(); const destination = mkdtempSync(path.join(f.root, "snapshot-"));
    writeFileSync(path.join(f.candidate, ".gitattributes"), "marker.txt export-ignore\n");
    const tree = snapshotCandidate(f.candidate); materializeCandidateTree(f.repo, tree, destination);
    expect(readFileSync(path.join(destination, "marker.txt"), "utf8")).toBe("ready\n");
    writeFileSync(path.join(f.candidate, ".arcadia-preserve-request"), '{"nonce":"not-content"}');
    writeFileSync(path.join(f.candidate, ".arcadia-go-request"), '{"nonce":"not-content"}');
    expect(snapshotCandidate(f.candidate)).toBe(tree);
    symlinkSync(path.join(f.root, "workspace"), path.join(f.candidate, "escape"));
    expect(() => snapshotCandidate(f.candidate)).toThrow(/regular candidate files/);
  });
  it("refuses a tracked go request instead of preserving transport as candidate content", () => {
    const f = fixture();
    writeFileSync(path.join(f.candidate, ".arcadia-go-request"), '{"nonce":"not-content"}');
    fixtureGit(f.candidate, ["add", ".arcadia-go-request"]);
    expect(() => snapshotCandidate(f.candidate)).toThrow("go transport file must not be tracked");
  });
});

// Native sandboxing cannot be nested in an agent sandbox. Run explicitly on
// the host; never substitute a mock producer for this evidence.
describe.skipIf(process.env.ARCADIA_PRESERVATION_HOST_TEST !== "1")("real host validation sandbox", () => {
  it("preserves the tested tree, then refuses altered content on replay", () => {
    const f = fixture(); const before = readFileSync(path.join(f.repo, "PROJECT.md"));
    const r = runPreserveCommand({ source: f.candidate, workspace: f.workspace }).data.receipt;
    expect(fixtureGit(f.candidate, ["rev-parse", `${r.commitSha}^{tree}`])).toBe(r.candidateFingerprint);
    expect(runPreserveCommand({ source: f.candidate, workspace: f.workspace }).data.receipt.replayed).toBe(true);
    writeFileSync(path.join(f.candidate, "marker.txt"), "wrong\n");
    expect(() => runPreserveCommand({ source: f.candidate, workspace: f.workspace })).toThrow(/validation failed/);
    expect(readFileSync(path.join(f.repo, "PROJECT.md"))).toEqual(before);
  });
  it("refuses failed checks and source-writing checks", () => {
    const failed = fixture("exit 1");
    expect(() => runPreserveCommand({ source: failed.candidate, workspace: failed.workspace })).toThrow(/validation failed/);
    const writes = fixture("printf forged > marker.txt");
    expect(() => runPreserveCommand({ source: writes.candidate, workspace: writes.workspace })).toThrow(/validation failed/);
  });
  it("refuses worktree mutation during validation even though the immutable snapshot passes", () => {
    const f = fixture("sleep 1; node check.mjs");
    const mutator = spawn(process.execPath, ["-e", "setTimeout(()=>require('fs').writeFileSync(process.argv[1],'altered\\n'),400)", path.join(f.candidate, "marker.txt")], { stdio: "ignore" });
    try {
      expect(() => runPreserveCommand({ source: f.candidate, workspace: f.workspace })).toThrow(/changed during validation/);
      expect(fixtureGit(f.candidate, ["rev-parse", "HEAD"])).toBe(f.base);
    } finally { mutator.kill(); }
  });
  it("rejects a caller passing fabricated evidence instead of running failed checks", () => {
    const f = fixture("exit 1");
    const options = { source: f.candidate, workspace: f.workspace, validation: { passed: true, evidenceRef: "agent-writable.json" } };
    expect(() => runPreserveCommand(options)).toThrow(/validation failed/);
  });
  it("refuses changes between validation and preservation", () => {
    const f = fixture();
    expect(() => runPreserveCommand({ source: f.candidate, workspace: f.workspace, deps: { hooks: { beforeStage() { writeFileSync(path.join(f.candidate, "marker.txt"), "altered\n"); } } } })).toThrow(/differs from the validated/);
    expect(fixtureGit(f.candidate, ["rev-parse", "HEAD"])).toBe(f.base);
  });
});

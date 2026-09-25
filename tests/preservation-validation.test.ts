import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureGit, preservationFixture } from "../scripts/preservation-fixture.js";
import { withDatabase } from "../src/db/connection.js";
import { preservationAuthority, validateBoundCandidate, validatePreservationCandidate } from "../src/sessions/preservationValidation.js";
import { materializeCandidateTree, snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { bindCheckDefinitions, PRESERVATION_CHECK_MODIFIED_CODE } from "../src/sessions/preservationCheckBinding.js";
import { MAX_IDENTICAL_PRESERVATION_REFUSALS } from "../src/sessions/preservationRefusalBudget.js";
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
  it("refuses a dependency-requiring check with the named remedy before executing it", () => {
    const f = fixture();
    withDatabase(f.workspace, db => {
      db.prepare("UPDATE project_metadata SET validation_commands = ? WHERE project_id = ?").run('["pnpm test"]', f.lease.project_id);
      expect(() => preservationAuthority(db, f.workspace, f.lease)).toThrow(/needs installed dependencies/);
      expect(() => validatePreservationCandidate(db, f.workspace, f.lease)).toThrow(/needs installed dependencies/);
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
  it("refuses a candidate that neutered its own declared check, before executing anything, leaving the candidate untouched", () => {
    const f = fixture();
    writeFileSync(path.join(f.candidate, "check.mjs"), "process.exit(0);\n");
    withDatabase(f.workspace, db => {
      let error: unknown;
      try { validatePreservationCandidate(db, f.workspace, f.lease); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ message: expect.stringMatching(/cannot rewrite the check/), details: { code: PRESERVATION_CHECK_MODIFIED_CODE, path: "check.mjs" } });
    });
    // Refused, not repaired: the candidate's own rewrite is left exactly as the
    // candidate wrote it, and no commit was fabricated on the repository.
    expect(readFileSync(path.join(f.candidate, "check.mjs"), "utf8")).toBe("process.exit(0);\n");
    expect(fixtureGit(f.repo, ["rev-parse", "HEAD"])).toBe(f.base);
  });
  it("binds an unchanged candidate's check to the authorized base without refusing it", () => {
    const f = fixture();
    const tree = snapshotCandidate(f.candidate);
    // Unlike the neutered-check case above, this candidate never touched
    // check.mjs, so binding must not refuse it: the check stays eligible to run.
    const bound = bindCheckDefinitions(f.repo, f.base, tree, ["node check.mjs"]);
    expect(bound.baseRevision).toBe(f.base);
    const checkFile = bound.files.find(file => file.path === "check.mjs");
    expect(checkFile?.blob).toBe(fixtureGit(f.repo, ["rev-parse", `${f.base}:check.mjs`]));
  });
});

// Native sandboxing cannot be nested in an agent sandbox. Run explicitly on
// the host; never substitute a mock producer for this evidence.
describe.skipIf(process.env.ARCADIA_PRESERVATION_HOST_TEST !== "1")("real host validation sandbox", () => {
  it("allows anchored traversal into scratch while retaining workspace denial", () => {
    const code = "import os; root=os.open('/',os.O_RDONLY|os.O_DIRECTORY); " +
      "parts=os.path.realpath(os.environ['TMPDIR']).split('/'); " +
      "exec('for part in parts:\\n if part:\\n  child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=root)\\n  os.close(root)\\n  root=child'); os.close(root)";
    const f = fixture(`/usr/bin/python3 -I -c '${code.replaceAll("'", "'\\''")}'`);
    const result = withDatabase(f.workspace, db => validatePreservationCandidate(db, f.workspace, f.lease));
    expect(result.passed).toBe(true);
    const proof = JSON.parse(readFileSync(result.evidenceRef, "utf8"));
    expect(proof.results[0].exitStatus).toBe(0);
    expect(result.evidenceRef.startsWith(f.workspace + path.sep)).toBe(true);
    const denied = fixture();
    // Use the generic validator here so a workspace read can be tested without
    // altering a managed packet or weakening its frozen-command binding.
    expect(() => validateBoundCandidate(denied.workspace, { id: "workspace-denial", repository: denied.repo,
      worktree: denied.candidate, base: denied.base, commands: [`node -e 'require("node:fs").readdirSync(${JSON.stringify(denied.workspace)})'`] }, {}, () => {})).toThrow(/validation failed/);
  });
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
  it("names the failing check, its command and exit status in the refusal's details", () => {
    const f = fixture("exit 1");
    withDatabase(f.workspace, db => {
      let error: unknown;
      try { validatePreservationCandidate(db, f.workspace, f.lease); } catch (caught) { error = caught; }
      expect(error).toMatchObject({
        message: "Declared preservation validation failed or was skipped.",
        details: { checks: [{ command: "exit 1", status: "failed", exitStatus: 1 }] }
      });
    });
  });
  it("names a skipped check's command and its skip reason (a killing signal) in the refusal's details", () => {
    const f = fixture("kill -KILL $$");
    withDatabase(f.workspace, db => {
      let error: unknown;
      try { validatePreservationCandidate(db, f.workspace, f.lease); } catch (caught) { error = caught; }
      expect(error).toMatchObject({
        message: "Declared preservation validation failed or was skipped.",
        details: { checks: [{ command: "kill -KILL $$", status: "skipped", skipReason: "terminated by signal SIGKILL" }] }
      });
    });
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
  it("bounds a Session's identical preservation refusals from the CLI without reconciling a Session that may still be live", () => {
    const f = fixture("exit 1");
    for (let attempt = 1; attempt < MAX_IDENTICAL_PRESERVATION_REFUSALS; attempt++) {
      expect(() => runPreserveCommand({ source: f.candidate, workspace: f.workspace }))
        .toThrow("Declared preservation validation failed or was skipped.");
    }
    // The identical-refusal budget is now exhausted: the next attempt gets a
    // distinct refusal naming the limit. This CLI call can run from inside a
    // still-live Session (it is exactly what a live agent invokes to preserve
    // its own candidate), so it must refuse without touching the Session's
    // own lease or status -- reconciling a `running` Session out from under
    // its own live worker would let a competing launch treat the repository
    // as unleased. Only the managed-production tick, which independently
    // confirms the worker's tmux session is actually dead before it ever
    // calls preservation, may reconcile the Session as an incomplete exit
    // (proven in tests/preserve-on-exit-and-integrate.test.ts).
    let limitError: unknown;
    try {
      runPreserveCommand({ source: f.candidate, workspace: f.workspace });
    } catch (caught) {
      limitError = caught;
    }
    expect(limitError).toMatchObject({
      message: expect.stringContaining(`identical reason ${MAX_IDENTICAL_PRESERVATION_REFUSALS} times in a row`)
    });
    withDatabase(f.workspace, db => {
      const session = db.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(f.lease.id) as { status: string };
      expect(["prepared", "running"]).toContain(session.status);
      const receipt = db.prepare("SELECT COUNT(*) AS n FROM session_exit_receipts WHERE session_id = ?").get(f.lease.id) as { n: number };
      expect(receipt.n).toBe(0);
      const budget = db.prepare("SELECT attempts FROM preservation_refusal_attempts WHERE subject_id = ?").get(f.lease.id) as { attempts: number };
      expect(budget.attempts).toBe(MAX_IDENTICAL_PRESERVATION_REFUSALS);
    });
  });
  it("resets the identical-refusal budget when the refusal reason changes", () => {
    const f = fixture(); // default command: "node check.mjs", which fails until marker.txt reads "ready\n"
    writeFileSync(path.join(f.candidate, "marker.txt"), "not ready\n");
    expect(() => runPreserveCommand({ source: f.candidate, workspace: f.workspace })).toThrow(
      "Declared preservation validation failed or was skipped."
    );
    // A candidate that neuters its own declared check is refused for a
    // completely different reason, before any command even runs -- a sign
    // this is a new problem, not the same one repeating -- so it must not
    // inherit the prior attempt's count.
    writeFileSync(path.join(f.candidate, "check.mjs"), "process.exit(0);\n");
    expect(() => runPreserveCommand({ source: f.candidate, workspace: f.workspace })).toThrow(/cannot rewrite the check/);
    withDatabase(f.workspace, db => {
      const row = db.prepare("SELECT attempts, fingerprint FROM preservation_refusal_attempts WHERE subject_id = ?").get(f.lease.id) as
        | { attempts: number; fingerprint: string }
        | undefined;
      expect(row?.attempts).toBe(1);
    });
  });
});

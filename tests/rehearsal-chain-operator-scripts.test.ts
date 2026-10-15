import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAIN_IMPLEMENTATION, CHAIN_KINDS } from "../src/operatorActions/rehearsalChain.js";
import { repoRoot, library, impl, RUN6, implSource, sandbox, writeParams } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain set: static safety", () => {
  const files = Object.values(CHAIN_IMPLEMENTATION);
  it.each(files)("%s contains no kill, recursive delete, repository delete, force push, history rewrite, pull-request write, Agent Ask settlement or exported workspace", (file) => {
    const text = implSource(file);
    for (const pattern of [/\bkill\b/, /\bpkill\b/, /rm -rf/, /gh repo delete/, /--force\b/, /push\s+(-\S+\s+)*-f\b/, /\+refs\//, /reset --hard/, /\breset --/, /worktree remove/, /branch -[Dfd]\b/, /production reactivate/, /gh pr (merge|close|edit|comment|ready)/, /rebase/, /export ARCADIA_WORKSPACE/, /agent[-_]ask/, /--disposition/, /settleAgentAsk|runAgentAskSettleCommand/]) {
      expect(text, `${file} must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it("only the G7 previews or activates production; G8 alone deactivates (G7 only to undo its own failed activation)", () => {
    for (const file of ["reset.sh", "preflight.sh"]) expect(implSource(file)).not.toMatch(/production (preview|activate|deactivate)/);
    expect(implSource("restore-terminal-off.sh")).not.toMatch(/production (preview|activate)/);
    expect(implSource("grant.sh").split("\n").filter((line) => /arcadia production activate/.test(line))).toHaveLength(1);
  });

  it("the reset pushes only fixture main without force, commits once, moves local main only by compare-and-swap, and validates before any change", () => {
    const text = implSource("reset.sh");
    const pushes = text.split("\n").filter((line) => /\bpush\b/.test(line) && /\bgit\b|\bfx\b/.test(line) && !line.trim().startsWith("#") && !line.includes("echo") && !/refuse "|RECOVERY=/.test(line));
    expect(pushes).toEqual(['  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main']);
    expect(text.split("\n").filter((line) => /\bcommit -q\b/.test(line))).toHaveLength(1);
    // The only ref-moving Git commands: the compare-and-swap move, the working tree following it, and the compare-and-swap undo.
    const refMoves = text.split("\n").filter((line) => !line.trim().startsWith("#") && !/RECOVERY=/.test(line)
      && /\b(fx|git(\s+-C\s+\S+)?)\s+(update-ref|read-tree|checkout|switch|reset|merge(?!-base)|cherry-pick|branch\s+-[fFdDmM]|tag|symbolic-ref\s+HEAD\s+\S)/.test(line));
    expect(refMoves.map((line) => (line.match(/\bfx (update-ref|read-tree) .*$/) ?? [""])[0].slice(0, 50))).toEqual([
      'fx update-ref -m "$SCRIPT_ID: move local main back',
      'fx read-tree -m -u "$LOCAL_MAIN" "$RESET_HEAD"; th',
      'fx update-ref -m "$SCRIPT_ID: undo the local main '
    ]);
    expect(text).toContain('refs/heads/main "$RESET_HEAD" "$LOCAL_MAIN"');
    expect(text).toContain('fx read-tree -m -u "$LOCAL_MAIN" "$RESET_HEAD"');
    const order = ['< "$RUN_DIR/params.mjs"', '< "$RUN_DIR/reconciliation.mjs"', "check_candidates before", '< "$RUN_DIR/render.mjs"', '< "$RUN_DIR/validate-amendment.mjs"', '< "$RUN_DIR/probe-lineage.mjs"', '< "$RUN_DIR/decide.mjs"', '< "$RUN_DIR/probe-live-sync.mjs"', '< "$RUN_DIR/probe-asks.mjs"', '< "$RUN_DIR/completion-ids.mjs"', 'if [[ "$DRY_RUN" == true ]]; then\n  STAGE=dry_run_report', "fx update-ref", "commit -q -m", "push -q origin", "SYNC=\"$(arcadia docs sync"];
    const at = order.map((marker) => text.indexOf(marker));
    expect(at.every((index) => index > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The workspace is never exported or set, and the receipts override is dry-run only.
    expect(text).not.toMatch(/ARCADIA_WORKSPACE=/);
    expect(text).toContain('[[ "$DRY_RUN" == true ]] || refuse "ARCADIA_REHEARSAL_RECEIPTS_DIR is honoured only by --dry-run');
  });

  it("the reset arranges the queue only through the governed command after docs sync (preview before apply, no database write), and G6 reads the queue and capacity read-only", () => {
    const text = implSource("reset.sh");
    const at = ['arcadia docs sync --project "$FIXTURE_PROJECT" --apply --json', "STAGE=queue_order", "queue arrange --order", '--workspace "$WORKSPACE" --apply --json)'].map((marker) => text.indexOf(marker));
    expect(at.every((index) => index > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The preview call carries no --apply; every arrange passes the verified workspace explicitly and the exact revision.
    const arranges = text.split("\n").filter((line) => /^\s*QUEUE_(PREVIEW|APPLIED)="\$\(arcadia advance queue arrange /.test(line));
    expect(arranges).toHaveLength(2);
    for (const line of arranges) expect(line).toMatch(/--request-id "\$QUEUE_REQUEST_ID" --revision "\$QUEUE_REVISION" --workspace "\$WORKSPACE"/);
    expect(arranges.map((line) => line.includes("--apply"))).toEqual([false, true]);
    expect(text).not.toMatch(/action_queue_(positions|state|receipts)|sqlite3|UPDATE |INSERT |DELETE FROM/);
    const preflight = implSource("preflight.sh");
    expect(preflight).toMatch(/arcadia advance queue --json/);
    expect(preflight).not.toMatch(/arcadia advance queue (arrange|reorder|make-next|undo)/);
    expect(preflight).toContain("observeCodexCapacityLive");
    expect(preflight).not.toContain("observeProviderCapacity");
  });

  it("every implementation binds its launcher exactly as the TypeScript renderer writes it", () => {
    for (const kind of CHAIN_KINDS) {
      const text = implSource(CHAIN_IMPLEMENTATION[kind]);
      expect(text).toContain(`IMPL_FILE="${CHAIN_IMPLEMENTATION[kind]}"`);
      expect(text).toContain('"# Rehearsal chain $RUN_PARAM_ID: runs the shared $IMPL_FILE with this run\'s reviewed parameter file and nothing else."');
    }
  });
});


describe("rehearsal-chain set: launchers", () => {
  it.each(CHAIN_KINDS)("%s: --describe prints the descriptor; another entrypoint, a direct run or another parameter file refuses with nothing written", (kind) => {
    const box = sandbox(RUN6);
    const id = box.ids[kind];
    writeParams(box, RUN6, JSON.parse(readFileSync(path.join(impl, "params", `${RUN6}.json`), "utf8")));
    const described = box.run(id, {}, ["--describe"]);
    expect(described.status, described.stderr).toBe(0);
    expect(JSON.parse(described.stdout)).toEqual(JSON.parse(readFileSync(path.join(library, `${id}.json`), "utf8")));
    expect(box.run(id, {}, ["apply"]).status).toBe(2);
    if (kind !== "reset") expect(box.run(id, {}, ["--dry-run"]).status).toBe(2);
    const direct = spawnSync("bash", [path.join(box.scripts, "rehearsal-chain", CHAIN_IMPLEMENTATION[kind]), path.join(box.root, `${RUN6}.json`), "--describe"], { encoding: "utf8" });
    expect(direct.status).toBe(2);
    expect(direct.stderr).toContain("per-run library launcher");
    // A tampered launcher is not this run's published entry.
    writeFileSync(path.join(box.scripts, `${id}.sh`), readFileSync(path.join(box.scripts, `${id}.sh`), "utf8") + "echo extra\n");
    const tampered = box.run(id, {}, ["--describe"]);
    expect(tampered.status).toBe(2);
    expect(tampered.stderr).toContain("not published in this library");
    expect(box.runDirs()).toEqual([]);
  });
});


// The run-5 set this replaces for new runs stays byte-for-byte as merged.
it("leaves the run-5 set unchanged", () => {
  const expected = spawnSync("git", ["-C", repoRoot, "diff", "--quiet", "HEAD", "--", ...["reset-three-action-rehearsal-fixture", "preflight-three-action-rehearsal", "grant-production-three-action-rehearsal", "restore-terminal-off-three-action-rehearsal"].flatMap((prefix) =>
    ["sh", "json"].map((ext) => `artifacts/generated/operator-scripts/${prefix}-run5-2026-10-06.${ext}`))]);
  expect(expected.status).toBe(0);
  expect(cpSync).toBeTypeOf("function");
});

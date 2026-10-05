import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyPreservedCandidate,
  defaultReconciliationIo,
  type CommandResult,
  type PreservedCandidateInput,
  type ReconciliationIo
} from "../src/operatorActions/preservedCandidateReconciliation.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { ACTION, ASK, NEXT_ACTION, PLAN, PROJECT, buildPreservedCandidate, commit, git, receiptLine, seedSettlement, settle, settlementMessage } from "./helpers/settledCandidate.js";

/**
 * G8's settled-descendant reconciliation, against real Git repositories and a
 * real workspace database; only GitHub is faked, by the two reads it makes.
 */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "arcadia-settled-candidate-"));
  directories.push(directory);
  return directory;
};

const GITHUB = "pmark/arcadia-three-action-rehearsal-t1";
const PR = `https://github.com/${GITHUB}/pull/1`;
const RECEIPT_ID = "asksettle_bb9ebe9310814f3ab1";

interface Remote { branchTip?: string | null; branchStatus?: "ok" | "missing" | "down"; pr?: Record<string, unknown> | "down" }

function setup(build: (repo: string, receipt: string) => { tip: string; seed?: boolean | Partial<Parameters<typeof seedSettlement>[1]> }) {
  const root = temp();
  const repo = path.join(root, "candidate");
  mkdirSync(repo);
  const { receipt } = buildPreservedCandidate(repo);
  const { tip, seed = true } = build(repo, receipt);
  const workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  if (seed) seedSettlement(workspace, { receiptId: RECEIPT_ID, receiptCommit: receipt, documentsCommit: tip, ...(seed === true ? {} : seed) });
  const branch = git(repo, ["branch", "--show-current"]);
  const input: PreservedCandidateInput = {
    workspace, project: PROJECT, actionId: ACTION, repository: repo, worktree: repo, receiptCommit: receipt, tip, branch, pullRequestUrl: PR, githubRepository: GITHUB
  };
  const ghCalls: string[][] = [];
  const io = (remote: Remote = {}): ReconciliationIo => ({
    ...defaultReconciliationIo,
    gh: (args): CommandResult => {
      ghCalls.push(args);
      if (args[0] === "api") {
        if (remote.branchStatus === "down") return { status: 1, stdout: "", stderr: "dial tcp: lookup api.github.com: no such host" };
        if (remote.branchStatus === "missing") return { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
        return { status: 0, stdout: `${remote.branchTip === undefined ? tip : remote.branchTip}\n`, stderr: "" };
      }
      if (remote.pr === "down") return { status: 1, stdout: "", stderr: "HTTP 502" };
      return { status: 0, stdout: JSON.stringify({ url: PR, state: "OPEN", headRefName: branch, headRefOid: tip, isCrossRepository: false, ...remote.pr }), stderr: "" };
    }
  });
  return { repo, receipt, tip, input, io, ghCalls, workspace };
}

const settled = (repo: string, receipt: string) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID }) });

describe("G8 settled-descendant reconciliation of a preserved candidate", () => {
  it("reconciles a tip that is exactly the preservation receipt's commit, without reading GitHub", () => {
    const box = setup((_repo, receipt) => ({ tip: receipt, seed: false }));
    expect(classifyPreservedCandidate(box.input, box.io())).toEqual({ reconciled: true, basis: "exact_tip", tip: box.receipt });
    expect(box.ghCalls).toEqual([]);
  });

  it("reconciles exactly one recorded accepted-completion settlement on top of the receipt commit, remotely at that tip", () => {
    const box = setup(settled);
    const result = classifyPreservedCandidate(box.input, box.io());
    expect(result).toMatchObject({
      reconciled: true, basis: "settled_descendant", tip: box.tip, receiptCommit: box.receipt,
      settlement: { commit: box.tip, receiptId: RECEIPT_ID, plan: PLAN, archivedAsks: [`.arcadia/asks/archive/${path.basename(ASK)}`] },
      remote: { pullRequest: PR }
    });
    expect(box.ghCalls.map((args) => args.slice(0, 2).join(" "))).toEqual([`api repos/${GITHUB}/git/ref/heads/${box.input.branch}`, `pr view`]);
  });

  it("accepts the Action id in its project-qualified form", () => {
    const box = setup(settled);
    expect(classifyPreservedCandidate({ ...box.input, actionId: `${PROJECT}/${ACTION}` }, box.io())).toMatchObject({ reconciled: true, basis: "settled_descendant" });
  });

  it.each<[string, (repo: string, receipt: string) => { tip: string; seed?: boolean | Partial<Parameters<typeof seedSettlement>[1]> }, Remote, Partial<PreservedCandidateInput>, string]>([
    ["a dirty tip", (repo, receipt) => {
      const tip = settle(repo, receipt, { receiptId: RECEIPT_ID });
      writeFileSync(path.join(repo, "MARKER.md"), "edited\n");
      return { tip };
    }, {}, {}, "dirty_tip"],
    ["an untracked file in the worktree", (repo, receipt) => {
      const tip = settle(repo, receipt, { receiptId: RECEIPT_ID });
      writeFileSync(path.join(repo, "stray.txt"), "x\n");
      return { tip };
    }, {}, {}, "dirty_tip"],
    ["a code-changing settlement", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID, extra: (r) => { mkdirSync(path.join(r, "src")); writeFileSync(path.join(r, "src", "x.ts"), "export {};\n"); } }) }), {}, {}, "code_changing_descendant"],
    ["an executable governed record", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID, extra: (r) => chmodSync(path.join(r, "MISSION_LOG.md"), 0o755) }) }), {}, {}, "code_changing_descendant"],
    ["an arbitrary descendant with no settlement receipt", (repo) => {
      writeFileSync(path.join(repo, "MARKER.md"), "three-action rehearsal start\nmore\n");
      return { tip: commit(repo, "more work") };
    }, {}, {}, "settlement_receipt_missing"],
    ["a receipt line not in the governed form", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID, message: `chore: settle\n\nWritten by arcadia agent-ask settle --apply (${RECEIPT_ID}).` }) }), {}, {}, "settlement_receipt_missing"],
    ["a forged receipt line the workspace never wrote", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: "asksettle_f0f0f0f0f0f0f0f0f0" }) }), {}, {}, "settlement_receipt_forged"],
    ["two different receipt lines in one commit", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID, message: `${settlementMessage(RECEIPT_ID)}\n${receiptLine("asksettle_000000000000000000")}` }) }), {}, {}, "settlement_receipt_forged"],
    ["two settlements", (repo, receipt) => {
      settle(repo, receipt, { receiptId: RECEIPT_ID });
      writeFileSync(path.join(repo, "MISSION_LOG.md"), `# Mission Log\n\n## 2026-10-04 settled ${ACTION}\n\n- Marked ${ACTION} done.\n- again\n`);
      return { tip: commit(repo, settlementMessage("asksettle_222222222222222222")) };
    }, {}, {}, "not_exactly_one_settlement"],
    ["a merge on top of the receipt", (repo, receipt) => {
      git(repo, ["checkout", "-q", "-b", "side", receipt]);
      writeFileSync(path.join(repo, "MISSION_LOG.md"), "# Mission Log\n");
      commit(repo, "side");
      git(repo, ["checkout", "-q", "-"]);
      settle(repo, receipt, { receiptId: RECEIPT_ID });
      git(repo, ["merge", "-q", "--no-edit", "-X", "ours", "side", "-m", settlementMessage(RECEIPT_ID)]);
      return { tip: git(repo, ["rev-parse", "HEAD"]) };
    }, {}, {}, "merge_commit"],
    ["a settlement that completes nothing", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID, completes: false }) }), {}, {}, "not_a_completion"],
    ["a settlement completing a different Action than the Session's", settled, {}, { actionId: NEXT_ACTION }, "not_a_completion"],
    ["a settlement edit beyond the governed shape", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID, extra: (r) => writeFileSync(path.join(r, "PROJECT.md"), "---\narcadia: v1\nstatus: paused\n---\n") }) }), {}, {}, "settlement_shape_invalid"],
    ["a rejected settlement", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID }), seed: { disposition: "rejected" } }), {}, {}, "settlement_mismatch"],
    ["a settlement recorded for another documents commit", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID }), seed: { documentsCommit: receipt } }), {}, {}, "settlement_mismatch"],
    ["a settlement bound to another candidate revision", (repo, receipt) => ({ tip: settle(repo, receipt, { receiptId: RECEIPT_ID }), seed: { receiptCommit: "a".repeat(40) } }), {}, {}, "settlement_mismatch"],
    ["a tip that does not descend from the receipt", (repo, receipt) => {
      git(repo, ["checkout", "-q", "-b", "diverged", `${receipt}~1`]);
      writeFileSync(path.join(repo, "MARKER.md"), "other\n");
      return { tip: commit(repo, "diverged") };
    }, {}, {}, "not_a_descendant"],
    ["a local-only settlement whose remote branch is still at the receipt commit", settled, { branchTip: "RECEIPT" }, {}, "local_only_tip"],
    ["a local-only branch that does not exist remotely", settled, { branchStatus: "missing" }, {}, "local_only_tip"],
    ["a remote branch at another commit", settled, { branchTip: "b".repeat(40) }, {}, "remote_branch_mismatch"],
    ["a pull request at another head", settled, { pr: { headRefOid: "c".repeat(40) } }, {}, "pull_request_mismatch"],
    ["a pull request from another branch", settled, { pr: { headRefName: "other" } }, {}, "pull_request_mismatch"],
    ["a closed pull request", settled, { pr: { state: "CLOSED" } }, {}, "pull_request_mismatch"],
    ["a cross-repository pull request", settled, { pr: { isCrossRepository: true } }, {}, "pull_request_mismatch"],
    ["a pull request in another repository", settled, {}, { pullRequestUrl: "https://github.com/pmark/other/pull/1" }, "pull_request_mismatch"],
    ["an unreadable remote branch", settled, { branchStatus: "down" }, {}, "remote_unobservable"],
    ["an unreadable pull request", settled, { pr: "down" }, {}, "remote_unobservable"]
  ])("refuses %s with a named reason", (_label, build, remote, override, reason) => {
    const box = setup(build);
    const resolved = remote.branchTip === "RECEIPT" ? { ...remote, branchTip: box.receipt } : remote;
    const result = classifyPreservedCandidate({ ...box.input, ...override }, box.io(resolved));
    expect(result, JSON.stringify(result)).toMatchObject({ reconciled: false, reason });
    expect((result as { detail: string }).detail.length).toBeGreaterThan(10);
  });

  it("refuses an unreadable workspace as unverifiable, never as reconciled", () => {
    const box = setup(settled);
    expect(classifyPreservedCandidate({ ...box.input, workspace: path.join(box.workspace, "missing") }, box.io())).toMatchObject({ reconciled: false, reason: "settlement_unverifiable" });
  });

  it("reads the candidate without changing it", () => {
    const box = setup(settled);
    const before = [git(box.repo, ["rev-parse", "HEAD"]), git(box.repo, ["status", "--porcelain"]), git(box.repo, ["for-each-ref"])];
    classifyPreservedCandidate(box.input, box.io());
    expect([git(box.repo, ["rev-parse", "HEAD"]), git(box.repo, ["status", "--porcelain"]), git(box.repo, ["for-each-ref"])]).toEqual(before);
  });
});

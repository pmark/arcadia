import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { autoSettleRequestId } from "../src/ask/autoSettleRequestId.js";
import { classifyPatchApplicability, evaluateNotApplicableClaims, retiredCompletionDraftMessage } from "../src/qa/patchApplicability.js";

/**
 * A review repair's candidate as the worker builds it (src/sessions/launch.ts,
 * PR #1539): the failed candidate's preserved work and drafted `complete` Ask,
 * the host's retirement of that draft, the repair's own preserved change and
 * draft, and the worker's auto-settle settlement archiving the new draft. The
 * patch check must classify every governed record here as governed, so a
 * reviewer's not-applicable claims on a docs-only repair are not refused, while
 * any other deletion of a governed record still refuses.
 */
const CONTROLLER = { GIT_AUTHOR_NAME: "Arcadia Controller", GIT_AUTHOR_EMAIL: "controller@arcadia.local", GIT_COMMITTER_NAME: "Arcadia Controller", GIT_COMMITTER_EMAIL: "controller@arcadia.local" };
const AGENT = { GIT_AUTHOR_NAME: "Fixture Agent", GIT_AUTHOR_EMAIL: "agent@example.invalid", GIT_COMMITTER_NAME: "Fixture Agent", GIT_COMMITTER_EMAIL: "agent@example.invalid" };
const PRESERVE = (id: string) => `chore(candidate): preserve write-report candidate for handoff\n\nArcadia-Preservation-Request: worker-tick-preserve-${id}\nArcadia-Candidate-Fingerprint: 53c8959eac217fe84913019f06606df892f600a5`;
const SETTLE = "chore(arcadia): settle\n\nWritten by `arcadia agent-ask settle --apply` (asksettle_87c45d13c37c4c55a0).";
const REPORT = "docs/reports/first-supervised-claude-run-2026-10-18.md";
const PLAN = "docs/plans/fixture-plan.md";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function repository() {
  const repo = realpathSync(mkdtempSync(path.join(tmpdir(), "repair-patch-")));
  roots.push(repo);
  const git = (args: string[], env: Record<string, string> = AGENT) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } }).trim();
  const write = (file: string, content: string) => { mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); writeFileSync(path.join(repo, file), content); };
  git(["init", "-q", "-b", "main"]);
  write("PROJECT.md", "---\ntitle: Fixture\nactive_plan: fixture-plan\ncurrent_action: write-report\nupdated: 2026-10-18\n---\n\n# Fixture\n");
  write("MISSION_LOG.md", "# Mission Log\n\n- Started.\n");
  write(PLAN, [
    "---", "title: Fixture plan", "status: active", "actions:",
    "  - id: write-report", "    title: Write the report.", "    status: open", "    responsibility: agent", "    next_action: Write the report.", "    clarification: clarified",
    "  - id: next-step", "    title: Next step.", "    status: open", "    responsibility: agent", "    next_action: Next step.", "    clarification: clarified",
    "current_action: write-report", "---", "", "# Fixture plan", ""
  ].join("\n"));
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "genesis"]);
  return { repo, git, write };
}

const ask = (requestId: string, candidate: string, targetRef = "action/write-report", options: { pretty?: boolean; note?: string } = {}) => `${JSON.stringify({
  agent_ask: "v1", request_id: requestId, project: "fixture", intent: "complete", target_ref: targetRef, candidate_revision: candidate,
  evidence: [{ criterion: "The report exists.", status: "met", note: options.note ?? "Wrote the report and read it back." }], desired_result: "Mark write-report complete."
}, null, options.pretty ? 2 : undefined)}\n`;

/**
 * How the settlement archives the repair's draft. `rename`: git shows a
 * rename. `split`: the draft is pretty-printed JSON and the archive its compact
 * re-serialization with the bound revision, so git shows a deletion and a new
 * file (live PR #1554). The other values are forged variants of `split`.
 */
type ArchiveShape = "rename" | "split" | "split-altered" | "split-no-archive" | "split-other-name" | "split-ungoverned";

interface Repair { retire?: { env?: Record<string, string>; message?: (ids: string[]) => string; extra?: string; target?: string }; deleteRecord?: string; archive?: ArchiveShape }

/** The failed work, the host retirement, the repair's change and its settlement; returns the format-patch series. */
function repairedHead(options: Repair = {}): { patch: string; base: string } {
  const { git, write } = repository();
  const base = git(["rev-parse", "HEAD"]);
  const draftA = `.arcadia/asks/agent-ask-complete-write-report-${base.slice(0, 12)}.yaml`;
  const idA = `complete-write-report-${base.slice(0, 12)}`;
  write(REPORT, "# Report\n\nRun stages.\n");
  write(draftA, ask(idA, base, options.retire?.target));
  git(["add", "-A"]);
  git(["commit", "-q", "-m", PRESERVE("failed")], CONTROLLER);
  // The host retirement of the failed candidate's own draft.
  git(["rm", "-q", draftA]);
  if (options.retire?.extra) git(["rm", "-q", options.retire.extra]);
  git(["commit", "-q", "-m", (options.retire?.message ?? ((ids) => retiredCompletionDraftMessage("write-report", ids)))([idA])], options.retire?.env ?? CONTROLLER);
  const retired = git(["rev-parse", "HEAD"]);
  if (options.deleteRecord) {
    git(["rm", "-q", options.deleteRecord]);
    git(["commit", "-q", "-m", retiredCompletionDraftMessage("write-report", [idA])], CONTROLLER);
  }
  // The repair Session's change, preserved with its own draft.
  const draftB = `.arcadia/asks/agent-ask-complete-write-report-${retired.slice(0, 12)}.yaml`;
  write(REPORT, "# Report\n\nRun stages, including #1512.\n");
  const shape = options.archive ?? "rename";
  const split = shape !== "rename";
  write(draftB, ask(`complete-write-report-${retired.slice(0, 12)}`, retired, undefined, { pretty: split }));
  git(["add", "-A"]);
  git(["commit", "-q", "-m", PRESERVE("repair")], CONTROLLER);
  const preserved = git(["rev-parse", "HEAD"]);
  // The worker's auto-settle settlement.
  const archive = `.arcadia/asks/archive/${shape === "split-other-name" ? "agent-ask-complete-write-report-other.yaml" : path.basename(draftB)}`;
  mkdirSync(path.join(roots.at(-1)!, ".arcadia/asks/archive"), { recursive: true });
  if (split) git(["rm", "-q", draftB]);
  else git(["mv", draftB, archive]);
  if (shape === "split-ungoverned") git(["commit", "-q", "-m", "chore: tidy the asks"]);
  const archived = ask(`complete-write-report-${retired.slice(0, 12)}`, preserved, undefined,
    { note: shape === "split-altered" ? "Wrote the report, read it back and approved it." : undefined });
  if (shape !== "split-no-archive") write(archive, archived);
  const requestId = autoSettleRequestId("fixture", "write-report", archived);
  const repo = roots.at(-1)!;
  write(PLAN, readFileSync(path.join(repo, PLAN), "utf8")
    .replace("    status: open\n    responsibility: agent\n    next_action: Write the report.", `    status: done\n    responsibility: agent\n    next_action: Completed via Agent Ask ${requestId}; no further action.`)
    .replace("current_action: write-report", "current_action: next-step"));
  write("PROJECT.md", readFileSync(path.join(repo, "PROJECT.md"), "utf8").replace("current_action: write-report", "current_action: next-step"));
  write("MISSION_LOG.md", `${existsSync(path.join(repo, "MISSION_LOG.md")) ? readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8") : ""}- Completed write-report (Agent Ask ${requestId}).\n`);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", SETTLE]);
  return { patch: git(["format-patch", "--stdout", `${base}..HEAD`]), base };
}

const authority = (patch: string) => classifyPatchApplicability(patch).files.filter((file) => file.class !== "inert-document" && file.class !== "governed-record");

describe("the deterministic patch check on a review repair's candidate", () => {
  it("classifies the failed draft's host retirement and the repair's settlement as governed records, and accepts docs-only not-applicable claims", () => {
    const { patch } = repairedHead();
    const result = classifyPatchApplicability(patch);
    expect(result.problems).toEqual([]);
    expect(authority(patch)).toEqual([]);
    expect(result.inert).toBe(true);
    const claim = (criterion: string, name: string) => ({ criterion, name, status: "not-applicable",
      evidence: `Only ${REPORT} and the governed settlement records change; this prose cannot affect ${name.toLowerCase()} at all.` });
    const evaluation = evaluateNotApplicableClaims(
      [claim("failure-handling", "Failure handling"), claim("state-and-concurrency", "State and concurrency"), claim("security-and-authority", "Security and authority"), claim("compatibility", "Compatibility"), claim("tests", "Tests")],
      result);
    expect(evaluation.refused).toEqual([]);
    expect(evaluation.accepted).toHaveLength(5);
  });

  it("still refuses a deletion by a commit without the retirement trailer", () => {
    const flagged = authority(repairedHead({ retire: { message: () => "chore: drop a draft" } }).patch);
    expect(flagged.map((file) => file.reason).join(" ")).toMatch(/may not be copied or deleted|outside an attested/);
    expect(flagged.some((file) => file.path.includes("agent-ask-complete-write-report-"))).toBe(true);
  });

  it("still refuses the same retirement by a non-controller identity", () => {
    expect(authority(repairedHead({ retire: { env: AGENT } }).patch).some((file) => file.path.includes("agent-ask-complete-write-report-"))).toBe(true);
  });

  it("still refuses a retirement commit that also deletes a path other than a completion draft", () => {
    const flagged = authority(repairedHead({ retire: { extra: REPORT } }).patch);
    expect(flagged.some((file) => file.path.includes("agent-ask-complete-write-report-"))).toBe(true);
  });

  it("still refuses a deleted governed record (not a draft) in a commit carrying the retirement trailer", () => {
    const flagged = authority(repairedHead({ deleteRecord: "MISSION_LOG.md" }).patch);
    expect(flagged.map((file) => file.path)).toEqual(expect.arrayContaining(["MISSION_LOG.md"]));
  });

  it("still refuses retiring a draft that completes another Action", () => {
    const flagged = authority(repairedHead({ retire: { target: "action/next-step" } }).patch);
    expect(flagged.some((file) => file.path.includes("agent-ask-complete-write-report-") && /Action this patch marks done/.test(file.reason))).toBe(true);
  });

  it("still refuses a trailer naming a request id the deleted draft does not carry", () => {
    const flagged = authority(repairedHead({ retire: { message: () => retiredCompletionDraftMessage("write-report", ["complete-someone-else"]) } }).patch);
    expect(flagged.some((file) => file.path.includes("agent-ask-complete-write-report-"))).toBe(true);
  });

  it("classifies a settlement that archives a re-serialized draft as a deletion plus its archive copy as governed records (#1556, live PR #1554)", () => {
    const { patch } = repairedHead({ archive: "split" });
    expect(patch).toMatch(/deleted file mode 100644\nindex [0-9a-f]+\.\.0+\n--- a\/\.arcadia\/asks\/agent-ask-complete-write-report-/);
    const result = classifyPatchApplicability(patch);
    expect(result.problems).toEqual([]);
    expect(authority(patch)).toEqual([]);
    expect(result.inert).toBe(true);
  });

  it.each([
    ["an archive copy whose content differs beyond candidate_revision", "split-altered"],
    ["a deleted draft with no archive copy", "split-no-archive"],
    ["an archive copy under another name", "split-other-name"],
    ["a deletion by a commit that carries no attestation", "split-ungoverned"]
  ] as const)("still refuses %s", (_label, archive) => {
    const flagged = authority(repairedHead({ archive }).patch);
    expect(flagged.some((file) => /^\.arcadia\/asks\/agent-ask-complete-write-report-/.test(file.path))).toBe(true);
  });
});

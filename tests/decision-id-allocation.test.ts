import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBatchMergeCard, requestFromSpec, runBatchMerge, type BatchMergeGateway, type BatchPrFacts, type BatchReceipt } from "../src/decisions/batchMerge.js";
import {
  allocateDecisionId, decisionIdClashRefusal, describeDecisionIdClash, findDecisionIdClashes, GRANDFATHERED_DUPLICATE_IDS, systemDecisionGit
} from "../src/decisions/decisionIds.js";
import { nextDecisionId } from "../src/production/startRunSignIn.js";

const git = (cwd: string, args: string[]): string => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
const decision = (id: string, slug: string): string => `docs/decisions/${id}-${slug}.md`;

describe("Decision id allocation and duplicate refusal", () => {
  let root: string;
  let origin: string;
  let candidate: string;
  let main: string;

  function clone(name: string): string {
    const dir = path.join(root, name);
    git(root, ["clone", "-q", origin, dir]);
    git(dir, ["config", "user.name", "Fixture"]);
    git(dir, ["config", "user.email", "fixture@example.invalid"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    return dir;
  }
  function commitFile(repo: string, file: string, branch?: string): string {
    if (branch) git(repo, ["checkout", "-q", "-b", branch]);
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), `---\nid: x\n---\n${file}\n`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", `add ${file}`]);
    return git(repo, ["rev-parse", "HEAD"]).trim();
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "decision-ids-")));
    origin = path.join(root, "origin.git");
    git(root, ["init", "-q", "--bare", "-b", "main", origin]);
    main = path.join(root, "seed");
    mkdirSync(main);
    git(main, ["init", "-q", "-b", "main"]);
    git(main, ["config", "user.name", "Fixture"]);
    git(main, ["config", "user.email", "fixture@example.invalid"]);
    git(main, ["config", "commit.gpgsign", "false"]);
    git(main, ["remote", "add", "origin", origin]);
    commitFile(main, decision("0249", "latest"));
    git(main, ["push", "-q", "origin", "main"]);
    candidate = clone("candidate");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("the 0250 race: an Ask settle candidate behind origin main gets N+1, not the id a START sign-in minted on main", () => {
    // The sign-in mints 0250 on main from another checkout; the candidate's tree is still at 0249.
    commitFile(main, decision("0250", "start-sign-in-usage-check"));
    git(main, ["push", "-q", "origin", "main"]);
    expect(allocateDecisionId(candidate)).toBe("0251");
    // A checkout with no remote has only its own tree: that is the race this closes.
    const offline = path.join(root, "offline");
    mkdirSync(offline);
    git(offline, ["init", "-q", "-b", "main"]);
    commitFile(offline, decision("0249", "latest"));
    expect(allocateDecisionId(offline)).toBe("0250");
    // Writing the candidate's Decision at the allocated id leaves no two files on one id.
    commitFile(candidate, decision(allocateDecisionId(candidate), "ask-settle"));
    git(candidate, ["pull", "-q", "--no-rebase", "origin", "main"]);
    const files = git(candidate, ["ls-files", "docs/decisions"]).split("\n").filter(Boolean);
    expect(findDecisionIdClashes(files, { grandfathered: [] })).toEqual([]);
  });

  it("START sign-in ids come from origin main and a concurrent open PR's Decision neither blocks nor collides with them", () => {
    const prHead = commitFile(candidate, decision("0250", "open-pr-decision"), "claude/open-pr");
    git(candidate, ["push", "-q", "origin", "claude/open-pr"]);
    const signIn = clone("signin");
    expect(nextDecisionId(signIn)).toBe("0250");
    // Sign-in's Decision reaches main first; the PR is then the one refused at its merge, naming both files.
    commitFile(signIn, decision("0250", "start-sign-in-usage-check"));
    git(signIn, ["push", "-q", "origin", "main"]);
    const refusal = decisionIdClashRefusal(systemDecisionGit(candidate), prHead);
    expect(refusal).toContain(decision("0250", "open-pr-decision"));
    expect(refusal).toContain(decision("0250", "start-sign-in-usage-check"));
  });

  it("the check fails a pull request that adds an id its base already has, naming both files; the historical pairs are grandfathered and a fifth pair fails", () => {
    const names = [decision("0100", "a"), decision("0100", "b"), decision("0300", "x")];
    expect(findDecisionIdClashes(names)).toEqual([]);
    const fifth = findDecisionIdClashes([...names, decision("0300", "y")]);
    expect(fifth.map(describeDecisionIdClash)).toEqual([`Decision id 0300 is carried by ${decision("0300", "x")} and ${decision("0300", "y")}`]);
    // A third file on a grandfathered id is not grandfathered.
    expect(findDecisionIdClashes([...names, decision("0100", "c")]).map((c) => c.id)).toEqual(["0100"]);
    expect(GRANDFATHERED_DUPLICATE_IDS).toEqual(["0004", "0005", "0079", "0100", "0191"]);
    // Only what the PR adds is judged.
    expect(findDecisionIdClashes([decision("0300", "x"), decision("0300", "y"), decision("0301", "z")], { added: [decision("0301", "z")] })).toEqual([]);
  });

  it("two pull requests adding id N against one base: the second is refused after the first merges (batch merge path)", () => {
    const heads = [1, 2].map((n) => {
      git(candidate, ["checkout", "-q", "main"]);
      return commitFile(candidate, decision("0250", `pr-${n}`), `claude/pr-${n}`);
    });
    for (const n of [1, 2]) git(candidate, ["push", "-q", "origin", `claude/pr-${n}`]);
    const prs: BatchPrFacts[] = heads.map((head, i) => ({
      number: i + 1, title: `PR ${i + 1}`, headSha: head, baseRef: "main", headRef: `claude/pr-${i + 1}`, files: [{ filename: decision("0250", `pr-${i + 1}`), previous_filename: null }] as never,
      why: "Needs the operator.", decisions: [], reviews: [{ verdict: "APPROVED", headSha: head }], checks: [{ name: "ci", conclusion: "SUCCESS" }],
      requiredChecks: ["ci"], state: "open", changedFiles: 1
    }));
    const built = buildBatchMergeCard({ prs, now: new Date("2026-10-12T12:00:00Z"), expires: "2026-10-13T12:00:00Z", acknowledgedBoundaries: { 1: ["decisions"], 2: ["decisions"] } });
    if (!built.ok) throw new Error(`build refused: ${built.refusal.code}`);
    const live = new Map(prs.map((p) => [p.number, { ...p }]));
    const receipts = new Map<string, BatchReceipt>();
    const gitHere = systemDecisionGit(candidate);
    const gateway: BatchMergeGateway = {
      readPr: (n) => live.get(n) ?? null,
      readReceipt: (c, n) => receipts.get(`${c}:${n}`) ?? null,
      writeReceipt: (r) => { receipts.set(`${r.cardId}:${r.number}`, r); },
      decisionIdClash: (_n, head) => decisionIdClashRefusal(gitHere, head),
      merge: (n, head) => {
        // What GitHub does: the PR's commits land on origin main.
        git(main, ["fetch", "-q", "origin", `claude/pr-${n}`]);
        git(main, ["merge", "-q", "--no-ff", "-m", `merge ${n}`, head]);
        git(main, ["push", "-q", "origin", "main"]);
        const p = live.get(n)!;
        p.state = "merged";
        p.mergedHeadSha = head;
      }
    };
    const result = runBatchMerge(built.spec, requestFromSpec(built.spec), gateway, new Date("2026-10-12T12:00:00Z"));
    expect(result.merged).toEqual([1]);
    expect(result.outcome).toBe("stopped");
    expect(result.refusals[0]).toMatchObject({ code: "decision_id_duplicate", number: 2 });
    expect(result.refusals[0].message).toContain(decision("0250", "pr-1"));
    expect(result.refusals[0].message).toContain(decision("0250", "pr-2"));
  });
});

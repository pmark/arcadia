import type { CandidatePreservationRemote } from "../../../src/sessions/candidatePreservation.js";
import type { QaPrReviewDependencies } from "../../../src/qa/prReview.js";
import { git, type FakeGitHub, type FakePullRequest } from "../../helpers/rehearsalHarness.js";
import type { PhaseRecorder } from "./report.js";

type RunCommand = NonNullable<QaPrReviewDependencies["runCommand"]>;

/** One `files` entry the way `gh pr view --json files` reports it. */
export interface GitHubFile { path: string; additions: number; deletions: number; changeType: string }

/**
 * GitHub, as the fast harness models it: the shared {@link FakeGitHub}
 * (`tests/helpers/rehearsalHarness.ts`: real pushes to a local bare remote,
 * draft and ready state, checks, stubbed reviewer model) with the two facts
 * the shared fake simplifies reported the way GitHub reports them:
 *
 * - `baseRefName` is the branch the PR was opened against (`gh pr create
 *   --base`): the Project base, or a stacked base such as the previous
 *   candidate's branch. `baseRefOid` is that branch's tip on the remote and
 *   `files` is the three-dot diff of the PR head against it (GitHub's "Files
 *   changed"), computed with real Git in the bare remote. The worker
 *   integrates by local fast-forward and never pushes the base, so after
 *   Action 1 integrates the remote's `main` does not move; Action 2's PR is
 *   therefore stacked on Action 1's branch (Issue #987), and a PR on `main`
 *   would report Action 1's files too.
 * - `body` is the exact body the host's preservation wrote (the rendered
 *   Operator QA plan and validation evidence), so a scenario can compare
 *   what the plan says with what the PR reports.
 *
 * Every other `gh` call and every reviewer-model call goes to the shared fake
 * unchanged. Timings of every call are recorded into the scenario report.
 */
export class GitHubModel {
  /** The latest body the host wrote for each PR URL. */
  readonly bodies = new Map<string, string>();
  /** Every `gh pr view` this model answered, with the base and files it reported. */
  readonly views: Array<{ url: string; baseRefOid: string; headRefOid: string; files: string[] }> = [];

  constructor(readonly fake: FakeGitHub, private readonly recorder: PhaseRecorder) {}

  get prs(): FakePullRequest[] {
    return this.fake.prs;
  }

  readonly remote: CandidatePreservationRemote = {
    hasRemote: (repositoryPath) => this.fake.remote.hasRemote(repositoryPath),
    push: (input) => this.recorder.measure("gitFinalization", () => this.fake.remote.push(input)),
    listBranchTips: (input) => this.fake.remote.listBranchTips!(input),
    findPullRequest: (input) => this.fake.remote.findPullRequest(input),
    upsertDraftPullRequest: (input) => this.recorder.measure("gitFinalization", () => {
      const pr = this.fake.remote.upsertDraftPullRequest(input);
      this.bodies.set(pr.url, input.body);
      return pr;
    })
  };

  readonly runCommand: RunCommand = (input) => this.recorder.measure("review", () => {
    const { command, args } = input;
    const isView = command === "gh" && args[0] === "pr" && args[1] === "view" && args[args.indexOf("--json") + 1] !== "commits";
    if (!isView || this.fake.viewFailures.length > 0) return this.fake.runCommand(input);
    const pr = this.fake.prs.find((entry) => entry.url === args[2] || String(entry.number) === args[2]);
    if (!pr) return this.fake.runCommand(input);
    this.fake.ghCalls.push(`gh ${args.join(" ")}`);
    const view = this.view(pr);
    this.views.push({ url: pr.url, baseRefOid: view.baseRefOid, headRefOid: view.headRefOid, files: view.files.map((file) => file.path) });
    return { status: 0, stdout: `${JSON.stringify(view)}\n`, stderr: "", error: null };
  });

  /** The PR as `gh pr view --json ...` reports it. */
  view(pr: FakePullRequest) {
    const headRefOid = this.fake.headOf(pr.branch);
    const baseRefOid = this.fake.headOf(pr.baseBranch);
    return {
      number: pr.number,
      title: `Candidate ${pr.branch}`,
      url: pr.url,
      state: pr.state ?? "OPEN",
      isDraft: pr.isDraft,
      mergeStateStatus: this.fake.mergeState(pr),
      headRefName: pr.branch,
      headRefOid,
      baseRefName: pr.baseBranch,
      baseRefOid,
      body: this.bodies.get(pr.url) ?? "",
      files: this.files(baseRefOid, headRefOid),
      statusCheckRollup: this.fake.checks(pr)
    };
  }

  /** GitHub's "Files changed": the head against its merge base with the base branch tip. */
  files(baseRefOid: string, headRefOid: string): GitHubFile[] {
    const range = `${baseRefOid}...${headRefOid}`;
    const status = git(this.fake.origin, ["-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", range]).split("\n").filter(Boolean);
    const numstat = git(this.fake.origin, ["-c", "core.quotePath=false", "diff", "--numstat", "--no-renames", range]).split("\n").filter(Boolean);
    const counts = new Map(numstat.map((line) => {
      const [additions, deletions, file] = line.split("\t");
      return [file, { additions: Number(additions) || 0, deletions: Number(deletions) || 0 }];
    }));
    const changeType: Record<string, string> = { A: "ADDED", M: "MODIFIED", D: "DELETED" };
    return status.map((line) => {
      const [code, file] = line.split("\t");
      return { path: file, ...(counts.get(file) ?? { additions: 0, deletions: 0 }), changeType: changeType[code[0]] ?? "CHANGED" };
    });
  }
}

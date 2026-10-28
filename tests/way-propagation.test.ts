import { AGENTS_SECTION_END, AGENTS_SECTION_START, readAgentsContextBlock, setupArcadiaProjectContext } from "../src/projects/contextSetup.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { computeWayPropagationPlan, declinesAutomaticUpgrades, readUpgradePolicy } from "../src/projects/wayPropagation.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { runWayPropagation, type CommandResult, type CommandRunner } from "../src/projects/wayPropagate.js";
import { GUIDANCE_FINGERPRINTS, GUIDANCE_INDEX, guidanceEntries, guidanceFingerprint, renderGuidanceIndex } from "../src/projects/agentGuidance.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalConstitution = readFileSync(path.join(repoRoot, "CONSTITUTION.md"), "utf8");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-way-propagation-repo-"));
  roots.push(repo);
  return repo;
}

/** Writes a repository whose adopted files exactly match Arcadia's own canonical text. */
function writeCurrentAdoption(repo: string): void {
  setupArcadiaProjectContext({ repoPath: repo });
}

describe("computeWayPropagationPlan", () => {
  it("reports no changes for a repository that is already current", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);

    const plan = computeWayPropagationPlan(repo);

    expect(plan.changes).toEqual([]);
    expect(plan.hasMechanicalChanges).toBe(false);
    expect(plan.hasGoverningChanges).toBe(false);
  });

  it("classifies a drifted AGENTS.md region and CLAUDE.md as mechanical", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    writeFileSync(path.join(repo, "CLAUDE.md"), "stale\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.hasMechanicalChanges).toBe(true);
    expect(plan.hasGoverningChanges).toBe(false);
    expect(plan.changes.map((change) => change.path).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(plan.changes.every((change) => change.tier === "mechanical")).toBe(true);
  });

  it("classifies a drifted CONSTITUTION.md as governing", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "stale constitution\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.hasGoverningChanges).toBe(true);
    expect(plan.hasMechanicalChanges).toBe(false);
    expect(plan.changes).toEqual([{ path: "CONSTITUTION.md", tier: "governing", action: "write", content: canonicalConstitution }]);
  });

  it("reports both tiers when a run would touch mechanical and governing files together", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "stale constitution\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.hasMechanicalChanges).toBe(true);
    expect(plan.hasGoverningChanges).toBe(true);
  });

  it("reports a CLAUDE.md holding project-authored content as unmanageable rather than overwriting it", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "CLAUDE.md"), "# Our own instructions\n\nDo not touch.\n", "utf8");

    const plan = computeWayPropagationPlan(repo);

    expect(plan.unmanageable).toEqual([
      {
        path: "CLAUDE.md",
        tier: "mechanical",
        action: "unmanageable",
        content: null,
        reason: expect.any(String)
      }
    ]);
    expect(plan.changes.some((change) => change.path === "CLAUDE.md" && change.action === "write")).toBe(false);
  });

  it("limits learning-only adoption to the existing Learn bootstrap and retrieval resources", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    const agentsPath = path.join(repo, "AGENTS.md");
    const indexPath = path.join(repo, "docs/agent-guidance/index.json");
    const old = [
      "**Before implementation, repair, validation or handoff**, search the Project's",
      "`docs/notes-to-self.md` with targeted `rg` for commands, subsystem and symptoms;",
      "read matches and evidence first. Repeat on each new failure. Report a missing",
      "notes file. Preserve failed receipts, correct verified remedies and convert",
      "recurring friction into source fixes or meaningful guards; do not create a",
      "second memory store or treat an inference as operator preference."
    ].join("\n");
    const legacyContext = readAgentsContextBlock()
      .replace(/\*\*Before implementation, repair, validation or handoff\*\*[\s\S]*?Retrieve lessons on demand; Notes is the bounded verified hot cache\./, old);
    writeFileSync(agentsPath, ["# AGENTS", "", AGENTS_SECTION_START, legacyContext, AGENTS_SECTION_END, ""].join("\n"), "utf8");
    const fingerprintsPath = path.join(repo, GUIDANCE_FINGERPRINTS);
    const fingerprints = JSON.parse(readFileSync(fingerprintsPath, "utf8")) as { fingerprints: Record<string, string> };
    fingerprints.fingerprints.learning = "0".repeat(64);
    writeFileSync(fingerprintsPath, `${JSON.stringify(fingerprints, null, 2)}\n`, "utf8");
    rmSync(path.join(repo, "docs/agent-guidance/learning.md"));

    const plan = computeWayPropagationPlan(repo, null, { learningOnly: true });

    expect(plan.changes.map((change) => change.path).sort()).toEqual(["AGENTS.md", GUIDANCE_FINGERPRINTS, "docs/agent-guidance/learning.md"]);
    expect(plan.unmanageable).toEqual([]);
    const learning = plan.changes.find((change) => change.path === "docs/agent-guidance/learning.md");
    const planned = plan.changes.find((change) => change.path === GUIDANCE_FINGERPRINTS);
    const entries = guidanceEntries(readFileSync(indexPath, "utf8"), planned?.content ?? null);
    expect(entries.find((entry) => entry.id === "learning")?.sha256).toBe(guidanceFingerprint(learning?.content ?? ""));
  });

  it("keeps a legacy inline-fingerprint adopter index in its own layout during learning-only adoption", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    const indexPath = path.join(repo, GUIDANCE_INDEX);
    const fingerprintsPath = path.join(repo, GUIDANCE_FINGERPRINTS);
    const legacy = JSON.parse(readFileSync(indexPath, "utf8")) as { schema: string; entries: Array<Record<string, string>> };
    legacy.entries = guidanceEntries(readFileSync(indexPath, "utf8"), readFileSync(fingerprintsPath, "utf8"))
      .map((entry) => ({ ...entry, sha256: entry.id === "learning" ? "0".repeat(64) : entry.sha256 }));
    writeFileSync(indexPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    rmSync(fingerprintsPath);
    rmSync(path.join(repo, "docs/agent-guidance/learning.md"));

    const plan = computeWayPropagationPlan(repo, null, { learningOnly: true });

    expect(plan.unmanageable).toEqual([]);
    expect(plan.changes.map((change) => change.path).sort()).toEqual([GUIDANCE_INDEX, "docs/agent-guidance/learning.md"]);
    const learning = plan.changes.find((change) => change.path === "docs/agent-guidance/learning.md");
    const planned = plan.changes.find((change) => change.path === GUIDANCE_INDEX)?.content ?? "";
    expect(planned).toContain('"sha256"');
    expect(guidanceEntries(planned).find((entry) => entry.id === "learning")?.sha256).toBe(guidanceFingerprint(learning?.content ?? ""));
  });

  it("keeps a fresh current adoption unchanged and remains current on repeat", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    const before = readFileSync(path.join(repo, "AGENTS.md"), "utf8");

    const first = computeWayPropagationPlan(repo, null, { learningOnly: true });
    const second = computeWayPropagationPlan(repo, null, { learningOnly: true });

    expect(first.unmanageable).toEqual([]);
    expect(first.changes).toEqual([]);
    expect(second.unmanageable).toEqual([]);
    expect(second.changes).toEqual([]);
    expect(readFileSync(path.join(repo, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("replaces only the old Notes retrieval paragraph in an existing compact bootstrap", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    const agentsPath = path.join(repo, "AGENTS.md");
    const old = [
      "**Before implementation, repair, validation or handoff**, search the Project's",
      "`docs/notes-to-self.md` with targeted `rg` for commands, subsystem and symptoms;",
      "read matches and evidence first. Repeat on each new failure. Report a missing",
      "notes file. Preserve failed receipts, correct verified remedies and convert",
      "recurring friction into source fixes or meaningful guards; do not create a",
      "second memory store or treat an inference as operator preference."
    ].join("\n");
    const agents = readFileSync(agentsPath, "utf8")
      .replace(/\*\*Before implementation, repair, validation or handoff\*\*[\s\S]*?Retrieve lessons on demand; Notes is the bounded verified hot cache\./, old)
      .replace("<!-- ARCADIA_CONTEXT_END -->", "Local deployment instruction.\n<!-- ARCADIA_CONTEXT_END -->");
    writeFileSync(agentsPath, agents, "utf8");

    const plan = computeWayPropagationPlan(repo, null, { learningOnly: true });

    const agentsChange = plan.changes.find((change) => change.path === "AGENTS.md");
    expect(agentsChange).toMatchObject({ action: "write" });
    expect(agentsChange?.content).toContain("Local deployment instruction.");
    expect(agentsChange?.content).toContain("arcadia learn");
  });

  it("does not introduce Hacker recovery into an older Learn-only adopter", () => {
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    const oldBootstrap = [
      "**Before implementation, repair, validation or handoff**, search the Project's",
      "`docs/notes-to-self.md` with targeted `rg` for commands, subsystem and symptoms;",
      "read matches and evidence first. Repeat on each new failure. Report a missing",
      "notes file. Preserve failed receipts, correct verified remedies and convert",
      "recurring friction into source fixes or meaningful guards; do not create a",
      "second memory store or treat an inference as operator preference."
    ].join("\n");
    const legacyContext = readAgentsContextBlock()
      .replace(/\*\*Before implementation, repair, validation or handoff\*\*[\s\S]*?Retrieve lessons on demand; Notes is the bounded verified hot cache\./, oldBootstrap);
    writeFileSync(path.join(repo, "AGENTS.md"), ["# AGENTS", "", AGENTS_SECTION_START, legacyContext, AGENTS_SECTION_END, ""].join("\n"), "utf8");
    const learningPath = path.join(repo, "docs/agent-guidance/learning.md");
    const oldRebusterLearning = readFileSync(learningPath, "utf8")
      .replace(/\nTwo unchanged workflow refusals without new evidence require\n\[Hacker recovery\]\(hacker-recovery\.md\) before another attempt\. Explicit\nstop-the-line requests activate it immediately\. This changes diagnostic strategy,\nnot authority, admission or budget\. Supervisors must recognize the pattern\.\n/, "\n")
      .replace("<!-- ARCADIA_CONTEXT_END -->", "<!-- ARCADIA_CONTEXT_END -->\n\nLocal retained learning note.\n");
    writeFileSync(learningPath, oldRebusterLearning, "utf8");
    rmSync(path.join(repo, "docs/agent-guidance/hacker-recovery.md"));
    const indexPath = path.join(repo, GUIDANCE_INDEX);
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { entries: Array<{ id: string }> };
    index.entries = index.entries.filter((entry) => entry.id !== "hacker-recovery");
    writeFileSync(indexPath, renderGuidanceIndex(index), "utf8");
    const fingerprintsPath = path.join(repo, GUIDANCE_FINGERPRINTS);
    const fingerprints = JSON.parse(readFileSync(fingerprintsPath, "utf8")) as { fingerprints: Record<string, string> };
    delete fingerprints.fingerprints["hacker-recovery"];
    writeFileSync(fingerprintsPath, `${JSON.stringify(fingerprints, null, 2)}\n`, "utf8");

    const plan = computeWayPropagationPlan(repo, null, { learningOnly: true });
    const learning = plan.changes.find((change) => change.path === "docs/agent-guidance/learning.md");
    const plannedIndex = plan.changes.find((change) => change.path === GUIDANCE_INDEX);
    const plannedFingerprints = plan.changes.find((change) => change.path === GUIDANCE_FINGERPRINTS);

    expect(plan.unmanageable).toEqual([]);
    expect(learning).toMatchObject({ action: "write" });
    expect(learning?.content).toContain("Local retained learning note.");
    expect(learning?.content).not.toContain("hacker-recovery.md");
    expect(plannedIndex).toBeUndefined();
    expect(plannedFingerprints?.content).not.toContain("hacker-recovery");
    const selectedEntry = guidanceEntries(readFileSync(indexPath, "utf8"), plannedFingerprints?.content ?? null)
      .find((entry) => entry.id === "learning");
    expect(selectedEntry?.sha256).toBe(guidanceFingerprint(learning?.content ?? ""));
  });
});

describe("upgrade policy", () => {
  it("reads a declared upgrade_policy from adoption.json", () => {
    const repo = tempRepo();
    mkdirSync(path.join(repo, ".arcadia", "arcadia-way"), { recursive: true });
    writeFileSync(
      path.join(repo, ".arcadia", "arcadia-way", "adoption.json"),
      JSON.stringify({ upgrade_policy: "explicit-only" }),
      "utf8"
    );

    expect(readUpgradePolicy(repo)).toBe("explicit-only");
    expect(declinesAutomaticUpgrades(repo)).toBe(true);
  });

  it("treats a missing or undeclared policy as not declining", () => {
    const repo = tempRepo();
    expect(readUpgradePolicy(repo)).toBeNull();
    expect(declinesAutomaticUpgrades(repo)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestration: real local Git (a temp repo plus a temp bare "origin"), with
// `gh` faked out through the injectable command runner so no test ever
// touches a network or a real GitHub repository.

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function initGitRepo(): { repo: string; remote: string } {
  const remote = mkdtempSync(path.join(tmpdir(), "arcadia-way-origin-"));
  roots.push(remote);
  execFileSync("git", ["init", "--bare", "-b", "main"], { cwd: remote });

  const repo = tempRepo();
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  // The remote's fetch URL is declared as a github.com address, so
  // `git remote get-url origin` (and `parseGithubSlug`) sees exactly what a
  // real adopting repository would report. Its separate push URL points at
  // the local bare repository above, so every push in this file is local disk
  // I/O, never a network call, while the code under test never learns the
  // difference.
  git(repo, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
  git(repo, ["remote", "set-url", "--push", "origin", remote]);
  writeCurrentAdoption(repo);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "initial adoption"]);
  git(repo, ["push", "-u", "origin", "main"]);
  return { repo, remote };
}

function fakeGhRunner(calls: Array<{ command: string; args: string[] }>): CommandRunner {
  return (cwd, command, args): CommandResult => {
    calls.push({ command, args });
    if (command === "git" && args[0] === "fetch") return { ok: true, stdout: "", stderr: "" };
    if (command === "gh") {
      if (args[0] === "pr" && args[1] === "create") {
        return { ok: true, stdout: "https://github.com/example/repo/pull/1\n", stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { ok: true, stdout: "merged\n", stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    }
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

function seedProject(workspace: string, repoPath: string): void {
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Acme", mission: "Ship it.", status: "active" });
    upsertProjectMetadata(db, {
      projectId: project.id,
      aliases: [],
      repoPath,
      statusSummary: null,
      validationCommands: []
    });
  });
}

function tempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-way-propagation-workspace-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

describe("runWayPropagation", () => {
  it("leaves no candidate worktree or branch after repeated no-op applies", () => {
    const { repo } = initGitRepo();
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const first = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls) })
    );
    const second = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls) })
    );

    expect(first.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({ status: "current", candidatePath: null, candidateBranch: null, candidateHead: null });
    expect(second.results[0]).toMatchObject({ status: "current", candidatePath: null, candidateBranch: null, candidateHead: null });
    expect(git(repo, ["branch", "--list", "arcadia-way/propagate-*"])).toBe("");
    expect(git(repo, ["worktree", "list", "--porcelain"])).not.toContain("arcadia-way-propagate-");
    expect(calls.some((call) => call.command === "gh")).toBe(false);
  });

  it("preserves the untouched no-op candidate when cleanup fails", () => {
    const { repo } = initGitRepo();
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const runner = fakeGhRunner([]);

    const summary = withDatabase(workspace, (db) => runWayPropagation({
      db,
      runCommand: (cwd, command, args) => {
        if (command === "git" && args[0] === "worktree" && args[1] === "remove") {
          return { ok: false, stdout: "", stderr: "cleanup refused" };
        }
        return runner(cwd, command, args);
      }
    }));
    const result = summary.results[0];

    expect(result).toMatchObject({ status: "error", candidateBranch: expect.stringMatching(/^arcadia-way\/propagate-/) });
    expect(result.candidatePath).not.toBeNull();
    expect(result.candidateHead).not.toBeNull();
    expect(existsSync(result.candidatePath!)).toBe(true);
    expect(git(repo, ["show-ref", "--verify", `refs/heads/${result.candidateBranch}`])).toContain(result.candidateHead);
  });

  it("reports a retained advanced branch after cleanup races a clean candidate commit", () => {
    const { repo } = initGitRepo();
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const runner = fakeGhRunner([]);
    let advancedHead = "";

    const summary = withDatabase(workspace, (db) => runWayPropagation({
      db,
      runCommand: (cwd, command, args) => {
        if (command === "git" && args[0] === "worktree" && args[1] === "remove") {
          const candidate = args[2];
          const agents = path.join(candidate, "AGENTS.md");
          writeFileSync(agents, `${readFileSync(agents, "utf8")}\nConcurrent clean candidate commit.\n`, "utf8");
          git(candidate, ["add", "AGENTS.md"]);
          git(candidate, ["commit", "-m", "concurrent no-op candidate advance"]);
          advancedHead = git(candidate, ["rev-parse", "HEAD"]).trim();
        }
        return runner(cwd, command, args);
      }
    }));
    const result = summary.results[0];

    expect(result).toMatchObject({ status: "error", candidatePath: null, candidateBranch: expect.stringMatching(/^arcadia-way\/propagate-/), candidateHead: advancedHead });
    expect(existsSync(result.candidatePath ?? "")).toBe(false);
    expect(git(repo, ["show-ref", "--verify", `refs/heads/${result.candidateBranch}`])).toContain(advancedHead);
    expect(result.detail).toContain(`git worktree add <new-path> ${result.candidateBranch}`);
  });

  it("reports uncertain cleanup state without a stale candidate head", () => {
    const { repo } = initGitRepo();
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const runner = fakeGhRunner([]);
    let candidateHeadReads = 0;

    const summary = withDatabase(workspace, (db) => runWayPropagation({
      db,
      runCommand: (cwd, command, args) => {
        if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD" && cwd !== repo) {
          candidateHeadReads += 1;
          if (candidateHeadReads > 1) return { ok: false, stdout: "", stderr: "candidate unavailable" };
        }
        return runner(cwd, command, args);
      }
    }));
    const result = summary.results[0];

    expect(result).toMatchObject({ status: "error", candidatePath: expect.any(String), candidateBranch: expect.stringMatching(/^arcadia-way\/propagate-/) });
    expect(result.candidateHead).toBe(git(repo, ["rev-parse", "--verify", `refs/heads/${result.candidateBranch}`]).trim());
    expect(result.detail).toContain("could not confirm the candidate worktree and branch state");
    expect(result.detail).not.toContain("advanced after planning");
  });

  it("keeps a dirty primary checkout and its HEAD reflog untouched while publishing from a candidate", () => {
    const { repo } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n");
    git(repo, ["add", "-A"]); git(repo, ["commit", "-m", "bootstrap drift"]);
    git(repo, ["push", "origin", "main"]);
    writeFileSync(path.join(repo, "operator-draft.txt"), "do not touch\n");
    const before = {
      branch: git(repo, ["branch", "--show-current"]),
      head: git(repo, ["rev-parse", "HEAD"]),
      agents: readFileSync(path.join(repo, "AGENTS.md"), "utf8"),
      reflog: git(repo, ["reflog", "show", "--format=%H %gs", "-1"]),
      status: git(repo, ["status", "--porcelain"])
    };
    const workspace = tempWorkspace(); seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];
    const summary = withDatabase(workspace, (db) => runWayPropagation({ db, now: () => "20260101000000", runCommand: fakeGhRunner(calls) }));
    expect(summary.results[0].status).toBe("opened");
    expect(summary.results[0].pullRequestUrl).toBe("https://github.com/example/repo/pull/1");
    expect(summary.results[0].filesChanged).toEqual(["AGENTS.md"]);
    expect(summary.results[0].candidatePath).not.toBeNull();
    expect(summary.results[0].candidateHead).not.toBe(before.head.trim());
    expect(existsSync(summary.results[0].candidatePath!)).toBe(true);
    expect(calls.some((call) => call.command === "gh" && call.args[1] === "merge")).toBe(false);
    expect(calls.some((call) => call.args[0] === "checkout")).toBe(false);
    expect(git(repo, ["branch", "--show-current"])).toBe(before.branch);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(before.head);
    expect(readFileSync(path.join(repo, "AGENTS.md"), "utf8")).toBe(before.agents);
    expect(git(repo, ["reflog", "show", "--format=%H %gs", "-1"])).toBe(before.reflog);
    expect(git(repo, ["status", "--porcelain"])).toBe(before.status);
  });

  it.each(["push", "pr"])("preserves a recoverable candidate when %s publication fails", (failure) => {
    const { repo } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n");
    git(repo, ["add", "-A"]); git(repo, ["commit", "-m", "bootstrap drift"]); git(repo, ["push", "origin", "main"]);
    const beforeHead = git(repo, ["rev-parse", "HEAD"]);
    const beforeBranch = git(repo, ["branch", "--show-current"]);
    const workspace = tempWorkspace(); seedProject(workspace, repo);
    const runner = fakeGhRunner([]);
    const summary = withDatabase(workspace, (db) => runWayPropagation({ db, now: () => "20260101000000", runCommand: (cwd, command, args) => {
      if (failure === "push" && command === "git" && args[0] === "push") return { ok: false, stdout: "", stderr: "push refused" };
      if (failure === "pr" && command === "gh" && args[0] === "pr" && args[1] === "create") return { ok: false, stdout: "", stderr: "PR refused" };
      return runner(cwd, command, args);
    } }));
    const result = summary.results[0];

    expect(result.status).toBe("error");
    expect(result.candidatePath).not.toBeNull();
    expect(result.candidateBranch).not.toBeNull();
    expect(result.candidateHead).not.toBeNull();
    expect(existsSync(result.candidatePath!)).toBe(true);
    expect(git(result.candidatePath!, ["rev-parse", "HEAD"]).trim()).toBe(result.candidateHead);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(beforeHead);
    expect(git(repo, ["branch", "--show-current"])).toBe(beforeBranch);
  });

  it("reports a branch collision without modifying the primary or removing the candidate path", () => {
    const { repo } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n");
    git(repo, ["add", "-A"]); git(repo, ["commit", "-m", "bootstrap drift"]); git(repo, ["push", "origin", "main"]);
    const branch = "arcadia-way/propagate-collision";
    git(repo, ["branch", branch]);
    const candidate = mkdtempSync(path.join(tmpdir(), "arcadia-way-collision-")); roots.push(candidate);
    const head = git(repo, ["rev-parse", "HEAD"]);
    const workspace = tempWorkspace(); seedProject(workspace, repo);
    const summary = withDatabase(workspace, (db) => runWayPropagation({ db, runCommand: fakeGhRunner([]), branchName: () => branch, candidateDirectory: () => candidate }));

    expect(summary.results[0]).toMatchObject({ status: "error", candidatePath: candidate, candidateBranch: branch, candidateHead: null });
    expect(existsSync(candidate)).toBe(true);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("opens a governing-tier change and never merges it, even alongside a mechanical change", () => {
    const { repo } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "stale constitution\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "drift both tiers"]);
    git(repo, ["push", "origin", "main"]);
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls), now: () => "20260101000000" })
    );

    expect(summary.results[0].status).toBe("opened");
    expect(summary.results[0].filesChanged.sort()).toEqual(["AGENTS.md", "CONSTITUTION.md"]);
    expect(calls.some((call) => call.command === "gh" && call.args[1] === "merge")).toBe(false);
  });

  it("skips a repository whose adoption.json declines automatic upgrades", () => {
    const { repo } = initGitRepo();
    mkdirSync(path.join(repo, ".arcadia", "arcadia-way"), { recursive: true });
    writeFileSync(
      path.join(repo, ".arcadia", "arcadia-way", "adoption.json"),
      JSON.stringify({ upgrade_policy: "explicit-only" }),
      "utf8"
    );
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "drift plus decline"]);
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, runCommand: fakeGhRunner(calls) })
    );

    expect(summary.results[0].status).toBe("declined");
    expect(calls.some((call) => call.command === "gh")).toBe(false);
    expect(calls.some((call) => call.args.includes("push"))).toBe(false);
  });

  it("never writes outside the marker region or a managed file, and never pushes on a dry run", () => {
    const { repo } = initGitRepo();
    writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS\n\nstale\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "drift"]);
    const workspace = tempWorkspace();
    seedProject(workspace, repo);
    const calls: Array<{ command: string; args: string[] }> = [];

    const summary = withDatabase(workspace, (db) =>
      runWayPropagation({ db, dryRun: true, runCommand: fakeGhRunner(calls) })
    );

    expect(summary.results[0].status).toBe("dry-run");
    expect(calls.some((call) => call.command === "gh")).toBe(false);
    expect(calls.some((call) => call.args.includes("push"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
    expect(existsSync(path.join(repo, "AGENTS.md"))).toBe(true);
  });
});

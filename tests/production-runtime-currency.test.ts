import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { runProductionActivateCommand, runProductionRuntimeCheckCommand } from "../src/commands/production.js";
import { findTransitionReceipt } from "../src/production/policy.js";
import { RUNTIME_PATHS, assessRuntimeCurrency } from "../src/production/runtimeCurrency.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-runtime-currency-"));
  temporary.push(directory);
  return directory;
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com"
    }
  }).trim();
}

function commitFile(repository: string, relative: string, content: string): string {
  const target = path.join(repository, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  git(repository, "add", "-A");
  git(repository, "commit", "-q", "-m", `change ${relative}`);
  return git(repository, "rev-parse", "HEAD");
}

function gitRepository(): { repository: string; base: string } {
  const repository = scratch();
  git(repository, "init", "-q", "-b", "main");
  const base = commitFile(repository, "src/index.ts", "export {};\n");
  return { repository, base };
}

describe("assessRuntimeCurrency", () => {
  it("is current when the installed revision is HEAD", () => {
    const { repository, base } = gitRepository();
    const result = assessRuntimeCurrency({ repository, installedRevision: base });
    expect(result).toEqual({ current: true, head: base, installedRevision: base, reasons: [] });
  });

  it("is stale when a runtime path changed after the installed revision", () => {
    const { repository, base } = gitRepository();
    const head = commitFile(repository, "src/index.ts", "export const changed = true;\n");
    const result = assessRuntimeCurrency({ repository, installedRevision: base });
    expect(result.current).toBe(false);
    expect(result.head).toBe(head);
    expect(result.reasons.join(" ")).toContain("src/index.ts");
  });

  it.each(["config/defaults/agent-roles.json", "database/schema.sql"])(
    "is stale when %s, which the install stages, changed",
    (relative) => {
      const { repository, base } = gitRepository();
      commitFile(repository, relative, "changed\n");
      const result = assessRuntimeCurrency({ repository, installedRevision: base });
      expect(result.current).toBe(false);
      expect(result.reasons.join(" ")).toContain(relative);
    }
  );

  it("is stale when the installed revision is not a full commit id", () => {
    const { repository } = gitRepository();
    const result = assessRuntimeCurrency({ repository, installedRevision: "--output=/tmp/x" });
    expect(result.current).toBe(false);
    expect(result.reasons.join(" ")).toContain("not a full commit id");
  });

  it("stays current across a docs-only difference", () => {
    const { repository, base } = gitRepository();
    commitFile(repository, "docs/notes.md", "# notes\n");
    expect(assessRuntimeCurrency({ repository, installedRevision: base }).current).toBe(true);
  });

  it("is stale when the installed revision is not an ancestor of HEAD", () => {
    const { repository, base } = gitRepository();
    git(repository, "checkout", "-q", "-b", "divergent");
    const divergent = commitFile(repository, "docs/other.md", "# other\n");
    git(repository, "checkout", "-q", "main");
    commitFile(repository, "docs/main.md", "# main\n");
    const result = assessRuntimeCurrency({ repository, installedRevision: divergent });
    expect(result.current).toBe(false);
    expect(result.reasons.join(" ")).toContain("not an ancestor");
    expect(base).not.toBe(divergent);
  });

  it("is stale without an installed revision", () => {
    const { repository } = gitRepository();
    const result = assessRuntimeCurrency({ repository, installedRevision: null });
    expect(result.current).toBe(false);
    expect(result.installedRevision).toBeNull();
    expect(result.reasons.join(" ")).toContain("no installed broker revision");
  });

  it("is stale when the installed revision is unknown to the repository", () => {
    const { repository } = gitRepository();
    const result = assessRuntimeCurrency({ repository, installedRevision: "0123456789abcdef0123456789abcdef01234567" });
    expect(result.current).toBe(false);
    expect(result.reasons.join(" ")).toContain("unknown to this repository");
  });

  it("names at most ten differing paths", () => {
    const { repository, base } = gitRepository();
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(path.join(repository, "src", `f${index}.ts`), "export {};\n", "utf8");
    }
    git(repository, "add", "-A");
    git(repository, "commit", "-q", "-m", "many");
    const reason = assessRuntimeCurrency({ repository, installedRevision: base }).reasons.join(" ");
    expect(reason).toContain("and 2 more");
    expect(RUNTIME_PATHS).toContain("src");
  });

  it("reports through the read-only command without refusing when stale", () => {
    const { repository } = gitRepository();
    const response = runProductionRuntimeCheckCommand({ repository, installedRevision: null });
    expect(response.data.current).toBe(false);
    expect(response.warnings.length).toBeGreaterThan(0);
  });
});

describe("production activate --require-current-runtime", () => {
  function fixtureWorkspace(): string {
    const repo = scratch();
    mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
    writeFileSync(
      path.join(repo, "PROJECT.md"),
      [
        "---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
        "goal: Exercise managed production.", "milestone: Queue milestone",
        "active_plan: queue-plan", "current_action: migrate", "updated: 2026-09-05", "---", "", "# Demo", ""
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      path.join(repo, "docs", "plans", "queue-plan.md"),
      [
        "---", "arcadia: v1", "type: plan", "slug: queue-plan", "project: demo", "status: active",
        "milestone: Queue milestone", "token_impact: medium",
        "token_budget: One bounded implementation pass.", "recommended_model: gpt-5.6-terra",
        "current_action: migrate",
        "updated: 2026-09-05", "actions:",
        "  - id: migrate", "    title: Prepare the fixture", "    status: open",
        "    responsibility: agent", "    next_action: Prepare the fixture.",
        "    expected_artifact: A prepared fixture", "    clarification: clarified",
        "    acceptance_criteria:", "      - The fixture exists with its configured queue entries.", "    depends_on: []",
        "---", "", "# Queue plan", ""
      ].join("\n"),
      "utf8"
    );
    const target = path.join(scratch(), "workspace");
    initWorkspace(target);
    withDatabase(target, (db) => {
      const project = upsertProject(db, {
        name: "Demo",
        mission: "Exercise managed production.",
        status: "active",
        currentMilestone: "Queue milestone",
        nextAction: "Prepare the fixture.",
        workClassification: "agent"
      });
      upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    });
    return target;
  }

  function request(target: string, requestId: string, overrides: Partial<Parameters<typeof runProductionActivateCommand>[0]> = {}) {
    return {
      workspace: target,
      project: ["demo"],
      plan: ["demo/queue-plan"],
      provider: ["opencode-cli"],
      intent: "Authorize the fixture Plan.",
      grantedBy: "operator",
      requestId,
      ...overrides
    };
  }

  function hasReceipt(target: string, requestId: string): boolean {
    return withDatabase(target, (db) => Boolean(findTransitionReceipt(db, requestId)));
  }

  it("refuses a stale runtime and writes no transition", () => {
    const target = fixtureWorkspace();
    const { repository, base } = gitRepository();
    commitFile(repository, "src/index.ts", "export const changed = true;\n");
    expect(() =>
      runProductionActivateCommand(
        request(target, "grant-stale-1", { requireCurrentRuntime: true, repository, installedRevision: base })
      )
    ).toThrow(/installed runtime is not current.*src\/index\.ts/);
    expect(hasReceipt(target, "grant-stale-1")).toBe(false);
  });

  it("activates when the runtime is current", () => {
    const target = fixtureWorkspace();
    const { repository, base } = gitRepository();
    const activated = runProductionActivateCommand(
      request(target, "grant-current-1", { requireCurrentRuntime: true, repository, installedRevision: base })
    );
    expect(activated.data.result.replayed).toBe(false);
    expect(hasReceipt(target, "grant-current-1")).toBe(true);
  });

  it("is unchanged without the flag even when the runtime is stale", () => {
    const target = fixtureWorkspace();
    const { repository } = gitRepository();
    const activated = runProductionActivateCommand(
      request(target, "grant-noflag-1", { repository, installedRevision: null })
    );
    expect(activated.data.result.replayed).toBe(false);
  });

  it("replays a settled request id even when the runtime is now stale", () => {
    const target = fixtureWorkspace();
    const { repository, base } = gitRepository();
    runProductionActivateCommand(request(target, "grant-replay-1", { requireCurrentRuntime: true, repository, installedRevision: base }));
    commitFile(repository, "src/index.ts", "export const changed = true;\n");
    const retry = runProductionActivateCommand(
      request(target, "grant-replay-1", { requireCurrentRuntime: true, repository, installedRevision: base })
    );
    expect(retry.data.result.replayed).toBe(true);
  });
});

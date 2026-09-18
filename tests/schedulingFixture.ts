import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * One workspace plus one Git repository per Project, each carrying a managed
 * PROJECT.md and an active Plan. Shared by the scheduling suites so the GitHub
 * adapter and the scheduler are proven against identical documents.
 *
 * The caller owns cleanup: push the returned `root` onto its own list.
 */

export interface ActionSpec {
  id: string;
  dependsOn?: string[];
  status?: "open" | "done";
}

export interface ProjectSpec {
  slug: string;
  current: string;
  actions: ActionSpec[];
}

export interface SchedulingFixture {
  root: string;
  workspace: string;
  repos: Record<string, string>;
}

export function gitIn(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export function planDocument(slug: string, project: string, current: string, actions: ActionSpec[]): string {
  const blocks = actions.map((action) => [
    `  - id: ${action.id}`,
    `    title: ${action.id.replace(/-/g, " ")}`,
    `    status: ${action.status ?? "open"}`,
    "    responsibility: agent",
    "    effort: session",
    `    next_action: Do ${action.id}.`,
    `    expected_artifact: docs/${action.id}.md`,
    "    clarification: clarified",
    "    acceptance_criteria:",
    `      - ${action.id} exists.`,
    `    depends_on: [${(action.dependsOn ?? []).join(", ")}]`,
    "    decisions: []",
    "    references: []"
  ].join("\n"));
  return [
    "---", "arcadia: v1", "type: plan", `slug: ${slug}`, `project: ${project}`, "status: active",
    `milestone: ${project} milestone`, `current_action: ${current}`, "token_impact: medium",
    "token_budget: One bounded Session; deterministic checks.", "recommended_model: sonnet", "updated: 2026-09-17",
    "actions:", ...blocks, "---", "", `# ${slug}`, ""
  ].join("\n");
}

export function projectDocument(slug: string, plan: string, current: string): string {
  return [
    "---", "arcadia: v1", "type: project", `slug: ${slug}`, `name: ${slug}`, "status: active",
    `goal: Schedule ${slug}.`, `milestone: ${slug} milestone`, `active_plan: ${plan}`, `current_action: ${current}`,
    "updated: 2026-09-17", "---", "", `# ${slug}`, ""
  ].join("\n");
}

export function schedulingFixture(projects: ProjectSpec[]): SchedulingFixture {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-scheduling-"));
  const workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  const repos: Record<string, string> = {};
  for (const spec of projects) {
    const repo = path.join(root, spec.slug);
    mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
    writeFileSync(path.join(repo, "PROJECT.md"), projectDocument(spec.slug, `${spec.slug}-plan`, spec.current));
    writeFileSync(path.join(repo, "docs", "plans", `${spec.slug}-plan.md`), planDocument(`${spec.slug}-plan`, spec.slug, spec.current, spec.actions));
    gitIn(repo, ["init", "-q", "-b", "main"]);
    gitIn(repo, ["config", "user.email", "arcadia@example.test"]);
    gitIn(repo, ["config", "user.name", "Arcadia Test"]);
    gitIn(repo, ["add", "."]);
    gitIn(repo, ["commit", "-qm", "initial"]);
    repos[spec.slug] = repo;
    withDatabase(workspace, (db) => {
      const project = upsertProject(db, { name: spec.slug, mission: `Schedule ${spec.slug}.`, goal: `Schedule ${spec.slug}.`, status: "active" });
      upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
      const sync = syncProjectDocs(db, project, { apply: true });
      if (sync.errors.length || sync.rejected.length) throw new Error(`fixture docs did not sync: ${JSON.stringify(sync.errors)}`);
    });
  }
  return { root, workspace, repos };
}

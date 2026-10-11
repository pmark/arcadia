import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ loadProjectPlans: vi.fn(), loadPlanProgress: vi.fn() }));
const projects = vi.hoisted(() => [
  { id: "p1", slug: "ppn", name: "Private Practice Now", status: "active" },
  { id: "p2", slug: "arcadia", name: "Arcadia", status: "active" },
  { id: "p3", slug: "loose", name: "Loose", status: "incubating" }
]);
const repos: Record<string, string | null> = { p1: "/repos/ppn", p2: "/repos/arcadia", p3: null };

vi.mock("./arcadia-cli", async (original) => ({ ...(await original<typeof import("./arcadia-cli")>()), ...cli }));
vi.mock("../../../src/cli/workspace", () => ({ resolveReadyWorkspace: () => ({ workspacePath: "/ws" }) }));
vi.mock("../../../src/db/connection", () => ({ withDatabase: (_path: string, fn: (db: null) => unknown) => fn(null) }));
vi.mock("../../../src/db/repositories", () => ({
  listProjects: () => projects,
  getProjectBySlug: (_db: null, slug: string) => projects.find((project) => project.slug === slug) ?? null,
  getProjectMetadata: (_db: null, id: string) => ({ repo_path: repos[id] })
}));

import { loadAllPlans, loadPlanDetail, mapLimit, PlanNotFound } from "./plans-server";

const row = (slug: string) => ({ slug, status: "active", governed: true, milestone: "M", isActivePlan: true, actionCounts: null, activationNote: null, relativePath: `docs/plans/${slug}.md` });

beforeEach(() => {
  cli.loadProjectPlans.mockReset();
  cli.loadPlanProgress.mockReset();
});

describe("plans server", () => {
  it("reads every Project's plans by name, keeping one Project's failure on its own row", async () => {
    cli.loadProjectPlans.mockImplementation(async (repo: string) => {
      if (repo === "/repos/arcadia") throw new Error("repository unreadable");
      return { data: { repoRoot: repo, project: { slug: "ppn", name: "PPN", activePlan: "pilot" }, plans: [row("pilot")] } };
    });
    const result = await loadAllPlans();
    expect(result.projects.map((project) => project.slug)).toEqual(["arcadia", "loose", "ppn"]);
    expect(result.projects[0]).toMatchObject({ plans: null, error: "repository unreadable" });
    expect(result.projects[1]).toMatchObject({ plans: null, error: expect.stringContaining("No repository path") });
    expect(result.projects[2]).toMatchObject({ activePlan: "pilot", plans: [row("pilot")], error: null });
  });

  it("returns one Plan with its row and every Action, and refuses an unknown Project", async () => {
    cli.loadProjectPlans.mockResolvedValue({ data: { repoRoot: "/repos/ppn", project: null, plans: [row("pilot"), row("other")] } });
    cli.loadPlanProgress.mockResolvedValue({ data: { schema: "s", actions: [{ key: "ppn/a", status: "open", dependsOn: [], title: "A" }] } });
    const detail = await loadPlanDetail("ppn", "pilot");
    expect(cli.loadPlanProgress).toHaveBeenCalledWith("/repos/ppn", "ppn", "pilot");
    expect(detail.project).toEqual({ id: "p1", slug: "ppn", name: "Private Practice Now" });
    expect(detail.plan?.slug).toBe("pilot");
    expect(detail.progress.actions).toHaveLength(1);
    await expect(loadPlanDetail("nope", "pilot")).rejects.toBeInstanceOf(PlanNotFound);
    await expect(loadPlanDetail("loose", "pilot")).rejects.toBeInstanceOf(PlanNotFound);
  });

  it("never runs more than the limit at once and keeps input order", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceArtifactFixture } from "./helpers/workspace-artifact-fixture.js";

const workspaceRef = vi.hoisted(() => ({ path: "" }));

vi.mock("../apps/dashboard/lib/arcadia-cli", async importOriginal => {
  const actual = await importOriginal<typeof import("../apps/dashboard/lib/arcadia-cli")>();
  return { ...actual, resolveDashboardWorkspace: vi.fn(async () => workspaceRef.path) };
});

import { GET as workspaceFileGet } from "../apps/dashboard/app/api/file/[...path]/route";
import { GET as projectFileGet } from "../apps/dashboard/app/api/projects/[id]/file/[...path]/route";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "file-route-containment-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function workspaceFile(segments: string[]) {
  return workspaceFileGet(new Request(`http://localhost/api/file/${segments.join("/")}`), {
    params: Promise.resolve({ path: segments })
  });
}

function projectFile(id: string, segments: string[]) {
  return projectFileGet(new Request(`http://localhost/api/projects/${id}/file/${segments.join("/")}`), {
    params: Promise.resolve({ id, path: segments })
  });
}

describe("generic workspace file route containment", () => {
  function setup() {
    const workspace = path.join(root, "workspace");
    mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
    writeFileSync(path.join(workspace, "artifacts", "inside.txt"), "inside text");
    writeFileSync(path.join(root, "outside.txt"), "private outside text");
    symlinkSync(path.join(root, "outside.txt"), path.join(workspace, "artifacts", "escape.txt"));
    symlinkSync(path.join(root, "missing-outside.txt"), path.join(workspace, "artifacts", "dangling.txt"));
    symlinkSync(root, path.join(workspace, "linkdir"));
    symlinkSync(path.join(workspace, "artifacts", "inside.txt"), path.join(workspace, "artifacts", "alias.txt"));
    workspaceRef.path = workspace;
    return workspace;
  }

  it("refuses a symlink inside the workspace whose real target lies outside it", async () => {
    setup();
    const response = await workspaceFile(["artifacts", "escape.txt"]);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private outside text");
  });

  it("refuses a directory symlink whose real target escapes the workspace", async () => {
    setup();
    const response = await workspaceFile(["linkdir", "outside.txt"]);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private outside text");
  });

  it("answers a dangling escaping symlink as not found without revealing the outside target", async () => {
    setup();
    const response = await workspaceFile(["artifacts", "dangling.txt"]);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("missing-outside");
  });

  it("still serves in-root reads, including an in-root symlink", async () => {
    setup();
    const direct = await workspaceFile(["artifacts", "inside.txt"]);
    expect(direct.status).toBe(200);
    expect(await direct.text()).toBe("inside text");
    const alias = await workspaceFile(["artifacts", "alias.txt"]);
    expect(alias.status).toBe(200);
    expect(await alias.text()).toBe("inside text");
  });

  it("keeps the lexical traversal refusal", async () => {
    setup();
    const response = await workspaceFile(["..", "outside.txt"]);
    expect(response.status).toBe(400);
  });
});

describe("Project file route containment", () => {
  function setup() {
    const fixture = workspaceArtifactFixture(root);
    const outside = path.join(root, "outside.md");
    writeFileSync(outside, "private outside doc");
    symlinkSync(outside, path.join(fixture.repo, "escape.md"));
    symlinkSync(path.join(root, "missing-outside.md"), path.join(fixture.repo, "dangling.md"));
    symlinkSync(path.join(fixture.repo, "output.md"), path.join(fixture.repo, "alias.md"));
    vi.stubEnv("ARCADIA_WORKSPACE", fixture.workspace);
    return fixture;
  }

  it("refuses a .md symlink inside the repository whose real target lies outside it", async () => {
    const fixture = setup();
    const response = await projectFile(fixture.projectId, ["escape.md"]);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private outside doc");
  });

  it("answers a dangling escaping symlink as not found without revealing the outside target", async () => {
    const fixture = setup();
    const response = await projectFile(fixture.projectId, ["dangling.md"]);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("missing-outside");
  });

  it("still serves in-repository documentation and an in-repository symlink", async () => {
    const fixture = setup();
    const direct = await projectFile(fixture.projectId, ["output.md"]);
    expect(direct.status).toBe(200);
    expect(await direct.text()).toContain("A readable text Artifact.");
    const alias = await projectFile(fixture.projectId, ["alias.md"]);
    expect(alias.status).toBe(200);
    expect(readFileSync(path.join(fixture.repo, "output.md"), "utf8")).toContain("A readable text Artifact.");
    expect(await alias.text()).toContain("A readable text Artifact.");
  });
});

import { open, realpath } from "node:fs/promises";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync, renameSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../apps/dashboard/app/api/workspace/artifacts/[id]/route";
import { MAX_ARTIFACT_BYTES } from "../apps/dashboard/lib/workspace-artifact";
import { withDatabase } from "../src/db/connection.js";
import { attachArtifactToExecutionRun, createArtifactRecord, createProjectWithInitialWork } from "../src/db/repositories.js";
import { svg, workspaceArtifactFixture } from "./helpers/workspace-artifact-fixture.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), realpath: vi.fn(actual.realpath) };
});
let fixture: ReturnType<typeof workspaceArtifactFixture>;
beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockReset().mockImplementation(actual.open);
  vi.mocked(realpath).mockReset().mockImplementation(actual.realpath);
  fixture = workspaceArtifactFixture(mkdtempSync(path.join(tmpdir(), "artifact-route-")));
  vi.stubEnv("ARCADIA_WORKSPACE", fixture.workspace);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (fixture) rmSync(fixture.root, { recursive: true, force: true }); });
function get(id = fixture.svgId, query = `receipt=${fixture.receipt}`) { return GET(new Request(`http://localhost/api/workspace/artifacts/${id}?${query}`), { params: Promise.resolve({ id }) }); }
function add(file: string, projectId = fixture.projectId, linked = true) { return withDatabase(fixture.workspace, db => { const artifact = createArtifactRecord(db, { projectId, title: "Boundary", artifactType: "file", path: file }); if (linked) attachArtifactToExecutionRun(db, fixture.runId, artifact.id); return artifact.id; }); }

describe("workspace domain Artifact byte route", () => {
  it("serves real SVG bytes with inert-document and no-cache guards, without DB writes", async () => {
    const database = path.join(fixture.workspace, "database", "arcadia.sqlite3");
    const { readFileSync } = await import("node:fs");
    const before = readFileSync(database);
    const response = await get();
    expect(response.status).toBe(200); expect(await response.text()).toBe(svg);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain("sandbox; default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readFileSync(database)).toEqual(before);
  });
  it("serves absolute Project repository text as plain UTF-8", async () => { const response = await get(fixture.textId); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8"); expect(await response.text()).toContain("<script>"); });
  it("requires IDs and receipt, and refuses client file/root selectors", async () => { for (const query of ["", "receipt=", "receipt=unknown", `receipt=${fixture.receipt}&path=/tmp/a.svg`, `receipt=${fixture.receipt}&root=/`]) expect((await get(fixture.svgId, query)).status).toBe(query === "receipt=unknown" ? 404 : 400); expect((await get("../file")).status).toBe(400); });
  it("refuses unrelated, missing, pathless and cross-Project records", async () => {
    const other = withDatabase(fixture.workspace, db => createProjectWithInitialWork(db, { name: "Other", mission: "Other", goal: "Other", status: "active", currentMilestone: "Other", nextAction: "Other", workClassification: "agent" }).project.id);
    expect((await get(add("artifacts/output.svg", fixture.projectId, false))).status).toBe(404);
    expect((await get("artifact-missing")).status).toBe(404); expect((await get(fixture.pathlessId)).status).toBe(422);
    expect((await get(add("artifacts/output.svg", other))).status).toBe(404);
    expect((await get(add("artifacts/missing.svg"))).status).toBe(404);
  });
  it("rejects traversal and file/directory symlink escapes, arbitrary paths and root mappings", async () => {
    const outside = path.join(fixture.root, "outside.txt"); writeFileSync(outside, "private");
    symlinkSync(outside, path.join(fixture.workspace, "artifacts", "escape.txt"));
    symlinkSync(fixture.root, path.join(fixture.repo, "escape"));
    for (const file of [outside, "../outside.txt", "artifacts/escape.txt", path.join(fixture.repo, "escape", "outside.txt")]) expect((await get(add(file))).status).toBe(403);
    withDatabase(fixture.workspace, db => db.prepare("UPDATE project_metadata SET repo_path = '/' WHERE project_id = ?").run(fixture.projectId));
    expect((await get(add(outside))).status).toBe(403);
  });
  it("rejects directories and FIFOs without blocking", async () => {
    mkdirSync(path.join(fixture.repo, "folder.txt")); execFileSync("mkfifo", [path.join(fixture.repo, "pipe.txt")]);
    for (const file of ["folder.txt", "pipe.txt"]) expect((await get(add(path.join(fixture.repo, file)))).status).toBe(422);
  });
  it("refuses unsupported or disguised types, invalid UTF-8 and oversized bytes", async () => {
    for (const [name, bytes, status] of [["active.html", "<h1>active</h1>",415], ["fake.png", "not png",415], ["binary.txt", Buffer.from([255,0]),415], ["entity.svg", '<!DOCTYPE svg><svg/>',415], ["large.txt", Buffer.alloc(MAX_ARTIFACT_BYTES + 1),413]] as const) {
      const file = path.join(fixture.repo, name); writeFileSync(file, bytes); expect((await get(add(file))).status).toBe(status);
    }
  });
  it("bounds a file that grows after its first stat", async () => {
    const file = path.join(fixture.repo, "growing.txt"); writeFileSync(file, "small");
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      if (!String(args[0]).endsWith("/growing.txt")) return handle;
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
        const snapshot = await stat(); writeFileSync(file, Buffer.alloc(MAX_ARTIFACT_BYTES + 1, 65)); return snapshot;
      });
      return handle;
    });
    expect((await get(add(file))).status).toBe(413);
  });
  it("accepts PNG, JPEG and WebP signatures with their image MIME", async () => {
    for (const [name, bytes, type] of [["one.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=", "base64"),"image/png"], ["one.jpg", Buffer.from([255,216,255,217]), "image/jpeg"], ["one.webp", Buffer.from("RIFF0000WEBP"), "image/webp"]] as const) { const file = path.join(fixture.repo, name); writeFileSync(file, bytes); const response = await get(add(file)); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe(type); }
  });
});

// Deterministic adversarial interleaving: only schedule real directory swaps;
// every path resolution, file open and inode stat is the actual OS operation.
it.each([false, true])("rejects ancestor symlink swaps (configured root: %s) without disclosing outside bytes", async swapRoot => {
  const directory = swapRoot ? fixture.repo : path.join(fixture.repo, "race");
  const parked = path.join(fixture.root, "race-parked");
  const outside = path.join(fixture.root, "private");
  if (!swapRoot) mkdirSync(directory);
  mkdirSync(outside);
  writeFileSync(path.join(directory, "file.txt"), "allowed output");
  writeFileSync(path.join(outside, "file.txt"), "PRIVATE OUTSIDE ROOTS");
  const file = path.join(directory, "file.txt");
  const id = add(file);
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let candidateChecks = 0;
  const escape = () => { renameSync(directory, parked); symlinkSync(outside, directory); };
  const restore = () => { unlinkSync(directory); renameSync(parked, directory); };
  vi.mocked(realpath).mockImplementation(async (...args) => {
    const resolved = await actual.realpath(...args);
    if (String(args[0]) === file) { candidateChecks++; escape(); }
    return resolved;
  });
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (candidateChecks === 1 && String(args[0]).endsWith("/file.txt")) restore();
    return handle;
  });
  const response = await get(id);
  expect([403, 409]).toContain(response.status);
  expect(await response.text()).not.toContain("PRIVATE OUTSIDE ROOTS");
});

// Linux CI must exercise the real procfs traversal, not a mocked platform.
it.skipIf(process.platform !== "linux")("keeps Linux directory descriptors pinned after a parent rename", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const directory = path.join(fixture.repo, "pinned");
  const outside = path.join(fixture.root, "private");
  mkdirSync(directory); mkdirSync(outside);
  writeFileSync(path.join(directory, "file.txt"), "allowed output");
  writeFileSync(path.join(outside, "file.txt"), "PRIVATE OUTSIDE ROOTS");
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (String(args[0]).endsWith("/pinned")) {
      renameSync(directory, path.join(fixture.repo, "parked"));
      symlinkSync(outside, directory);
    }
    return handle;
  });
  const response = await get(add(path.join(directory, "file.txt")));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("allowed output");
});

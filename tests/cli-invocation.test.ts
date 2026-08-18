import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enclosingProjectRoot, invocationRoot } from "../src/cli/invocation.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.ARCADIA_INVOKED_FROM;
});

function scratch(): string {
  // realpath, because macOS resolves /var to /private/var and the containment
  // checks under test compare resolved paths.
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-invocation-"));
  temporary.push(root);
  return path.resolve(root);
}

function managedProject(root: string, slug: string): void {
  writeFileSync(
    path.join(root, "PROJECT.md"),
    `---\narcadia: v1\ntype: project\nslug: ${slug}\n---\n\n# ${slug}\n`,
    "utf8"
  );
}

describe("invocationRoot", () => {
  it("falls back to the process directory when the launcher declared nothing", () => {
    expect(invocationRoot()).toBe(process.cwd());
  });

  it("honours the directory the launcher recorded before it changed directory", () => {
    const root = scratch();
    process.env.ARCADIA_INVOKED_FROM = root;

    // This is the whole point: the runtime is somewhere else entirely.
    expect(invocationRoot()).toBe(root);
    expect(invocationRoot()).not.toBe(process.cwd());
  });

  it("ignores a declared directory that no longer exists rather than answering from it", () => {
    process.env.ARCADIA_INVOKED_FROM = path.join(scratch(), "deleted-since");

    expect(invocationRoot()).toBe(process.cwd());
  });

  it("ignores an empty declaration", () => {
    process.env.ARCADIA_INVOKED_FROM = "   ";

    expect(invocationRoot()).toBe(process.cwd());
  });
});

describe("enclosingProjectRoot", () => {
  it("finds the project a subdirectory belongs to", () => {
    const root = scratch();
    managedProject(root, "lone");
    const nested = path.join(root, "src", "deep");
    mkdirSync(nested, { recursive: true });

    expect(enclosingProjectRoot(nested)).toBe(root);
  });

  it("returns null outside any managed project", () => {
    expect(enclosingProjectRoot(scratch())).toBeNull();
  });

  it("ignores a PROJECT.md that does not declare `arcadia: v1`", () => {
    const root = scratch();
    // Plenty of repositories have a PROJECT.md that means nothing to Arcadia.
    // Treating one as governed would reintroduce the wrong-answer failure from
    // the other direction.
    writeFileSync(path.join(root, "PROJECT.md"), "# Just a readme by another name\n", "utf8");

    expect(enclosingProjectRoot(root)).toBeNull();
  });

  it("stops at the nearest project when one nests inside another", () => {
    const outer = scratch();
    managedProject(outer, "outer");
    const inner = path.join(outer, "vendor", "inner");
    mkdirSync(inner, { recursive: true });
    managedProject(inner, "inner");

    expect(enclosingProjectRoot(inner)).toBe(inner);
  });

  it("defaults its starting point to the recorded invocation directory", () => {
    const root = scratch();
    managedProject(root, "lone");
    process.env.ARCADIA_INVOKED_FROM = root;

    expect(enclosingProjectRoot()).toBe(root);
  });
});

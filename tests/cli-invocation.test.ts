import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";
import { enclosingProjectRoot, invocationRoot, resolveInvocationPath } from "../src/cli/invocation.js";

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

describe("resolveInvocationPath", () => {
  it("resolves `.` to where the operator stood, not to the runtime directory", () => {
    // The reported failure, exactly: `arcadia docket --repo .` run from a
    // worktree reported the main checkout's state, because the launcher had
    // already changed directory to reach Arcadia's own checkout.
    const stood = scratch();
    process.env.ARCADIA_INVOKED_FROM = stood;

    expect(resolveInvocationPath(".")).toBe(stood);
    expect(resolveInvocationPath(".")).not.toBe(process.cwd());
  });

  it("resolves a relative path against the recorded invocation directory", () => {
    const stood = scratch();
    process.env.ARCADIA_INVOKED_FROM = stood;

    expect(resolveInvocationPath("nested/repo")).toBe(path.join(stood, "nested", "repo"));
    expect(resolveInvocationPath("..")).toBe(path.dirname(stood));
  });

  it("leaves an absolute path alone", () => {
    const stood = scratch();
    const elsewhere = scratch();
    process.env.ARCADIA_INVOKED_FROM = stood;

    expect(resolveInvocationPath(elsewhere)).toBe(elsewhere);
  });

  it("falls back to the process directory when the launcher declared nothing", () => {
    expect(resolveInvocationPath(".")).toBe(process.cwd());
    expect(resolveInvocationPath("sub")).toBe(path.join(process.cwd(), "sub"));
  });

  it("ignores surrounding whitespace", () => {
    const stood = scratch();
    process.env.ARCADIA_INVOKED_FROM = stood;

    expect(resolveInvocationPath("  .  ")).toBe(stood);
  });
});

describe("path options are wired to the invocation-aware resolver", () => {
  /** Every command in the tree, including nested subcommands. */
  function allCommands(command: Command): Command[] {
    return command.commands.flatMap((child) => [child, ...allCommands(child)]);
  }

  /**
   * The defect was never in a resolver -- it was in the wiring. A command that
   * takes a repository path and forgets the coercion resolves it against the
   * runtime directory instead, and answers confidently for Arcadia's own
   * checkout. Enumerating the options rather than naming them means a command
   * added later cannot reintroduce that quietly.
   */
  const repositoryOptionNames = new Set(["--repo", "--repo-path", "--source"]);

  /**
   * `--source` is overloaded across the CLI -- an ingress folder, a Codex
   * lane, "cli|discord|admin". Only `go --source` is a repository path, and
   * the `<path>` placeholder is what says so, so the declaration does the
   * disambiguating rather than a hand-maintained list of exceptions.
   */
  function takesRepositoryPath(option: { long?: string | null; flags: string }): boolean {
    return Boolean(option.long) && repositoryOptionNames.has(option.long!) && option.flags.includes("<path>");
  }

  it("covers every repository path option the CLI exposes", () => {
    const stood = scratch();
    process.env.ARCADIA_INVOKED_FROM = stood;

    const found: string[] = [];
    for (const command of allCommands(buildProgram())) {
      for (const option of command.options) {
        if (!takesRepositoryPath(option)) continue;

        const name = `${command.name()} ${option.long}`;
        found.push(name);
        expect(option.parseArg, `${name} has no path coercion`).toBeTypeOf("function");
        expect(option.parseArg!(".", undefined), `${name} resolved against the wrong directory`).toBe(stood);
      }
    }

    // A guard that silently matches nothing is worse than no guard. Pinning
    // the exact set means a new repository-scoped option fails here until
    // someone states whether it resolves against the operator's directory --
    // which is the decision that got skipped the first time.
    expect(found.sort()).toEqual([
      "configure --repo-path",
      "docket --repo",
      "go --repo",
      "go --source",
      "metadata --repo-path",
      "setup-context --repo",
      "tidy --repo"
    ]);
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

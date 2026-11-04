import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = path.resolve(__dirname, "..", "scripts");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const git = (repo: string, ...args: string[]) => {
  const result = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

/** A small repository with a stand-in `next`, which records how it was called. */
function fixture() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "arcadia-dashboard-live-"));
  roots.push(repo);
  const dashboard = path.join(repo, "apps", "dashboard");
  mkdirSync(dashboard, { recursive: true });
  writeFileSync(path.join(dashboard, "next-env.d.ts"), "original\n");
  writeFileSync(path.join(repo, "README.md"), "x\n");
  writeFileSync(path.join(repo, ".gitignore"), "apps/dashboard/.live/\nnext-calls\nbounced\nnext.js\nfreeze.sh\nbounce.sh\n");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "first");
  const calls = path.join(repo, "next-calls");
  const next = path.join(repo, "next.js");
  writeFileSync(next, `
const fs = require("fs"), path = require("path"), http = require("http");
const [cmd, ...rest] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, cmd + " " + (process.env.ARCADIA_DASHBOARD_DIST ?? "-") + "\\n");
if (cmd === "build") {
  fs.writeFileSync("next-env.d.ts", "rewritten\\n");
  if (process.env.TEST_FAIL_BUILD) process.exit(1);
  fs.mkdirSync(process.env.ARCADIA_DASHBOARD_DIST, { recursive: true });
  fs.writeFileSync(path.join(process.env.ARCADIA_DASHBOARD_DIST, "BUILD_ID"), "id");
} else if (cmd === "start" && rest.includes("127.0.0.1")) {
  if (process.env.TEST_FAIL_START) process.exit(1);
  http.createServer((_, res) => res.end("ok")).listen(Number(rest[rest.indexOf("-p") + 1]), "127.0.0.1");
}
`);
  const freeze = path.join(repo, "freeze.sh");
  writeFileSync(freeze, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(freeze, 0o755);
  const bounced = path.join(repo, "bounced");
  const bounce = path.join(repo, "bounce.sh");
  writeFileSync(bounce, `#!/usr/bin/env bash\necho bounced >> "${bounced}"\n`);
  chmodSync(bounce, 0o755);
  const env = {
    ...process.env,
    ARCADIA_DASHBOARD_REPO: repo,
    ARCADIA_DASHBOARD_NEXT: next,
    ARCADIA_DASHBOARD_FREEZE_CHECK: freeze,
    ARCADIA_DASHBOARD_BOUNCE: bounce,
    ARCADIA_DASHBOARD_SMOKE_PORT: String(40_000 + Math.floor(Math.random() * 20_000)),
    ARCADIA_DASHBOARD_SMOKE_DEADLINE: "6",
    ARCADIA_DASHBOARD_MODE: "build",
    XPC_SERVICE_NAME: ""
  };
  const live = path.join(dashboard, ".live");
  const change = (file: string) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), `${Math.random()}\n`);
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", file);
  };
  return {
    repo, env, live, freeze, bounced, change,
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []),
    current: () => (existsSync(path.join(live, "current")) ? readFileSync(path.join(live, "current"), "utf8").trim() : null),
    head: () => git(repo, "rev-parse", "HEAD"),
    build: (over: Record<string, string> = {}) => spawnSync(path.join(scripts, "dashboard-build.sh"), { env: { ...env, ...over }, encoding: "utf8" }),
    serve: (over: Record<string, string> = {}) => spawnSync(path.join(scripts, "dashboard-serve.sh"), { env: { ...env, ...over }, encoding: "utf8" }),
    clean: () => {
      expect(git(repo, "status", "--porcelain")).toBe("");
      expect(git(repo, "ls-files", "-v", "apps/dashboard/next-env.d.ts")).toMatch(/^H /);
      expect(readFileSync(path.join(dashboard, "next-env.d.ts"), "utf8")).toBe("original\n");
      expect(existsSync(path.join(live, "build.lock"))).toBe(false);
    }
  };
}

describe("live dashboard build", () => {
  it("builds, checks the build on a spare port, switches, and leaves the checkout clean", () => {
    const f = fixture();
    const result = f.build();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.calls()).toEqual(["build .live/a", "start .live/a"]);
    expect(f.current()).toBe(`a ${f.head()}`);
    expect(existsSync(f.bounced)).toBe(true);
    f.clean();
  });

  it("builds into the other folder, so the one being served isn't touched", () => {
    const f = fixture();
    f.build();
    f.change("apps/dashboard/page.tsx");
    expect(f.build().status).toBe(0);
    expect(f.calls().slice(2)).toEqual(["build .live/b", "start .live/b"]);
    expect(f.current()).toBe(`b ${f.head()}`);
    f.clean();
  });

  it("keeps the current build serving when a new build fails", () => {
    const f = fixture();
    f.build();
    const serving = f.current();
    rmSync(f.bounced);
    f.change("src/cli.ts");
    const result = f.build({ TEST_FAIL_BUILD: "1" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("keeps serving");
    expect(f.current()).toBe(serving);
    expect(existsSync(f.bounced)).toBe(false);
    f.clean();
  });

  it("doesn't switch to a build that won't start", () => {
    const f = fixture();
    f.build();
    const serving = f.current();
    rmSync(f.bounced);
    f.change("apps/dashboard/page.tsx");
    const result = f.build({ TEST_FAIL_START: "1" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("didn't answer");
    expect(f.current()).toBe(serving);
    expect(existsSync(f.bounced)).toBe(false);
    f.clean();
  });

  it("skips the build when nothing for the dashboard changed", () => {
    const f = fixture();
    f.build();
    rmSync(f.bounced);
    f.change("README.md");
    expect(f.build().status).toBe(0);
    expect(f.calls()).toHaveLength(2);
    expect(f.current()).toBe(`a ${f.head()}`);
    expect(existsSync(f.bounced)).toBe(false);
  });

  it("doesn't bounce the dashboard while services are frozen, and leaves the build for the next start", () => {
    const f = fixture();
    writeFileSync(f.freeze, "#!/usr/bin/env bash\nexit 1\n");
    expect(f.build().status).toBe(0);
    expect(f.current()).toBe(`a ${f.head()}`);
    expect(existsSync(f.bounced)).toBe(false);
    f.clean();
  });

  it("ignores a lock left by a dead process", () => {
    const f = fixture();
    mkdirSync(path.join(f.live, "build.lock"), { recursive: true });
    writeFileSync(path.join(f.live, "build.lock", "pid"), "999999");
    expect(f.build().status).toBe(0);
    expect(f.current()).toBe(`a ${f.head()}`);
  });

  it("runs one build at a time", () => {
    const f = fixture();
    const holder = spawn("sleep", ["30"]);
    mkdirSync(path.join(f.live, "build.lock"), { recursive: true });
    writeFileSync(path.join(f.live, "build.lock", "pid"), String(holder.pid));
    const result = f.build();
    holder.kill();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already running");
    expect(f.calls()).toEqual([]);
  });
});

describe("live dashboard start", () => {
  it("falls back to next dev with no build, so a restart never depends on a build", () => {
    const f = fixture();
    mkdirSync(f.live, { recursive: true });
    writeFileSync(path.join(f.live, "current"), `a ${f.head()}\n`);
    expect(f.serve().status).toBe(0);
    expect(f.calls()).toEqual(["dev -"]);
  });

  it("serves the current build", () => {
    const f = fixture();
    f.build();
    rmSync(path.join(f.repo, "next-calls"));
    expect(f.serve().status).toBe(0);
    expect(f.calls()).toEqual(["start .live/a"]);
  });

  it("always runs next dev when asked", () => {
    const f = fixture();
    f.build();
    rmSync(path.join(f.repo, "next-calls"));
    expect(f.serve({ ARCADIA_DASHBOARD_MODE: "dev" }).status).toBe(0);
    expect(f.calls()).toEqual(["dev -"]);
  });
});

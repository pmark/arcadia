import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = path.resolve(__dirname, "..", "scripts");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const lstatExists = (file: string) => { try { lstatSync(file); return true; } catch { return false; } };

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
  http.createServer((req, res) => { if (process.env.TEST_FAIL_ROUTE && req.url.startsWith("/api/")) res.statusCode = 500; res.end("ok"); }).listen(Number(rest[rest.indexOf("-p") + 1]), "127.0.0.1");
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
    ARCADIA_DASHBOARD_JOB: "",
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
      expect(lstatExists(path.join(live, "build.lock"))).toBe(false);
    }
  };
}

/** A stand-in `launchctl` on the PATH, which records how it was called and exits with the given status. */
function fakeLaunchctl(status = 0) {
  const bin = mkdtempSync(path.join(os.tmpdir(), "arcadia-dashboard-launchctl-"));
  roots.push(bin);
  const calls = path.join(bin, "calls");
  const launchctl = path.join(bin, "launchctl");
  writeFileSync(launchctl, `#!/usr/bin/env bash\necho "$*" >> "${calls}"\nexit ${status}\n`);
  chmodSync(launchctl, 0o755);
  return {
    env: { ARCADIA_DASHBOARD_BOUNCE: "", PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [])
  };
}

const job = "com.arcadia.local.test.dashboard";
const uid = process.getuid?.() ?? 0;

describe("switching to a new build", () => {
  it("restarts the launchd job it was given, and says so", () => {
    const f = fixture();
    const launchctl = fakeLaunchctl();
    const result = f.build({ ...launchctl.env, ARCADIA_DASHBOARD_JOB: job });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("Switching to the new build.");
    expect(launchctl.calls()).toEqual([`kickstart -k gui/${uid}/${job}`]);
    f.clean();
  });

  // macOS sets XPC_SERVICE_NAME to "0" in anything a launchd job forks, which is what the live builder saw.
  it("says the next restart serves the build when it has no job, rather than stopping silently", () => {
    const f = fixture();
    const launchctl = fakeLaunchctl();
    const result = f.build({ ...launchctl.env, XPC_SERVICE_NAME: "0" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("the next restart serves it");
    expect(launchctl.calls()).toEqual([]);
    expect(f.current()).toBe(`a ${f.head()}`);
    f.clean();
  });

  it("won't restart a job that isn't one of Arcadia's", () => {
    const f = fixture();
    const launchctl = fakeLaunchctl();
    const result = f.build({ ...launchctl.env, ARCADIA_DASHBOARD_JOB: "com.example.other" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("the next restart serves it");
    expect(launchctl.calls()).toEqual([]);
  });

  it("says so when the switch fails, and keeps the finished build for the next restart", () => {
    const f = fixture();
    const launchctl = fakeLaunchctl(3);
    const result = f.build({ ...launchctl.env, ARCADIA_DASHBOARD_JOB: job });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("The switch failed. The next restart serves this build.");
    expect(f.current()).toBe(`a ${f.head()}`);
    f.clean();
  });

  // Setting a job's name by hand makes macOS stop the process, so this runs in CI, on Linux.
  it.skipIf(process.platform === "darwin")("hands the job's name to the build it starts in the background", async () => {
    const f = fixture();
    const launchctl = fakeLaunchctl();
    expect(f.serve({ ...launchctl.env, XPC_SERVICE_NAME: job }).status).toBe(0);
    for (let i = 0; i < 60 && launchctl.calls().length === 0; i++) await new Promise(resolve => setTimeout(resolve, 250));
    expect(launchctl.calls()).toEqual([`kickstart -k gui/${uid}/${job}`]);
  });
});

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

  it("doesn't switch to a build whose server routes fail", () => {
    const f = fixture();
    const result = f.build({ TEST_FAIL_ROUTE: "1" });
    expect(result.status).toBe(1);
    expect(f.current()).toBeNull();
    f.clean();
  });

  it("starts no build while services are frozen", () => {
    const f = fixture();
    writeFileSync(f.freeze, "#!/usr/bin/env bash\nexit 1\n");
    expect(f.build().status).toBe(0);
    expect(f.calls()).toEqual([]);
    expect(f.current()).toBeNull();
    f.clean();
  });

  it("doesn't bounce the dashboard if production starts during the build, and leaves the build for the next start", () => {
    const f = fixture();
    const count = path.join(f.repo, "bounced.count");
    writeFileSync(f.freeze, `#!/usr/bin/env bash\nif [[ -f "${count}" ]]; then exit 1; fi\ntouch "${count}"\n`);
    writeFileSync(path.join(f.repo, ".git", "info", "exclude"), "bounced.count\n");
    expect(f.build().status).toBe(0);
    expect(f.current()).toBe(`a ${f.head()}`);
    expect(existsSync(f.bounced)).toBe(false);
    f.clean();
  });

  it("heals a checkout left behind by a killed build, from git rather than a saved copy", () => {
    const f = fixture();
    git(f.repo, "update-index", "--skip-worktree", "apps/dashboard/next-env.d.ts");
    writeFileSync(path.join(f.repo, "apps/dashboard/next-env.d.ts"), "rewritten by a killed build\n");
    expect(git(f.repo, "status", "--porcelain")).toBe("");
    expect(f.build().status).toBe(0);
    f.clean();
  });

  it("heals that checkout at start too, with no build needed", () => {
    const f = fixture();
    f.build();
    git(f.repo, "update-index", "--skip-worktree", "apps/dashboard/next-env.d.ts");
    writeFileSync(path.join(f.repo, "apps/dashboard/next-env.d.ts"), "rewritten by a killed build\n");
    expect(f.serve().status).toBe(0);
    f.clean();
  });

  it("still starts the dashboard when git is too busy to heal, and heals on a later start", () => {
    const f = fixture();
    f.build();
    rmSync(path.join(f.repo, "next-calls"));
    git(f.repo, "update-index", "--skip-worktree", "apps/dashboard/next-env.d.ts");
    writeFileSync(path.join(f.repo, "apps/dashboard/next-env.d.ts"), "rewritten by a killed build\n");
    const index = path.join(f.repo, ".git", "index.lock");
    writeFileSync(index, "");
    expect(f.serve().status).toBe(0);
    expect(f.calls()).toEqual(["start .live/a"]);
    rmSync(index);
    expect(f.serve().status).toBe(0);
    f.clean();
  });

  it("leaves a running build's mark alone at start", () => {
    const f = fixture();
    f.build();
    const holderScript = path.join(f.repo, ".git", "dashboard-build.sh");
    writeFileSync(holderScript, "#!/usr/bin/env bash\nsleep 30\n");
    chmodSync(holderScript, 0o755);
    const holder = spawn(holderScript);
    spawnSync("sleep", ["0.3"]);
    git(f.repo, "update-index", "--skip-worktree", "apps/dashboard/next-env.d.ts");
    symlinkSync(String(holder.pid), path.join(f.live, "build.lock"));
    const result = f.serve();
    holder.kill();
    expect(result.status).toBe(0);
    expect(git(f.repo, "ls-files", "-v", "apps/dashboard/next-env.d.ts")).toMatch(/^S /);
  });

  it("won't check a build on a port something else is answering", () => {
    const f = fixture();
    const port = f.env.ARCADIA_DASHBOARD_SMOKE_PORT;
    const other = spawn(process.execPath, ["-e", `require("http").createServer((_, r) => r.end("x")).listen(${port}, "127.0.0.1")`]);
    spawnSync("sleep", ["1"]);
    const result = f.build();
    other.kill();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("already in use");
    expect(f.current()).toBeNull();
    f.clean();
  });

  it("says when the freeze check is broken rather than frozen", () => {
    const f = fixture();
    const broken = spawnSync(path.join(scripts, "dashboard-build.sh"), { env: { ...f.env, ARCADIA_DASHBOARD_FREEZE_CHECK: "", PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` }, encoding: "utf8" });
    expect(broken.status).toBe(0);
    expect(broken.stdout).toContain("The freeze check failed");
    expect(f.calls()).toEqual([]);
  });

  it("leaves an ordinary local edit alone", () => {
    const f = fixture();
    f.build();
    writeFileSync(path.join(f.repo, "apps/dashboard/next-env.d.ts"), "edited by hand\n");
    expect(f.serve().status).toBe(0);
    expect(readFileSync(path.join(f.repo, "apps/dashboard/next-env.d.ts"), "utf8")).toBe("edited by hand\n");
  });

  it("ignores a lock left by a dead process", () => {
    const f = fixture();
    mkdirSync(f.live, { recursive: true });
    symlinkSync("999999", path.join(f.live, "build.lock"));
    expect(f.build().status).toBe(0);
    expect(f.current()).toBe(`a ${f.head()}`);
  });

  it("doesn't mistake a reused process ID for a running build", () => {
    const f = fixture();
    const other = spawn("sleep", ["30"]);
    mkdirSync(f.live, { recursive: true });
    symlinkSync(String(other.pid), path.join(f.live, "build.lock"));
    const result = f.build();
    other.kill();
    expect(result.status).toBe(0);
    expect(f.current()).toBe(`a ${f.head()}`);
    f.clean();
  });

  it("starts no build over uncommitted changes it would read", () => {
    const f = fixture();
    writeFileSync(path.join(f.repo, "apps/dashboard/page.tsx"), "not committed\n");
    const result = f.build();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("uncommitted changes");
    expect(f.calls()).toEqual([]);
    expect(f.current()).toBeNull();
  });

  it("rebuilds when the recorded folder has lost its build", () => {
    const f = fixture();
    f.build();
    rmSync(path.join(f.live, "a", "BUILD_ID"));
    rmSync(path.join(f.repo, "next-calls"));
    expect(f.build().status).toBe(0);
    expect(f.calls()).toEqual(["build .live/a", "start .live/a"]);
    expect(f.current()).toBe(`a ${f.head()}`);
    f.clean();
  });

  it("treats any answer on the check port as in use, even an error", () => {
    const f = fixture();
    const port = f.env.ARCADIA_DASHBOARD_SMOKE_PORT;
    const other = spawn(process.execPath, ["-e", `require("http").createServer((_, r) => { r.statusCode = 404; r.end("x"); }).listen(${port}, "127.0.0.1")`]);
    spawnSync("sleep", ["1"]);
    const result = f.build();
    other.kill();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("already in use");
    expect(f.current()).toBeNull();
    f.clean();
  });

  it("runs one build at a time", () => {
    const f = fixture();
    const holderScript = path.join(f.repo, ".git", "dashboard-build.sh");
    writeFileSync(holderScript, "#!/usr/bin/env bash\nsleep 30\n");
    chmodSync(holderScript, 0o755);
    const holder = spawn(holderScript);
    spawnSync("sleep", ["0.3"]);
    mkdirSync(f.live, { recursive: true });
    symlinkSync(String(holder.pid), path.join(f.live, "build.lock"));
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
    // A build starts in the background here too, and it may log its own call before this reads the list.
    expect(f.calls()).toContain("dev -");
    expect(f.calls()).not.toContain("start .live/a");
  });

  it("serves the current build", () => {
    const f = fixture();
    f.build();
    rmSync(path.join(f.repo, "next-calls"));
    expect(f.serve().status).toBe(0);
    expect(f.calls()).toEqual(["start .live/a"]);
  });

  it("starts a build behind the running dashboard when the commit has moved", async () => {
    const f = fixture();
    f.build();
    f.change("apps/dashboard/page.tsx");
    rmSync(path.join(f.repo, "next-calls"));
    expect(f.serve().status).toBe(0);
    expect(f.calls()[0]).toMatch(/^(start \.live\/a|build \.live\/b)$/);
    for (let i = 0; i < 60 && f.current() !== `b ${f.head()}`; i++) await new Promise(resolve => setTimeout(resolve, 250));
    expect(f.current()).toBe(`b ${f.head()}`);
    expect(f.calls()).toContain("start .live/a");
    expect(f.calls()).toContain("build .live/b");
  });

  it("always runs next dev when asked, in a way that reaches a launchd job", () => {
    const f = fixture();
    f.build();
    rmSync(path.join(f.repo, "next-calls"));
    expect(f.serve({ ARCADIA_DASHBOARD_MODE: "dev" }).status).toBe(0);
    expect(f.calls()).toEqual(["dev -"]);
    rmSync(path.join(f.repo, "next-calls"));
    writeFileSync(path.join(f.live, "use-next-dev"), "");
    expect(f.serve().status).toBe(0);
    expect(f.calls()).toEqual(["dev -"]);
  });
});

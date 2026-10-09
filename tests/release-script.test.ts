import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Issue #1116: scripts/release.sh builds release tags into their own worktrees,
// smoke-tests a candidate on a staging port, and only then swaps `current`.
// Everything below runs against a temporary git repo with PATH shims standing
// in for pnpm, curl, launchctl, lsof and tailscale, so nothing touches the real
// releases directory, launchd, Tailscale or the live workspace.

const script = path.resolve(__dirname, "..", "scripts", "release.sh");
const roots: string[] = [];
// launchd runs the nightly job with /bin/bash (3.2 on macOS), so test with it
// rather than whatever newer bash the developer has first on PATH.
const BASH = existsSync("/bin/bash") ? "/bin/bash" : "bash";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com"
};

function git(cwd: string, args: string[], date?: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {})
    }
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function shim(dir: string, name: string, body: string): void {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

// A stand-in for `next start`: records how it was launched and stays up until
// it is signalled, like a real server.
const FAKE_NEXT = `
const fs = require("fs");
const dir = process.env.FAKE_DIR;
if (fs.existsSync(dir + "/fail_start")) process.exit(1);
fs.writeFileSync(dir + "/staging.json", JSON.stringify({
  argv: process.argv.slice(2), cwd: process.cwd(), cli: process.env.ARCADIA_DASHBOARD_CLI,
  workspace: process.env.ARCADIA_WORKSPACE
}));
fs.writeFileSync(dir + "/staging.up", String(process.pid));
const stop = () => { try { fs.unlinkSync(dir + "/staging.up"); } catch {} process.exit(0); };
// A server that ignores SIGTERM must still be stopped (with SIGKILL).
process.on("SIGTERM", fs.existsSync(dir + "/ignore_term") ? () => {} : stop);
process.on("SIGINT", stop);
setInterval(() => {}, 1000);
`;

interface Env {
  root: string;
  repo: string;
  origin: string;
  releases: string;
  fake: string;
  bin: string;
  home: string;
  run: (args: string[], extra?: Record<string, string>) => { status: number | null; stdout: string; stderr: string };
  tagAt: (tag: string, date: string) => string;
  setFlag: (name: string, content?: string) => void;
  clearFlag: (name: string) => void;
  log: (name: string) => string[];
  current: () => string | null;
  receipts: () => Array<Record<string, string>>;
}

const DAYS: Array<[string, string]> = [
  ["v1.0.0", "2026-01-01T12:00:00Z"],
  ["v1.1.0", "2026-02-01T12:00:00Z"],
  ["rel-2", "2026-03-01T12:00:00Z"],
  ["release-3", "2026-04-01T12:00:00Z"],
  ["V2.0-rc", "2026-05-01T12:00:00Z"],
  // None of these is a release tag: the pattern must not match them even
  // though they are newer than every release.
  ["archive/old", "2026-06-01T12:00:00Z"],
  ["feature-x", "2026-07-01T12:00:00Z"],
  ["nightly-notes", "2026-07-02T12:00:00Z"],
  // A release-shaped tag whose name is not a safe directory name: newest of
  // all, and must never be picked.
  ["rel-a/b", "2026-08-01T12:00:00Z"]
];

function makeEnv(): Env {
  // realpath: macOS reports git worktrees under /private/var, not /var.
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-release-")));
  roots.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  const releases = path.join(root, "releases");
  const fake = path.join(root, "fake");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  for (const dir of [fake, bin, home]) mkdirSync(dir, { recursive: true });

  git(root, ["init", "-q", "--bare", "-b", "main", origin]);
  git(root, ["clone", "-q", origin, repo]);
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  mkdirSync(path.join(repo, "apps", "dashboard"), { recursive: true });
  writeFileSync(path.join(repo, "apps", "dashboard", "package.json"), "{}\n");
  // Present so every command runs through the (stubbed) mise, as in production.
  writeFileSync(path.join(repo, "mise.toml"), '[tools]\nnode = "22"\n');
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "base"], "2025-12-01T12:00:00Z");
  git(repo, ["push", "-q", "origin", "HEAD:refs/heads/main"]);

  const tagAt = (tag: string, date: string): string => {
    writeFileSync(path.join(repo, "README.md"), `${tag}\n`);
    git(repo, ["commit", "-q", "-am", `release ${tag}`], date);
    git(repo, ["tag", tag]);
    return git(repo, ["rev-parse", "HEAD"]);
  };
  for (const [tag, date] of DAYS) tagAt(tag, date);
  git(repo, ["push", "-q", "origin", "HEAD:refs/heads/main", "--tags"]);

  writeFileSync(path.join(fake, "next.js"), FAKE_NEXT);

  shim(bin, "pnpm", `
echo "$(basename "$PWD")|$*" >> "$FAKE_DIR/pnpm.log"
case "$1" in
  install)
    mkdir -p apps/dashboard/node_modules/next/dist/bin
    cp "$FAKE_DIR/next.js" apps/dashboard/node_modules/next/dist/bin/next
    exit 0 ;;
  build)
    if [ -f "$FAKE_DIR/fail_build" ] && { [ "$(cat "$FAKE_DIR/fail_build")" = "*" ] || [ "$(cat "$FAKE_DIR/fail_build")" = "$(basename "$PWD")" ]; }; then
      echo "boom: tsc failed" >&2; exit 1
    fi
    mkdir -p dist/src
    # a stand-in CLI that records \`ping\` invocations
    cat > dist/src/cli.js <<'JS'
const fs = require("fs");
if (process.argv[2] === "ping") fs.appendFileSync(process.env.FAKE_DIR + "/ping.log", process.argv.slice(2).join(" ") + "\\n");
JS
    exit 0 ;;
  exec)
    mkdir -p .next && echo "id-$(basename "$(dirname "$(dirname "$PWD")")")" > .next/BUILD_ID
    exit 0 ;;
esac
exit 1`);
  shim(bin, "curl", `
url=""
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
rest="\${url#http://127.0.0.1:}"
port="\${rest%%/*}"
urlpath="/\${rest#*/}"
echo "$port$urlpath" >> "$FAKE_DIR/curl.log"
if [ "$port" = "$FAKE_STAGING_PORT" ]; then
  if [ ! -f "$FAKE_DIR/staging.up" ]; then printf 000; exit 7; fi
  if [ -f "$FAKE_DIR/fail_paths" ] && grep -qx "$urlpath" "$FAKE_DIR/fail_paths"; then printf 500; exit 0; fi
  printf 200; exit 0
fi
if [ -f "$FAKE_DIR/demo_code" ]; then printf '%s' "$(cat "$FAKE_DIR/demo_code")"; exit 0; fi
# demo_build: the build id the running demo process serves. Another release's
# static assets 404 on it, like the outgoing process answering for the old build.
case "$urlpath" in
  /_next/static/*)
    if [ -f "$FAKE_DIR/demo_build" ] && [ "$urlpath" != "/_next/static/$(cat "$FAKE_DIR/demo_build")/_buildManifest.js" ]; then printf 404; exit 0; fi ;;
esac
printf 200`);
  // mise -C <dir> exec -- <command...>: log it, then run the command in <dir>.
  shim(bin, "mise", `
echo "$*" >> "$FAKE_DIR/mise.log"
dir="$2"
shift 4
cd "$dir" && exec "$@"`);
  shim(bin, "launchctl", `
echo "$*" >> "$FAKE_DIR/launchctl.log"
case "$1" in
  print) [ -f "$FAKE_DIR/loaded" ] ;;
  kickstart) [ ! -f "$FAKE_DIR/fail_kickstart" ] ;;
  *) exit 0 ;;
esac`);
  shim(bin, "tailscale", `echo "$*" >> "$FAKE_DIR/tailscale.log"`);
  shim(bin, "lsof", "exit 0");
  shim(bin, "notify", `echo "$1|$2" >> "$FAKE_DIR/notify.log"`);
  writeFileSync(path.join(fake, "loaded"), "");

  const stagingPort = "39031";
  const baseEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...GIT_ENV,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    FAKE_DIR: fake,
    FAKE_STAGING_PORT: stagingPort,
    ARCADIA_RELEASE_REPO: repo,
    ARCADIA_RELEASES_DIR: releases,
    ARCADIA_DEMO_PORT: "39030",
    ARCADIA_DEMO_STAGING_PORT: stagingPort,
    ARCADIA_WORKSPACE: path.join(root, "workspace"),
    // Generous so a loaded CI runner cannot fail a healthy deploy; tests that
    // expect a timeout shorten them.
    ARCADIA_DEMO_SMOKE_BUDGET: "30",
    ARCADIA_DEMO_SMOKE_INTERVAL: "1",
    ARCADIA_DEMO_HEALTH_BUDGET: "30",
    ARCADIA_DEMO_STOP_GRACE: "1",
    // The hook is a recorder: no test ever sends a real ping.
    ARCADIA_RELEASE_NOTIFY_CMD: path.join(bin, "notify"),
    ARCADIA_MISE_BIN: path.join(bin, "mise")
  };

  const readLines = (name: string): string[] => {
    const file = path.join(fake, name);
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  };

  return {
    root,
    repo,
    origin,
    releases,
    fake,
    bin,
    home,
    run: (args, extra = {}) => {
      const result = spawnSync(BASH, [script, ...args], { encoding: "utf8", env: { ...baseEnv, ...extra } });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    tagAt,
    setFlag: (name, content = "1") => writeFileSync(path.join(fake, name), content),
    clearFlag: (name) => rmSync(path.join(fake, name), { force: true }),
    log: readLines,
    current: () => {
      const link = path.join(releases, "current");
      return existsSync(link) || lstatSync(link, { throwIfNoEntry: false }) ? readlinkSync(link) : null;
    },
    receipts: () => {
      const file = path.join(releases, "receipts.jsonl");
      return existsSync(file)
        ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, string>)
        : [];
    }
  };
}

/** A release tag that exists on the remote only: main advances, the tag is created on origin. */
function publishTag(env: Env, tag: string, date: string): void {
  writeFileSync(path.join(env.repo, "README.md"), `${tag}\n`);
  git(env.repo, ["commit", "-q", "-am", `release ${tag}`], date);
  git(env.repo, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  git(env.origin, ["tag", tag, git(env.repo, ["rev-parse", "HEAD"])]);
}

const kickstarts = (env: Env): string[] => env.log("launchctl.log").filter((line) => line.startsWith("kickstart"));

describe("scripts/release.sh (Issue #1116)", () => {
  it("matches only release tags and lists them newest first", () => {
    const env = makeEnv();
    const result = env.run(["list"]);
    expect(result.status).toBe(0);
    const tags = result.stdout.split("Available release tags (newest first):")[1]
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    // Case-insensitive v<digit>, rel- and release-; ordered by creator date.
    expect(tags).toEqual(["V2.0-rc", "release-3", "rel-2", "v1.1.0", "v1.0.0"]);
    expect(result.stdout).not.toContain("archive/old");
    expect(result.stdout).not.toContain("feature-x");
    expect(result.stdout).not.toContain("nightly-notes");
    expect(result.stdout).not.toContain("rel-a/b");
  });

  it("refuses tags outside the release pattern or with unsafe names", () => {
    const env = makeEnv();
    for (const bad of ["feature-x", "archive/old", "v1.0;touch-pwned", "../v1.0.0"]) {
      const result = env.run(["build", bad]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Not a release tag");
    }
    expect(existsSync(path.join(env.releases, "feature-x"))).toBe(false);
    const missing = env.run(["deploy", "v9.9.9"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("No such tag");
  });

  it("builds a tag into its own detached worktree with a frozen offline install", () => {
    const env = makeEnv();
    const result = env.run(["build", "v1.0.0"]);
    expect(result.status).toBe(0);
    const dir = path.join(env.releases, "v1.0.0");
    expect(existsSync(path.join(dir, ".release-ok"))).toBe(true);
    expect(existsSync(path.join(dir, "dist", "src", "cli.js"))).toBe(true);
    expect(existsSync(path.join(dir, "apps", "dashboard", ".next", "BUILD_ID"))).toBe(true);
    expect(env.log("pnpm.log")).toEqual([
      "v1.0.0|install --frozen-lockfile --prefer-offline",
      "v1.0.0|build",
      "dashboard|exec next build"
    ]);
    // A detached worktree of the primary repo, at the tag's commit.
    expect(git(dir, ["rev-parse", "HEAD"])).toBe(git(env.repo, ["rev-parse", "refs/tags/v1.0.0^{commit}"]));
    expect(spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: dir, env: { ...process.env, ...GIT_ENV } }).status).not.toBe(0); // detached
    expect(git(env.repo, ["worktree", "list", "--porcelain"])).toContain(`worktree ${dir}`);
    expect(env.current()).toBeNull();
  });

  it("deploys: smoke-tests on the staging port, swaps current, kickstarts, writes a receipt", () => {
    const env = makeEnv();
    const result = env.run(["deploy", "v1.0.0"]);
    expect(result.status).toBe(0);
    expect(env.current()).toBe("v1.0.0");
    expect(lstatSync(path.join(env.releases, "current")).isSymbolicLink()).toBe(true);

    // The candidate ran from its own release directory, on the staging port,
    // against the configured workspace and the release's own built CLI.
    const staging = JSON.parse(readFileSync(path.join(env.fake, "staging.json"), "utf8")) as Record<string, unknown>;
    expect(staging.argv).toEqual(["start", "-H", "127.0.0.1", "-p", "39031"]);
    expect(String(staging.cwd)).toMatch(/releases\/v1\.0\.0\/apps\/dashboard$/);
    expect(staging.cli).toBe("built");
    expect(staging.workspace).toBe(path.join(env.root, "workspace"));
    // ...and has been stopped again before the swap.
    expect(existsSync(path.join(env.fake, "staging.up"))).toBe(false);

    // The first probe can race the server booting, so collapse consecutive retries.
    const probed = env.log("curl.log").filter((line, i, all) => line.startsWith("39031/") && line !== all[i - 1]);
    expect(probed).toEqual(["39031/now", "39031/actions", "39031/review", "39031/projects", "39031/api/snapshot"]);
    expect(kickstarts(env)).toEqual([`kickstart -k gui/${process.getuid?.() ?? 0}/com.arcadia.demo.dashboard`]);

    const receipts = env.receipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ command: "deploy", tag: "v1.0.0", outcome: "ok", current: "v1.0.0" });
    expect(receipts[0].sha).toBe(git(env.repo, ["rev-parse", "refs/tags/v1.0.0^{commit}"]));

    // `current` is a pointer, never listed as a release of its own.
    const listed = env.run(["list"]).stdout.split("Available release tags")[0];
    expect(listed).toContain("v1.0.0  built");
    expect(listed).toContain("<- current");
    expect(listed).not.toMatch(/^\s+current\s/m);

    const status = env.run(["status"]);
    expect(status.stdout).toContain("Current:   v1.0.0");
    expect(status.stdout).toContain("Serving:   yes");
    expect(status.stdout).toContain('"outcome":"ok"');
  });

  it("keeps current when the build fails", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    env.setFlag("fail_build", "v1.1.0");

    const result = env.run(["deploy", "v1.1.0"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("build failed at step 'pnpm build'");
    expect(env.current()).toBe("v1.0.0");
    expect(existsSync(path.join(env.releases, "v1.1.0", ".release-ok"))).toBe(false);
    expect(existsSync(path.join(env.releases, "v1.1.0"))).toBe(false);
    expect(kickstarts(env)).toHaveLength(1); // only the first deploy restarted anything
    expect(env.receipts().at(-1)).toMatchObject({ tag: "v1.1.0", outcome: "failed", previous: "v1.0.0", current: "v1.0.0" });
    expect(env.receipts().at(-1)!.reason).toContain("build failed");
  });

  it("keeps current when the smoke check fails, and stops the staging server", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    env.setFlag("fail_paths", "/review\n");
    const probesBefore = env.log("curl.log").length;

    const result = env.run(["deploy", "v1.1.0"], { ARCADIA_DEMO_SMOKE_BUDGET: "2" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("smoke check failed: /review returned HTTP 500");
    expect(env.current()).toBe("v1.0.0");
    expect(kickstarts(env)).toHaveLength(1);
    expect(existsSync(path.join(env.fake, "staging.up"))).toBe(false);
    expect(env.receipts().at(-1)).toMatchObject({ tag: "v1.1.0", outcome: "failed", current: "v1.0.0" });
    // The failure happened on /review, so /projects was never probed.
    expect(env.log("curl.log").slice(probesBefore)).not.toContain("39031/projects");
  });

  it("keeps current when the staging server never comes up", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    // A dashboard that exits immediately must fail the smoke check, not hang.
    env.setFlag("fail_start");
    const result = env.run(["deploy", "rel-2"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("staging server exited before /now answered");
    expect(env.current()).toBe("v1.0.0");
    expect(kickstarts(env)).toHaveLength(1);
  });

  it("restores the previous release when the restart fails", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    env.setFlag("fail_kickstart");
    const result = env.run(["deploy", "v1.1.0"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("kickstart");
    expect(env.current()).toBe("v1.0.0");
  });

  it("restores the previous release when the swapped demo does not answer", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    env.setFlag("demo_code", "500");
    const result = env.run(["deploy", "v1.1.0"], { ARCADIA_DEMO_HEALTH_BUDGET: "2" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("did not answer on :39030");
    expect(env.current()).toBe("v1.0.0");
    // swapped and kicked, then put back and kicked again
    expect(kickstarts(env)).toHaveLength(3);
  });

  it("deploys without restarting when the demo agent is not installed yet", () => {
    const env = makeEnv();
    env.clearFlag("loaded");
    const result = env.run(["deploy", "v1.0.0"]);
    expect(result.status).toBe(0);
    expect(env.current()).toBe("v1.0.0");
    expect(kickstarts(env)).toHaveLength(0);
    expect(result.stderr).toContain("not installed");
  });

  it("fails over instantly to a built tag with no build or smoke step", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    expect(env.run(["deploy", "v1.1.0"]).status).toBe(0);
    expect(env.current()).toBe("v1.1.0");
    const pnpmCalls = env.log("pnpm.log").length;
    const curlCalls = env.log("curl.log").filter((line) => line.startsWith("39031/")).length;

    const result = env.run(["use", "v1.0.0"]);
    expect(result.status).toBe(0);
    expect(env.current()).toBe("v1.0.0");
    expect(kickstarts(env)).toHaveLength(3);
    expect(env.log("pnpm.log")).toHaveLength(pnpmCalls);
    expect(env.log("curl.log").filter((line) => line.startsWith("39031/"))).toHaveLength(curlCalls);
    expect(env.receipts().at(-1)).toMatchObject({ command: "use", tag: "v1.0.0", outcome: "ok", previous: "v1.1.0" });
  });

  it("refuses to use a tag that is not built", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    const result = env.run(["use", "rel-2"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("rel-2 is not built");
    expect(env.current()).toBe("v1.0.0");
    expect(kickstarts(env)).toHaveLength(1);
    expect(existsSync(path.join(env.releases, "rel-2"))).toBe(false);
  });

  it("nightly is a no-op when the newest release tag is already current", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "V2.0-rc"]).status).toBe(0);
    const before = kickstarts(env).length;
    const pnpmBefore = env.log("pnpm.log").length;

    const result = env.run(["nightly"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("V2.0-rc is already serving");
    expect(kickstarts(env)).toHaveLength(before);
    expect(env.log("pnpm.log")).toHaveLength(pnpmBefore);
    expect(env.log("notify.log")).toEqual([]);
    expect(env.receipts().at(-1)).toMatchObject({ command: "nightly", outcome: "noop", tag: "V2.0-rc" });
  });

  it("nightly does not undo a failover; an explicit deploy resumes it", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    expect(env.run(["deploy", "v1.1.0"]).status).toBe(0);
    expect(env.run(["use", "v1.0.0"]).status).toBe(0);
    expect(env.run(["status"]).stdout).toContain("Pinned:    v1.0.0");
    const kicks = kickstarts(env).length;

    // V2.0-rc is the newest release tag, but the operator failed over on purpose.
    const paused = env.run(["nightly"]);
    expect(paused.status).toBe(0);
    expect(paused.stdout).toContain("nightly is paused");
    expect(env.current()).toBe("v1.0.0");
    expect(kickstarts(env)).toHaveLength(kicks);
    expect(env.log("notify.log")).toEqual([]);

    expect(env.run(["deploy", "v1.1.0"]).status).toBe(0);
    expect(env.run(["nightly"]).status).toBe(0);
    expect(env.current()).toBe("V2.0-rc");
  });

  it("nightly fetches tags, deploys the newest, and notifies; a failing one notifies attention", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "V2.0-rc"]).status).toBe(0);

    // A newer release tag appears on the remote only.
    writeFileSync(path.join(env.repo, "README.md"), "v3\n");
    git(env.repo, ["commit", "-q", "-am", "v3"], "2026-08-01T12:00:00Z");
    const sha = git(env.repo, ["rev-parse", "HEAD"]);
    git(env.repo, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
    git(env.origin, ["tag", "v3.0.0", sha]);
    expect(git(env.repo, ["tag", "-l", "v3.0.0"])).toBe("");

    const ok = env.run(["nightly"]);
    expect(ok.status).toBe(0);
    expect(env.current()).toBe("v3.0.0");
    expect(env.log("notify.log")).toEqual([expect.stringMatching(/^fyi\|Demo is now serving v3\.0\.0/)]);

    // The next tag fails to build: still serving v3.0.0, and the operator is told.
    writeFileSync(path.join(env.repo, "README.md"), "v31\n");
    git(env.repo, ["commit", "-q", "-am", "v31"], "2026-09-01T12:00:00Z");
    git(env.repo, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
    const sha31 = git(env.repo, ["rev-parse", "HEAD"]);
    git(env.origin, ["tag", "v3.1.0", sha31]);
    env.setFlag("fail_build", "v3.1.0");
    const failed = env.run(["nightly"]);
    expect(failed.status).not.toBe(0);
    expect(env.current()).toBe("v3.0.0");
    const notes = env.log("notify.log");
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatch(/^attention\|Demo deploy of v3\.1\.0 FAILED: build failed/);
  });

  it("nightly pings through the release's own mise toolchain by default", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "V2.0-rc"]).status).toBe(0);
    publishTag(env, "v3.0.0", "2026-08-02T12:00:00Z");

    // No hook: the default `ping send`, run via `mise -C <current> exec -- node <current>/dist/src/cli.js`.
    const result = env.run(["nightly"], { ARCADIA_RELEASE_NOTIFY_CMD: "", ARCADIA_AGENT: "claude" });
    expect(result.status).toBe(0);
    const current = path.join(env.releases, "current");
    const via = env.log("mise.log").filter((line) => line.includes(" ping send "));
    expect(via).toHaveLength(1);
    expect(via[0]).toBe(
      `-C ${current} exec -- node ${current}/dist/src/cli.js ping send --kind fyi --agent claude ` +
        `--workspace ${path.join(env.root, "workspace")} -- Demo is now serving v3.0.0 (was V2.0-rc) on :39030.`
    );
    expect(env.log("ping.log")).toEqual([
      `ping send --kind fyi --agent claude --workspace ${path.join(env.root, "workspace")} -- Demo is now serving v3.0.0 (was V2.0-rc) on :39030.`
    ]);
  });

  it("nightly records and pings when it cannot take the lock or find the repository", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    // A live process (this one) holds the lock.
    mkdirSync(path.join(env.releases, ".lock"));
    writeFileSync(path.join(env.releases, ".lock", "pid"), `${process.pid}\n`);
    const locked = env.run(["nightly"]);
    expect(locked.status).toBe(1);
    expect(locked.stderr).toContain("another release operation is running");
    expect(env.receipts().at(-1)).toMatchObject({ command: "nightly", outcome: "failed", current: "v1.0.0" });
    expect(env.log("notify.log")[0]).toMatch(/^attention\|Demo nightly could not run: another release operation/);
    expect(existsSync(path.join(env.releases, ".lock"))).toBe(true); // not ours: left alone
    rmSync(path.join(env.releases, ".lock"), { recursive: true });

    const noRepo = env.run(["nightly"], { ARCADIA_RELEASE_REPO: path.join(env.root, "missing") });
    expect(noRepo.status).toBe(1);
    expect(env.log("notify.log")).toHaveLength(2);
    expect(env.log("notify.log")[1]).toMatch(/^attention\|Demo nightly could not run: cannot resolve the primary repository/);
    expect(env.current()).toBe("v1.0.0");
  });

  it("only deploys tags that are ancestors of origin/main", () => {
    const env = makeEnv();
    // A release-shaped tag on a side branch that never reached main.
    git(env.repo, ["checkout", "-q", "-b", "side"]);
    env.tagAt("v9.0.0", "2026-08-05T12:00:00Z");
    git(env.repo, ["checkout", "-q", "main"]);

    const result = env.run(["deploy", "v9.0.0"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not an ancestor of origin/main");
    expect(existsSync(path.join(env.releases, "v9.0.0"))).toBe(false);
    expect(env.current()).toBeNull();
    expect(env.receipts().at(-1)).toMatchObject({ tag: "v9.0.0", outcome: "failed" });

    // ...and nightly, which would pick it as the newest tag, refuses it too.
    const nightly = env.run(["nightly"]);
    expect(nightly.status).not.toBe(0);
    expect(env.log("notify.log")[0]).toMatch(/^attention\|Demo deploy of v9.0.0 FAILED: v9.0.0 is not an ancestor/);
  });

  it("refuses to serve or reuse a build whose tag has since moved", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    expect(env.run(["deploy", "v1.1.0"]).status).toBe(0);
    const built = git(env.repo, ["rev-parse", "refs/tags/v1.0.0^{commit}"]);

    // v1.0.0 is force-moved to a newer commit on main.
    writeFileSync(path.join(env.repo, "README.md"), "moved\n");
    git(env.repo, ["commit", "-q", "-am", "moved"], "2026-08-10T12:00:00Z");
    git(env.repo, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
    git(env.repo, ["tag", "-f", "v1.0.0"]);
    const moved = git(env.repo, ["rev-parse", "refs/tags/v1.0.0^{commit}"]);
    expect(moved).not.toBe(built);

    const use = env.run(["use", "v1.0.0"]);
    expect(use.status).toBe(2);
    expect(use.stderr).toContain("refusing to serve a stale build");
    expect(env.current()).toBe("v1.1.0");

    // Not serving, so deploy rebuilds it from the new commit.
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    expect(env.current()).toBe("v1.0.0");
    expect(readFileSync(path.join(env.releases, "v1.0.0", ".release-ok"), "utf8")).toContain(`sha=${moved}`);

    // Serving v1.0.0 while the tag moves again: refuse to rebuild in place.
    writeFileSync(path.join(env.repo, "README.md"), "moved again\n");
    git(env.repo, ["commit", "-q", "-am", "moved again"], "2026-08-11T12:00:00Z");
    git(env.repo, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
    git(env.repo, ["tag", "-f", "v1.0.0"]);
    const again = env.run(["deploy", "v1.0.0"]);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toContain("the tag moved since it was built");
    expect(env.current()).toBe("v1.0.0");
  });

  it("force-kills a staging server that ignores SIGTERM", () => {
    const env = makeEnv();
    env.setFlag("ignore_term");
    const result = env.run(["deploy", "v1.0.0"]);
    expect(result.status).toBe(0);
    const pid = Number(readFileSync(path.join(env.fake, "staging.up"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(); // gone, not left holding the port
  });

  it("checks the demo for this release's build id, so the outgoing process cannot pass", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    // The demo keeps answering as v1.0.0 even after the swap and kickstart.
    env.setFlag("demo_build", "id-v1.0.0");
    const result = env.run(["deploy", "v1.1.0"], { ARCADIA_DEMO_HEALTH_BUDGET: "2" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("did not answer on :39030");
    // The restored v1.0.0 is verified too, and does serve.
    expect(result.stderr).toContain("restored v1.0.0");
    expect(result.stderr).not.toContain("NOT answering");
    expect(env.current()).toBe("v1.0.0");
    const probed = env.log("curl.log").filter((line) => line.startsWith("39030/"));
    expect(probed).toContain("39030/_next/static/id-v1.1.0/_buildManifest.js");
    expect(probed).toContain("39030/_next/static/id-v1.0.0/_buildManifest.js");
    expect(probed).toContain("39030/api/snapshot");
  });

  it("says so when the restored release is not answering either", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    env.setFlag("demo_code", "500");
    const result = env.run(["deploy", "v1.1.0"], { ARCADIA_DEMO_HEALTH_BUDGET: "2" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("restored v1.0.0 but it is NOT answering");
  });

  it("treats an installed but unloaded agent as a failure, not a pre-install skip", () => {
    const env = makeEnv();
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    mkdirSync(path.join(env.home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(path.join(env.home, "Library", "LaunchAgents", "com.arcadia.demo.dashboard.plist"), "<plist/>");
    env.clearFlag("loaded");
    const result = env.run(["deploy", "v1.1.0"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exists but com.arcadia.demo.dashboard is not loaded");
    expect(env.current()).toBe("v1.0.0");
    expect(kickstarts(env)).toHaveLength(1);
  });

  it("prune leaves worktrees that are not releases alone", () => {
    const env = makeEnv();
    expect(env.run(["build", "v1.0.0"]).status).toBe(0);
    // Someone else's worktree whose directory is temporarily gone (an unmounted
    // volume, say): a repo-wide `git worktree prune` would forget it.
    const foreign = path.join(env.root, "somebody-elses-worktree");
    git(env.repo, ["worktree", "add", "-q", "--detach", foreign, "v1.1.0"]);
    rmSync(foreign, { recursive: true });

    expect(env.run(["prune"]).status).toBe(0);
    expect(git(env.repo, ["worktree", "list", "--porcelain"])).toContain(`worktree ${foreign}`);
  });

  it("prune keeps the newest 3 good builds plus current and removes the other worktrees", () => {
    const env = makeEnv();
    for (const tag of ["v1.0.0", "v1.1.0", "rel-2", "release-3", "V2.0-rc"]) {
      expect(env.run(["build", tag]).status).toBe(0);
    }
    // Current is the oldest build: it must survive in addition to the newest 3.
    expect(env.run(["deploy", "v1.0.0"]).status).toBe(0);
    // An abandoned, half-built directory is garbage too.
    git(env.repo, ["worktree", "add", "-q", "--detach", path.join(env.releases, "stale"), "v1.1.0"]);

    const result = env.run(["prune"]);
    expect(result.status).toBe(0);
    const left = ["v1.0.0", "v1.1.0", "rel-2", "release-3", "V2.0-rc", "stale"].filter((tag) =>
      existsSync(path.join(env.releases, tag))
    );
    expect(left).toEqual(["v1.0.0", "rel-2", "release-3", "V2.0-rc"]);
    const worktrees = git(env.repo, ["worktree", "list", "--porcelain"]);
    expect(worktrees).not.toContain("releases/v1.1.0");
    expect(worktrees).not.toContain("releases/stale");
    expect(env.current()).toBe("v1.0.0");
    expect(env.receipts().at(-1)).toMatchObject({ command: "prune", outcome: "ok" });
  });

  it("install-plan prints the agents and commands and executes none of them", () => {
    const env = makeEnv();
    const result = env.run(["install-plan"], {
      ARCADIA_WORKSPACE: "/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover",
      ARCADIA_RELEASES_DIR: "/Users/pmark/Dev/MR/Arcadia/releases",
      ARCADIA_DEMO_PORT: "3030"
    });
    expect(result.status).toBe(0);
    const out = result.stdout;
    expect(out).toContain("NOTHING BELOW HAS BEEN RUN");
    expect(out).toContain("<key>Label</key><string>com.arcadia.demo.dashboard</string>");
    expect(out).toContain("<key>Label</key><string>com.arcadia.demo.nightly</string>");
    expect(out).toContain("<key>KeepAlive</key><true/>");
    expect(out).toContain("<string>/Users/pmark/Dev/MR/Arcadia/releases/current/apps/dashboard/node_modules/next/dist/bin/next</string>");
    expect(out).toMatch(/<string>start<\/string>\s*<string>-H<\/string>\s*<string>0\.0\.0\.0<\/string>\s*<string>-p<\/string>\s*<string>3030<\/string>/);
    expect(out).toContain("<key>ARCADIA_WORKSPACE</key><string>/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover</string>");
    expect(out).toContain("<key>ARCADIA_DASHBOARD_CLI</key><string>built</string>");
    expect(out).toContain("<key>StartCalendarInterval</key>");
    expect(out).toContain("<key>Hour</key><integer>4</integer>");
    expect(out).toContain("arcadia-demo/dashboard.out.log");
    expect(out).toContain("launchctl bootstrap");
    expect(out).toContain("tailscale serve --bg --https=443 http://127.0.0.1:3030");
    // The nightly job runs the script from the serving release, not the primary checkout.
    expect(out).toMatch(/<string>\/bin\/bash<\/string>\s*<string>\/Users\/pmark\/Dev\/MR\/Arcadia\/releases\/current\/scripts\/release\.sh<\/string>\s*<string>nightly<\/string>/);

    expect(existsSync(path.join(env.fake, "launchctl.log"))).toBe(false);
    expect(existsSync(path.join(env.fake, "tailscale.log"))).toBe(false);
    expect(existsSync(path.join(env.home, "Library"))).toBe(false);
    expect(existsSync(env.releases)).toBe(false);
  });

  it("install-plan escapes XML metacharacters in paths", () => {
    const env = makeEnv();
    const result = env.run(["install-plan"], { ARCADIA_WORKSPACE: "/tmp/a&b<c>\"d" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<key>ARCADIA_WORKSPACE</key><string>/tmp/a&amp;b&lt;c&gt;&quot;d</string>");
  });
});

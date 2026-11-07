import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Issue #2183: a stale `com.arcadia.worker` launchd job held the worker lock, so the managed worker logged "already
 * running" and exited, and `services.sh status` said only `worker: stopped`. Status now names the holder of the
 * workspace's worker pidfile, read-only. The restart implementation, launchctl and ps are stubs, so nothing here
 * reaches the real launchd, and the pinned scripts/restart-services-impl.sh is not involved.
 */
const script = path.resolve(__dirname, "..", "scripts", "services.sh");
const UID = String(process.getuid?.() ?? 0);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface HostOptions {
  /** The pidfile's text; null writes none. */
  pidfile: string | null;
  /** `launchctl list` rows as [pid, label]. */
  launchdJobs?: [number, string][];
  /** What the stubbed implementation prints for the worker, and the status it exits with. */
  workerLine?: string;
  implExit?: number;
}

function host(options: HostOptions) {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-status-lock-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  const workspace = path.join(root, "workspace");
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  if (options.pidfile !== null) writeFileSync(path.join(workspace, ".arcadia", "worker.pid"), options.pidfile);

  const calls = path.join(root, "launchctl.calls");
  const stub = (file: string, body: string) => {
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
  };
  const rows = (options.launchdJobs ?? []).map(([pid, label]) => `printf '%s\\t0\\t%s\\n' ${pid} ${label}`).join("\n");
  stub(path.join(bin, "launchctl"), `echo "$*" >> "${calls}"\nif [[ "$1" == "list" ]]; then printf 'PID\\tStatus\\tLabel\\n'\n${rows}\nfi\nexit 0`);
  stub(path.join(bin, "ps"), 'if [[ "$*" == *command=* ]]; then echo "node /somewhere/src/cli.ts worker start"; fi\nexit 0');
  const impl = path.join(root, "impl.sh");
  stub(impl, `echo "intelligence: running (pid 1; http://127.0.0.1:4710/api/intelligence/health)"\necho "${options.workerLine ?? "worker: stopped"}"\necho "dashboard: running (pid 2)"\necho "Logs: /tmp/logs"\nexit ${options.implExit ?? 0}`);

  const status = () => spawnSync("bash", [script, "status"], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, ARCADIA_WORKSPACE: workspace, ARCADIA_RESTART_SCRIPT: impl }
  });
  return { status, launchctlCalls: () => (existsSync(calls) ? readFileSync(calls, "utf8") : "") };
}

describe.skipIf(os.platform() !== "darwin")("services status names the holder of the worker lock (Issue #2183)", () => {
  it("names the launchd job and the exact bootout remedy right under the stopped worker, and changes nothing", () => {
    const fixture = host({ pidfile: JSON.stringify({ pid: process.pid, owner: "token", at: Date.now() }), launchdJobs: [[process.pid, "com.arcadia.worker"]] });
    const result = fixture.status();
    expect(result.status).toBe(0);
    const lines = result.stdout.split("\n");
    const at = lines.indexOf("worker: stopped");
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toContain(`lock held by pid ${process.pid} (launchd job com.arcadia.worker)`);
    expect(lines[at + 2]).toContain(`launchctl bootout gui/${UID}/com.arcadia.worker`);
    expect(lines[at + 3]).toContain(`launchctl kickstart -k gui/${UID}/com.arcadia.local.`);
    // The other services' lines are unchanged and still follow.
    expect(lines[at + 4]).toBe("dashboard: running (pid 2)");
    // Read-only diagnosis: status lists jobs, nothing else.
    expect(fixture.launchctlCalls().trim().split("\n")).toEqual(["list"]);
  });

  it("reads a legacy decimal pidfile and names a holder that is no launchd job by its command, without a bootout remedy", () => {
    const fixture = host({ pidfile: `${process.pid}\n`, launchdJobs: [] });
    const out = fixture.status().stdout;
    expect(out).toContain(`lock held by pid ${process.pid} (not a launchd job: node /somewhere/src/cli.ts worker start)`);
    expect(out).toContain("stop that process first");
    expect(out).not.toContain("launchctl bootout");
  });

  it("stays quiet when the pidfile names no live process, there is no pidfile, or the worker is not stopped", () => {
    for (const fixture of [
      host({ pidfile: JSON.stringify({ pid: 2147483646, owner: "token", at: 1 }) }),
      host({ pidfile: null }),
      host({ pidfile: JSON.stringify({ pid: process.pid, owner: "token", at: Date.now() }), launchdJobs: [[process.pid, "com.arcadia.local.1.worker"]], workerLine: `worker: running (pid ${process.pid})` })
    ]) {
      const result = fixture.status();
      expect(result.stdout).not.toContain("lock held");
      expect(result.stdout).toMatch(/^worker: (stopped|running)/m);
    }
  });

  it("passes the implementation's exit status through", () => {
    const fixture = host({ pidfile: null, implExit: 1 });
    const result = fixture.status();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("worker: stopped");
  });
});

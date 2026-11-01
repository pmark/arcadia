import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertWorkerReplacementCustody, runWorkerInstallCommand, type ProtectedWorkerLaunch } from "../src/commands/worker.js";
import type { LaunchAgentAudit } from "../src/runtime/launchAgents.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Decision 0161: a START card reinstalls the live `com.arcadia.local.<key>.worker` agent (the label restart-services
 * writes) as the protected compiled worker and restarts it. launchd, the compiled-release check and the readiness wait
 * are fakes; HOME is a temporary directory, so no case touches the host's LaunchAgents.
 */
const LABEL = "com.arcadia.local.742852621.worker";
const temporary: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const noSession = { listTmuxPanes: () => [], listProcesses: () => [] };

const agent = (overrides: Partial<LaunchAgentAudit> = {}): LaunchAgentAudit => ({
  label: LABEL, plistPath: `/home/Library/LaunchAgents/${LABEL}.plist`, owner: "unmanaged", remedy: "", verdict: "pinned", program: "/opt/homebrew/bin/mise",
  pathHead: null, detail: "", workspace: null, role: "worker", duplicateLabels: [], ...overrides
});

describe("assertWorkerReplacementCustody", () => {
  it("takes over only the named live worker agent and reports an idle stray worker without touching it", () => {
    const idle = assertWorkerReplacementCustody("/workspace", LABEL, [agent(), agent({ label: "com.arcadia.worker", workspace: "/workspace" }), agent({ label: "com.arcadia.local.1.dashboard", role: "other" })], () => false, "/workspace");
    expect(idle).toEqual(["com.arcadia.worker"]);
  });
  it.each<[string, string, LaunchAgentAudit[], (label: string) => boolean, RegExp]>([
    ["a label outside the restart-services family", "com.arcadia.worker", [agent({ label: "com.arcadia.worker" })], () => false, /com\.arcadia\.local\.<key>\.worker/],
    ["a missing live agent", LABEL, [], () => false, /not one readable worker agent/],
    ["an unreadable live agent", LABEL, [agent({ verdict: "unreadable" })], () => false, /not one readable worker agent/],
    ["a live agent for another workspace", LABEL, [agent({ workspace: "/other" })], () => false, /not one readable worker agent/],
    ["any unreadable agent", LABEL, [agent(), agent({ label: "com.arcadia.demo.nightly", role: "other", verdict: "unreadable" })], () => false, /unreadable/],
    ["another running worker for this workspace", LABEL, [agent(), agent({ label: "com.arcadia.worker", workspace: "/workspace" })], (label) => label === "com.arcadia.worker", /Another worker agent com\.arcadia\.worker is running/]
  ])("refuses %s", (_label, label, agents, running, reason) => {
    expect(() => assertWorkerReplacementCustody("/workspace", label, agents, running, "/workspace")).toThrow(reason);
  });
  it("accepts a live agent with no --workspace only when the ambient default workspace is this one", () => {
    expect(() => assertWorkerReplacementCustody("/workspace", LABEL, [agent()], () => false, "/elsewhere")).toThrow(/not one readable worker agent/);
    expect(() => assertWorkerReplacementCustody("/workspace", LABEL, [agent()], () => false, null)).toThrow(/not one readable worker agent/);
    expect(assertWorkerReplacementCustody("/workspace", LABEL, [agent()], () => false, "/workspace")).toEqual([]);
  });
});

describe("worker install --replace-label", () => {
  function setup() {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-worker-replace-")));
    temporary.push(root);
    const workspace = path.join(root, "workspace");
    initWorkspace(workspace);
    const home = path.join(root, "home");
    mkdirSync(path.join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`), "<plist>source-run worker</plist>");
    vi.stubEnv("HOME", home);
    const release: ProtectedWorkerLaunch = { directory: path.join(root, "release"), runtimeExecutable: "/runtime/node", cliPath: path.join(root, "release", "dist", "src", "cli.js"), sourceRepository: path.join(root, "arcadia") };
    // launchd: `print` fails once the job is gone (after `printsBeforeGone` successful prints following bootout).
    let printsLeft = 0;
    const launchd = { printsBeforeGone: 0 };
    const exec = vi.fn((_file: string, args: readonly string[]) => {
      if (args[0] === "bootout") printsLeft = launchd.printsBeforeGone;
      if (args[0] === "print") { if (printsLeft <= 0) throw new Error("Could not find service"); printsLeft -= 1; }
      return "";
    });
    const sleeps: number[] = [];
    const deps = { ...noSession, execFileSync: exec as never, waitForRoutes: () => true, now: () => 1, resolveProtectedLaunch: () => release, ambientWorkspace: () => workspace, sleepMs: (ms: number) => { sleeps.push(ms); }, auditLaunchAgents: () => ({ directory: "", agents: [agent({ workspace })], counts: { pinned: 1, unpinned: 0, unreadable: 0, duplicate: 0 } }) };
    return { workspace, home, release, exec, deps, launchd, sleeps, plist: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`) };
  }

  it("rewrites the live label as the protected compiled plist, then boots it out and back in", () => {
    const s = setup();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, s.deps);
    const plist = readFileSync(s.plist, "utf8");
    expect(plist).toContain(`<string>${LABEL}</string>`);
    expect(plist).toContain(`<string>${s.release.runtimeExecutable}</string>\n    <string>${s.release.cliPath}</string>\n    <string>worker</string>\n    <string>start</string>`);
    expect(plist).toContain(`<key>WorkingDirectory</key>\n  <string>${s.release.directory}</string>`);
    expect(plist).not.toContain("tsx");
    expect(existsSync(`${s.plist}.tmp`)).toBe(false);
    const launchctl = s.exec.mock.calls.map(([, args]) => (args as string[])[0]);
    expect(launchctl).toEqual(["bootout", "print", "bootstrap"]);
    expect(s.exec.mock.calls[2][1]).toEqual(["bootstrap", `gui/${process.getuid?.() ?? 0}`, s.plist]);
  });

  it("waits, bounded, until launchd reports the old job gone before bootstrapping", () => {
    const s = setup();
    s.launchd.printsBeforeGone = 3;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, s.deps);
    expect(s.exec.mock.calls.map(([, args]) => (args as string[])[0])).toEqual(["bootout", "print", "print", "print", "print", "bootstrap"]);
    expect(s.sleeps).toEqual([250, 250, 250]);
  });

  it("fails closed on launchctl errors other than not loaded: a failed list query or bootout never proceeds", () => {
    const s = setup();
    const audit = () => ({ directory: "", agents: [agent({ workspace: s.workspace }), agent({ label: "com.arcadia.worker", workspace: s.workspace })], counts: { pinned: 2, unpinned: 0, unreadable: 0, duplicate: 0 } });
    const listFails = vi.fn((_file: string, args: readonly string[]) => { if (args[0] === "list") throw new Error("Operation not permitted"); return ""; });
    expect(() => runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, { ...s.deps, auditLaunchAgents: audit, execFileSync: listFails as never })).toThrow(/launchctl list com\.arcadia\.worker failed .* custody is unknown/);
    expect(listFails.mock.calls.some(([, args]) => (args as string[])[0] === "bootout")).toBe(false);
    const bootoutFails = vi.fn((_file: string, args: readonly string[]) => { if (args[0] === "bootout") throw new Error("Operation not permitted"); return ""; });
    expect(() => runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, { ...s.deps, execFileSync: bootoutFails as never })).toThrow(/bootout of .* failed/);
    expect(bootoutFails.mock.calls.some(([, args]) => (args as string[])[0] === "bootstrap")).toBe(false);
    // "not loaded" from bootout is tolerated.
    const notLoaded = vi.fn((_file: string, args: readonly string[]) => { if (args[0] === "bootout" || args[0] === "print") throw new Error("Boot-out failed: 3: No such process"); return ""; });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, { ...s.deps, execFileSync: notLoaded as never });
    expect(notLoaded.mock.calls.map(([, args]) => (args as string[])[0])).toEqual(["bootout", "print", "bootstrap"]);
  });

  it("refuses without bootstrapping when the old job never leaves launchd", () => {
    const s = setup();
    s.launchd.printsBeforeGone = 10_000;
    expect(() => runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, s.deps)).toThrow(/still reports .* after bootout \(30s\)/);
    expect(s.exec.mock.calls.some(([, args]) => (args as string[])[0] === "bootstrap")).toBe(false);
    expect(s.sleeps).toHaveLength(120);
  });

  it("refuses from source (no registered compiled release) and leaves the live plist untouched", () => {
    const s = setup();
    expect(() => runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, { ...s.deps, resolveProtectedLaunch: () => undefined })).toThrow(/only a protected worker/);
    expect(readFileSync(s.plist, "utf8")).toBe("<plist>source-run worker</plist>");
    expect(s.exec).not.toHaveBeenCalled();
  });

  it("fails closed when launchd will not bootstrap or the restarted worker never publishes heartbeats", () => {
    const s = setup();
    const failing = vi.fn((_file: string, args: readonly string[]) => {
      if (args[0] === "print") throw new Error("Could not find service");
      if (args[0] === "bootstrap") throw new Error("Input/output error");
      return "";
    });
    expect(() => runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, { ...s.deps, execFileSync: failing as never })).toThrow(/bootstrap failed .* The worker may be down/);
    expect(() => runWorkerInstallCommand({ workspace: s.workspace, replaceLabel: LABEL }, { ...s.deps, waitForRoutes: () => false })).toThrow(/did not publish fresh heartbeats/);
  });
});

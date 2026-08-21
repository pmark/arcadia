import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWorkerPlist } from "../src/commands/worker.js";
import { buildIngressServicePlist } from "../src/commands/ingressService.js";
import { runIngressRecoverCommand } from "../src/commands/ingress.js";
import { auditArcadiaLaunchAgents, launchAgentOwner, launchAgentRemedy } from "../src/runtime/launchAgents.js";
import { miseLeadingPath, miseNodeArgv } from "../src/runtime/mise.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporaries: string[] = [];

afterEach(() => {
  for (const directory of temporaries.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaries.push(directory);
  return directory;
}

describe("generated launch agents run under the pinned runtime", () => {
  // Both of these shipped a plist that ran a bare node/tsx path. The ingress
  // agent then died on every run for weeks with a better-sqlite3 ABI mismatch,
  // silently, because nothing rechecks a plist once it is written.
  it("routes the worker agent through mise rather than the installing shell's Node", () => {
    const plist = buildWorkerPlist({
      workspacePath: "/tmp/ws",
      repositoryRoot: "/repo",
      miseBin: "/opt/homebrew/bin/mise",
      logPath: "/tmp/ws/worker.log",
      home: "/Users/example"
    });

    const argv = miseNodeArgv("/opt/homebrew/bin/mise", "/repo");
    for (const argument of argv) {
      expect(plist).toContain(`<string>${argument}</string>`);
    }
    expect(plist).toContain(miseLeadingPath("/opt/homebrew/bin/mise", "/Users/example"));
    expect(plist).not.toContain("node_modules/.bin/tsx");
    expect(plist).not.toContain(process.execPath);
  });

  it("routes the ingress agent through mise", () => {
    const plist = buildIngressServicePlist({
      label: "com.arcadia.ingress.Test",
      plistPath: "/tmp/a.plist",
      logPath: "/tmp/a.log",
      errorLogPath: "/tmp/a.err.log",
      healthStatePath: "/tmp/a.json",
      workspacePath: "/tmp/ws",
      ingressRoot: "/tmp/root",
      source: "Test",
      intervalSeconds: 60,
      stableSeconds: 30,
      runSafe: false,
      cliPath: "/repo/src/cli.ts",
      tsxBin: "/repo/node_modules/tsx/dist/cli.mjs",
      miseBin: "/opt/homebrew/bin/mise",
      repositoryRoot: "/repo"
    });

    expect(plist).toContain("<string>/opt/homebrew/bin/mise</string>");
    expect(plist).toContain("<string>exec</string>");
  });

  it("reports an installed agent that bypasses mise, and one that does not", () => {
    const home = temporary("arcadia-agents-");
    const agents = path.join(home, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });

    const plist = (label: string, program: string, pathValue: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${program}</string><string>/repo/src/cli.ts</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${pathValue}</string></dict>
</dict>
</plist>`;

    writeFileSync(path.join(agents, "com.arcadia.good.plist"),
      plist("com.arcadia.good", "/opt/homebrew/bin/mise", "/opt/homebrew/bin:/usr/bin"), "utf8");
    writeFileSync(path.join(agents, "com.arcadia.bad.plist"),
      plist("com.arcadia.bad", "/Users/x/.nvm/versions/node/v22.23.1/bin/node", "/Users/x/.nvm/versions/node/v22.23.1/bin"), "utf8");
    // A non-Arcadia agent must be left alone entirely.
    writeFileSync(path.join(agents, "com.example.other.plist"),
      plist("com.example.other", "/usr/bin/true", "/usr/bin"), "utf8");

    const result = auditArcadiaLaunchAgents(home);

    expect(result.agents.map((agent) => agent.label)).toEqual(["com.arcadia.bad", "com.arcadia.good"]);
    expect(result.counts).toMatchObject({ pinned: 1, unpinned: 1 });
    expect(result.agents.find((agent) => agent.label === "com.arcadia.bad")?.detail).toContain("instead of through mise");
  });

  it("flags an agent that calls mise but leads PATH with another runtime", () => {
    const home = temporary("arcadia-agents-shadow-");
    const agents = path.join(home, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(path.join(agents, "com.arcadia.shadowed.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.arcadia.shadowed</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/mise</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/Cellar/node/25.6.1/bin:/opt/homebrew/bin</string></dict>
</dict>
</plist>`, "utf8");

    const result = auditArcadiaLaunchAgents(home);
    expect(result.counts.unpinned).toBe(1);
    expect(result.agents[0]?.detail).toContain("shadows the runtime mise would select");
  });

  it("names a remedy that actually replaces the agent, not one that duplicates it", () => {
    // launchd keys on label. Telling the operator to run `arcadia worker
    // install` against com.arcadia.local.<uid>.worker would leave two workers
    // running, so an agent no installer owns must not be given that advice.
    expect(launchAgentOwner("com.arcadia.ingress.iCloudIdeas")).toBe("ingress-service");
    expect(launchAgentRemedy("com.arcadia.ingress.iCloudIdeas")).toBe("arcadia ingress service install");

    expect(launchAgentOwner("com.arcadia.worker")).toBe("worker");
    expect(launchAgentRemedy("com.arcadia.worker")).toBe("arcadia worker install");

    expect(launchAgentOwner("com.arcadia.local.742852621.worker")).toBe("unmanaged");
    expect(launchAgentRemedy("com.arcadia.local.742852621.worker")).not.toContain("arcadia worker install");
    expect(launchAgentRemedy("com.arcadia.local.742852621.worker")).toContain("second agent");
  });
});

describe("ingress recover", () => {
  function stagedWorkspace(): { workspace: string; root: string; processing: string; inbox: string } {
    const workspace = temporary("arcadia-recover-ws-");
    initWorkspace(workspace);
    const root = temporary("arcadia-recover-root-");
    const processing = path.join(root, "iCloudIdeas", "Processing");
    const inbox = path.join(root, "iCloudIdeas", "In");
    mkdirSync(processing, { recursive: true });
    mkdirSync(inbox, { recursive: true });
    return { workspace, root, processing, inbox };
  }

  it("previews without moving anything, then requeues on --apply", () => {
    const { workspace, root, processing, inbox } = stagedWorkspace();
    writeFileSync(path.join(processing, "stranded.txt"), "a note", "utf8");

    const preview = runIngressRecoverCommand({ workspace, ingressRoot: root });
    expect(preview.data.files[0]).toMatchObject({ name: "stranded.txt", action: "would_requeue" });
    expect(readdirSync(inbox)).toEqual([]);

    const applied = runIngressRecoverCommand({ workspace, ingressRoot: root, apply: true });
    expect(applied.data.files[0]).toMatchObject({ name: "stranded.txt", action: "requeued" });
    expect(readdirSync(inbox)).toEqual(["stranded.txt"]);
    expect(readdirSync(processing)).toEqual([]);
  });

  it("leaves workflow output directories alone", () => {
    const { workspace, root, processing } = stagedWorkspace();
    mkdirSync(path.join(processing, "rehearsal-out"), { recursive: true });

    const result = runIngressRecoverCommand({ workspace, ingressRoot: root, apply: true });
    expect(result.data.files[0]).toMatchObject({ name: "rehearsal-out", action: "skipped" });
    expect(readdirSync(processing)).toEqual(["rehearsal-out"]);
  });

  it("refuses a file a live pass still holds, and clears a dead holder's claim", () => {
    const { workspace, root, processing, inbox } = stagedWorkspace();
    writeFileSync(path.join(processing, "live.txt"), "held", "utf8");
    writeFileSync(path.join(processing, "dead.txt"), "abandoned", "utf8");
    writeFileSync(path.join(inbox, ".processing-live.txt.lock"), JSON.stringify({ pid: process.pid }), "utf8");
    // PID 1 exists but is not ours; use an unallocated high PID for the dead case.
    writeFileSync(path.join(inbox, ".processing-dead.txt.lock"), JSON.stringify({ pid: 2 ** 22 }), "utf8");

    const result = runIngressRecoverCommand({ workspace, ingressRoot: root, apply: true });
    const byName = Object.fromEntries(result.data.files.map((file) => [file.name, file]));

    expect(byName["live.txt"]).toMatchObject({ action: "skipped" });
    expect(byName["live.txt"]?.reason).toContain(String(process.pid));
    expect(byName["dead.txt"]).toMatchObject({ action: "requeued" });
    expect(readdirSync(inbox).sort()).toEqual([".processing-live.txt.lock", "dead.txt"]);
  });
});

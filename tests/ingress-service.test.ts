import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildIngressServicePlist,
  resolveIngressService,
  runIngressServiceDoctorCommand
} from "../src/commands/ingressService.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ingress service", () => {
  it("builds a shell-free periodic LaunchAgent with safe Workflow execution", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    const service = resolveIngressService({ workspace, ingressRoot, runSafe: true });
    const plist = buildIngressServicePlist(service);

    expect(plist).toContain("<string>com.arcadia.ingress.iCloudIdeas</string>");
    expect(plist).toContain("<integer>60</integer>");
    expect(plist).toContain(`<string>${ingressRoot}</string>`);
    expect(plist).toContain("<string>--run-safe</string>");
    expect(plist).toContain("<string>service</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<string>/dev/null</string>");
    expect(plist).not.toContain(".codex/tmp");
    expect(plist).not.toContain("/bin/sh");
    expect(plist).not.toContain("/bin/zsh");
  });

  it("reports readable local ingress folders independently of service installation", () => {
    const workspace = initializedWorkspace();
    const source = `TestSource-${process.pid}`;
    const ingressRoot = initializedIngressRoot(source);
    const result = runIngressServiceDoctorCommand({ workspace, ingressRoot, source });
    const byId = new Map(result.data.checks.map((check) => [check.id, check]));

    expect(byId.get("icloud-root")?.status).toBe("pass");
    expect(byId.get("icloud-inbox")?.status).toBe("pass");
    expect(byId.get("workflow")?.status).toBe("fail");
    expect(byId.get("service-installed")?.status).toBe("fail");
    expect(result.data.healthy).toBe(false);
  });

  it("rejects an interval that would create a noisy polling loop", () => {
    const workspace = initializedWorkspace();
    expect(() => resolveIngressService({ workspace, intervalSeconds: 5 })).toThrow(
      "Ingress service interval must be an integer of at least 15 seconds."
    );
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-ingress-service-workspace-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function initializedIngressRoot(source = "iCloudIdeas"): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-ingress-service-root-"));
  roots.push(root);
  mkdirSync(path.join(root, source, "In"), { recursive: true });
  return root;
}

import { describe, expect, it } from "vitest";
import { validateContainerAuditAuthority, type ContainerAuditAuthority } from "../src/sessions/containerBrowserAudit.js";

const authority = (): ContainerAuditAuthority => ({ schema: "arcadia-container-audit-authority-v1", project: "fixture", revision: "a".repeat(40), image: `sha256:${"b".repeat(64)}`, executorHash: "c".repeat(64), snapshotHash: "d".repeat(64), routes: ["/", "/about/"], viewports: [{width: 390, height: 844}, {width: 1440, height: 900}], expiresAt: new Date(Date.now()+60000).toISOString() });
describe("immutable container audit envelope", () => {
  it("accepts a bounded immutable scope", () => { expect(() => validateContainerAuditAuthority(authority())).not.toThrow(); });
  it("refuses mutable images, expired authority and URL/path injection", () => {
    for (const changes of [{image: "browser:latest"}, {revision: "main"}, {project: "../project"}, {expiresAt: "invalid"}, {expiresAt: new Date(0).toISOString()}, {routes: ["https://example.com/"]}, {routes: ["/../"]}, {routes: ["//host/"]}, {routes: ["/?token=secret"]}, {viewports: [{width: 100000, height: 844}]}, {command: "docker run"}]) {
      expect(() => validateContainerAuditAuthority({...authority(), ...changes})).toThrow("audit.authority");
    }
  });
});

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTAINER_AUDIT_REQUEST, containerAuditResponsePath, processContainerAuditRequest } from "../src/sessions/containerAuditTransport.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
function fixture() { const root = mkdtempSync(path.join(tmpdir(), "audit-transport-")); roots.push(root); const repository = path.join(root, "repository"), workspace = path.join(root, "workspace"); for (const p of [repository, workspace]) mkdirSync(path.join(p, ".arcadia"), {recursive: true}); return {repository, workspace}; }
describe("host audit request denial", () => {
  it("returns a refusal when no protected Grant exists", () => {
    const f = fixture(); const nonce = "12345678-1234-1234-1234-123456789abc";
    writeFileSync(path.join(f.repository, CONTAINER_AUDIT_REQUEST), JSON.stringify({nonce}));
    processContainerAuditRequest(f.workspace, f.repository);
    const response = JSON.parse(readFileSync(containerAuditResponsePath(f.workspace, nonce), "utf8"));
    expect(response.nonce).toBe(nonce); expect(response.ok).toBe(false); expect(response.error).toContain("ENOENT");
  });
  it("does not interpret an injected command or authority as a request", () => {
    const f = fixture();
    writeFileSync(path.join(f.repository, CONTAINER_AUDIT_REQUEST), JSON.stringify({nonce: "12345678-1234-1234-1234-123456789abc", command: "docker run", image: "browser:latest"}));
    processContainerAuditRequest(f.workspace, f.repository);
    expect(() => readFileSync(containerAuditResponsePath(f.workspace, "12345678-1234-1234-1234-123456789abc"))).toThrow();
  });
});

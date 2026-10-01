import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostBrowserAuditProfile, snapshotAuditSite } from "../src/sessions/hostBrowserAudit.js";

const fixtures: string[] = [];
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "audit-boundary-"));
  fixtures.push(root);
  const source = path.join(root, "source");
  mkdirSync(source);
  writeFileSync(path.join(source, "index.html"), "<h1>Fixture</h1>");
  return { root, source, destination: path.join(root, "snapshot") };
}
describe("inactive host browser audit preparation", () => {
  it("binds a read-only snapshot to content without modifying its source", () => {
    const f = fixture();
    const hash = snapshotAuditSite(f.source, f.destination);
    expect(hash).toHaveLength(64);
    expect(readFileSync(path.join(f.destination, "index.html"), "utf8")).toBe("<h1>Fixture</h1>");
    expect(snapshotAuditSite(f.source, path.join(f.root, "second"))).toBe(hash);
    writeFileSync(path.join(f.source, "index.html"), "<h1>Changed</h1>");
    expect(snapshotAuditSite(f.source, path.join(f.root, "third"))).not.toBe(hash);
    expect(() => snapshotAuditSite(f.source, path.join(f.source, "nested"))).toThrow("outside source");
  });
  it("refuses credentials, symbolic links, and oversized input before browser launch", () => {
    const f = fixture();
    writeFileSync(path.join(f.source, ".env"), "synthetic-only");
    expect(() => snapshotAuditSite(f.source, f.destination)).toThrow("hidden or credential-like");
    rmSync(path.join(f.source, ".env"));
    symlinkSync(path.join(f.source, "index.html"), path.join(f.source, "alias.html"));
    expect(() => snapshotAuditSite(f.source, f.destination)).toThrow("symbolic link");
    rmSync(path.join(f.source, "alias.html"));
    writeFileSync(path.join(f.source, "huge.dat"), Buffer.alloc(32 * 1024 * 1024 + 1));
    expect(() => snapshotAuditSite(f.source, f.destination)).toThrow("size limit");
  });
  it("allows one TCP port and only disposable Unix IPC, without a network wildcard", () => {
    const profile = hostBrowserAuditProfile({ port: 43123, scratch: "/private/tmp/audit-abc", worker: "/private/tmp/proof/worker.mjs", runtimeRoots: ["/trusted/node", "/trusted/playwright"], browserRoot: "/Applications/Google Chrome.app" });
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(remote ip "localhost:43123")');
    expect(profile).not.toContain('(remote ip "*")');
    expect(profile).not.toContain('(allow network*)');
    expect(profile).not.toContain('com.apple.securityd');
    expect(profile).not.toContain('(subpath "/Users")');
    expect(profile).toContain('(allow network-bind network-inbound network-outbound (subpath "/private/tmp/audit-abc"))');
    expect(() => hostBrowserAuditProfile({ port: 0, scratch: "x", worker: "x", runtimeRoots: [], browserRoot: "x" })).toThrow("invalid loopback port");
  });
});

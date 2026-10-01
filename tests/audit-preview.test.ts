import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { HOST_AUDIT_PREVIEW_MAX_SECONDS, startHostAuditPreview } from "../src/commands/auditPreview.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-audit-preview-"));
  roots.push(root);
  const site = path.join(root, "site");
  mkdirSync(path.join(site, "contact"), { recursive: true });
  writeFileSync(path.join(site, "index.html"), "<!doctype html><title>Audit</title>\n");
  writeFileSync(path.join(site, "contact", "index.html"), "<h1>Contact</h1>\n");
  writeFileSync(path.join(site, "contact", "local.css"), "h1 { color: green; }\n");
  writeFileSync(path.join(root, "secret.txt"), "not for serving\n");
  return { root, site, secret: path.join(root, "secret.txt") };
}

describe("host-owned audit preview", () => {
  it("serves only a static directory over loopback with bounded read-only methods", async () => {
    const f = fixture();
    const preview = await startHostAuditPreview(f.site, 60);
    try {
      expect(preview.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(preview.root).toBe(realpathSync(f.site));
      const home = await fetch(preview.url);
      expect(home.status).toBe(200);
      expect(home.headers.get("content-type")).toContain("text/html");
      expect(await home.text()).toContain("<title>Audit</title>");

      const route = await fetch(new URL("contact/", preview.url));
      expect(route.status).toBe(200);
      expect(await route.text()).toContain("<h1>Contact</h1>");
      const redirect = await fetch(new URL("contact?mode=preview", preview.url), { redirect: "manual" });
      expect(redirect.status).toBe(308);
      expect(redirect.headers.get("location")).toBe("/contact/?mode=preview");
      const asset = await fetch(new URL("contact/local.css", preview.url));
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("color: green");
      expect((await fetch(preview.url, { method: "HEAD" })).status).toBe(200);
      expect((await fetch(preview.url, { method: "POST" })).status).toBe(405);
      expect([403, 404]).toContain((await fetch(`${preview.url}%2e%2e/secret.txt`)).status);
    } finally { await preview.close(); }
  });

  it("refuses sandbox callers, invalid durations, and symlink escapes", async () => {
    const f = fixture();
    symlinkSync(f.secret, path.join(f.site, "outside.txt"));
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");
    await expect(startHostAuditPreview(f.site, 60)).rejects.toMatchObject({
      message: expect.stringContaining("plain host terminal")
    });
    vi.stubEnv("CODEX_SANDBOX", "");
    await expect(startHostAuditPreview(f.site, HOST_AUDIT_PREVIEW_MAX_SECONDS + 1)).rejects.toBeInstanceOf(ArcadiaError);
    const preview = await startHostAuditPreview(f.site, 60);
    try {
      const escaped = await fetch(new URL("outside.txt", preview.url));
      expect([403, 404]).toContain(escaped.status);
      expect(await escaped.text()).not.toContain("not for serving");
    } finally { await preview.close(); }
  });
});

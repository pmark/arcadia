import { readFileSync } from "node:fs";
import { runContainerBrowserAudit } from "../src/sessions/containerBrowserAudit.js";
import type { HostAuditGrant } from "../src/sessions/containerAuditTransport.js";
const [grantFile, receiptDirectory] = process.argv.slice(2);
if (process.argv.length !== 4 || process.env.CODEX_SANDBOX || !process.send) throw new Error("audit.host: fixed worker requires host IPC");
try {
  const grant = JSON.parse(readFileSync(grantFile, "utf8")) as HostAuditGrant;
  const result = await runContainerBrowserAudit({authority: grant.authority, repository: grant.repository, source: grant.source, receiptDirectory});
  process.send({ok: result.ready, ...result}, () => process.disconnect());
} catch (error) { process.send({ok: false, error: String(error)}, () => process.disconnect()); }

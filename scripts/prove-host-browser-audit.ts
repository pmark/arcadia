import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { proveHostBrowserAudit } from "../src/sessions/hostBrowserAudit.js";

if (process.argv.length !== 2) throw new Error("Fixture proof accepts no arguments, sources, or overrides.");
const root = path.resolve("artifacts/tmp/host-browser-audit");
mkdirSync(root, { recursive: true, mode: 0o700 });
const fixture = mkdtempSync(path.join(root, "proof-"));
const source = path.join(fixture, "fixture-source");
mkdirSync(source);
const html = '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Arcadia isolated HTTP audit fixture</title><body><h1>Host audit fixture</h1><script>document.body.dataset.rendered="yes"</script></body></html>';
writeFileSync(path.join(source, "index.html"), html);
const credentialSentinel = path.join(fixture, ".env");
writeFileSync(credentialSentinel, "SYNTHETIC_ONLY=not-a-credential\n", { mode: 0o600 });
const before = createHash("sha256").update(readFileSync(path.join(source, "index.html"))).digest("hex");
const socketSentinel = path.join("/private/tmp", `ahba-deny-${process.pid}.sock`);
const socket = net.createServer(connection => connection.end());
await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(socketSentinel, resolve); });
let result;
let fault;
try {
  result = await proveHostBrowserAudit({ source, receiptDirectory: fixture, credentialSentinel, socketSentinel });
  const faultDirectory = path.join(fixture, "timeout-proof");
  mkdirSync(faultDirectory);
  fault = await proveHostBrowserAudit({ source, receiptDirectory: faultDirectory, credentialSentinel, socketSentinel, scenario: "stall-after-launch" });
}
finally { await new Promise<void>(resolve => socket.close(() => resolve())); }
const after = createHash("sha256").update(readFileSync(path.join(source, "index.html"))).digest("hex");
const failure = JSON.parse(readFileSync(fault.receipt, "utf8")) as { timedOut: boolean; stage: string; processGroupStopped: boolean; childPids: number[] };
const timeoutProven = !fault.ready && failure.timedOut && failure.stage === "browser.fault.stall" && failure.processGroupStopped && failure.childPids.length > 0;
console.log(JSON.stringify({ ...result, faultReceipt: fault.receipt, timeoutProven, sourceUnchanged: before === after, scope: "synthetic fixture only; no installed profile or dispatch activation" }));
process.exitCode = result.ready && timeoutProven && before === after ? 0 : 2;

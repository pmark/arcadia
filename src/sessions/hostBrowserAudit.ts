import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, opendirSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHostAuditPreview } from "../commands/auditPreview.js";

export const HOST_BROWSER_AUDIT_POLICY = "arcadia-host-browser-audit-preparation-v1";
export const HOST_BROWSER_AUDIT_TIMEOUT_MS = 120_000;
const MAX_FILES = 1_000;
const MAX_BYTES = 32 * 1024 * 1024;
const quote = (value: string) => JSON.stringify(value);

/** Preparation only: no CLI/worker dispatch, installed profile changes, or
 * activation grant. The sole caller is the synthetic host proof script. */
export function snapshotAuditSite(sourceInput: string, destination: string): string {
  const source = realpathSync(sourceInput);
  if (!lstatSync(source).isDirectory()) throw new Error("audit.snapshot: source is not a directory");
  const destinationPath = path.join(realpathSync(path.dirname(destination)), path.basename(destination));
  if (destinationPath === source || destinationPath.startsWith(`${source}${path.sep}`)) throw new Error("audit.snapshot: destination must be outside source");
  let files = 0;
  let entries = 0;
  let bytes = 0;
  const hash = createHash("sha256");
  function visit(directory: string, relative = "", depth = 0) {
    if (depth > 20) throw new Error("audit.snapshot: directory depth limit exceeded");
    const names: string[] = [];
    const handle = opendirSync(directory);
    try {
      for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
        if (++entries > MAX_FILES) throw new Error("audit.snapshot: entry limit exceeded");
        names.push(entry.name);
      }
    } finally { handle.closeSync(); }
    for (const name of names.sort()) {
      if (name.startsWith(".") || /(?:credential|secret|private[-_]?key)/i.test(name)) throw new Error("audit.snapshot: hidden or credential-like file refused");
      const child = path.join(directory, name);
      const target = path.join(relative, name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error("audit.snapshot: symbolic link refused");
      if (stat.isDirectory()) { visit(child, target, depth + 1); continue; }
      if (!stat.isFile()) throw new Error("audit.snapshot: non-regular file refused");
      if (++files > MAX_FILES || (bytes += stat.size) > MAX_BYTES) throw new Error("audit.snapshot: static-site size limit exceeded");
      // A replaced FIFO cannot block capture; no symlink is followed at open.
      const fd = openSync(child, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let content: Buffer;
      try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.ino !== stat.ino || opened.size !== stat.size) throw new Error("audit.snapshot: source changed during capture");
        content = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < content.length) {
          const count = readSync(fd, content, offset, content.length - offset, offset);
          if (!count) throw new Error("audit.snapshot: source changed during capture");
          offset += count;
        }
        const after = fstatSync(fd);
        if (after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("audit.snapshot: source changed during capture");
      } finally { closeSync(fd); }
      if (content.length !== stat.size) throw new Error("audit.snapshot: source changed during capture");
      hash.update(target).update("\0").update(String(content.length)).update("\0").update(content);
      mkdirSync(path.dirname(path.join(destination, target)), { recursive: true, mode: 0o700 });
      writeFileSync(path.join(destination, target), content, { mode: 0o400 });
    }
  }
  visit(source);
  if (!files) throw new Error("audit.snapshot: empty site refused");
  return hash.digest("hex");
}

export function hostBrowserAuditProfile(options: { port: number; scratch: string; worker: string; runtimeRoots: string[]; browserRoot: string }): string {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("audit.profile: invalid loopback port");
  const readRoots = ["/System", "/usr/lib", "/usr/share", "/Library/Apple", options.browserRoot, ...options.runtimeRoots];
  return `(version 1)
(deny default)
(allow file-read-metadata)
(allow file-read* (literal "/") (literal "/dev/random") (literal "/dev/urandom") (literal "/private/etc/passwd") (literal "/private/etc/localtime") (subpath "/private/var/db/timezone") ${readRoots.map(root => `(subpath ${quote(root)})`).join(" ")} (literal ${quote(options.worker)}) (subpath ${quote(options.scratch)}))
(allow file-map-executable ${readRoots.map(root => `(subpath ${quote(root)})`).join(" ")})
(allow file-write* (subpath ${quote(options.scratch)}) (literal "/dev/null"))
(allow file-read* file-write-data (subpath "/dev/fd") (literal "/dev/null"))
(allow process-exec ${[options.browserRoot, ...options.runtimeRoots].map(root => `(subpath ${quote(root)})`).join(" ")})
(allow process-fork)
(allow process-info* (target same-sandbox))
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow mach-bootstrap)
(allow mach-register (local-name-prefix "") (global-name-prefix "org.chromium.crashpad.child_port_handshake.") (global-name-prefix "com.google.Chrome.MachPortRendezvousServer."))
(allow mach-lookup (global-name "com.apple.FontObjectsServer") (global-name "com.apple.fonts") (global-name "com.apple.fontd") (global-name "com.apple.cfprefsd.daemon") (global-name "com.apple.cfprefsd.agent") (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.windowserver.active") (global-name "com.apple.lsd.mapdb") (global-name "com.apple.system.notification_center") (global-name "com.apple.system.logger") (global-name-prefix "org.chromium.crashpad.child_port_handshake.") (global-name-prefix "com.google.Chrome.MachPortRendezvousServer."))
(allow iokit-open-service (iokit-registry-entry-class "IOPMrootDomain"))
(allow iokit-open-user-client (iokit-user-client-class "RootDomainUserClient"))
(allow ipc-posix-shm-read* (ipc-posix-name "apple.shm.notification_center"))
(allow ipc-posix-shm-read* ipc-posix-shm-write* (ipc-posix-name-prefix "/org.chromium."))
(allow network-outbound (remote ip ${quote(`localhost:${options.port}`)}))
; Unix IPC only inside this disposable browser profile, never arbitrary sockets.
(allow network-bind network-inbound network-outbound (subpath ${quote(options.scratch)}))
`;
}

export async function proveHostBrowserAudit(options: { source: string; receiptDirectory: string; credentialSentinel: string; socketSentinel: string; scenario?: "stall-after-launch" }): Promise<{ ready: boolean; receipt: string }> {
  if (process.platform !== "darwin" || process.env.CODEX_SANDBOX) throw new Error("audit.host: proof requires an ordinary macOS host process");
  const root = realpathSync(options.receiptDirectory);
  // macOS Unix socket paths have a small fixed limit; checkout paths do not.
  const scratch = mkdtempSync("/private/tmp/ahba-");
  const snapshot = path.join(root, "site");
  const sourceHash = snapshotAuditSite(options.source, snapshot);
  const require = createRequire(import.meta.url);
  const runtimeRoots = [path.dirname(path.dirname(realpathSync(process.execPath)))];
  let resolver = require;
  let playwrightEntry = "";
  for (const dependency of ["@playwright/test", "playwright", "playwright-core"]) {
    const entry = realpathSync(resolver.resolve(dependency));
    runtimeRoots.push(path.dirname(entry));
    if (dependency === "playwright-core") playwrightEntry = entry;
    resolver = createRequire(entry);
  }
  const workerSource = fileURLToPath(new URL("../../scripts/host-browser-audit-worker.mjs", import.meta.url));
  const worker = path.join(root, "worker.mjs");
  copyFileSync(workerSource, worker);
  const preview = await startHostAuditPreview(snapshot, 120);
  try {
    const profile = hostBrowserAuditProfile({ port: Number(new URL(preview.url).port), scratch, worker, runtimeRoots, browserRoot: "/Applications/Google Chrome.app" });
    writeFileSync(path.join(root, "profile.sb"), profile, { mode: 0o600 });
    const input = { origin: preview.url, scratch, playwrightEntry, credentialSentinel: realpathSync(options.credentialSentinel), socketSentinel: options.socketSentinel, stallAfterLaunch: options.scenario === "stall-after-launch" };
    writeFileSync(path.join(scratch, "input.json"), JSON.stringify(input), { mode: 0o600 });
    const receipt = path.join(root, "receipt.json");
    const journal = { schema: "arcadia-host-browser-audit-proof-v1", policy: HOST_BROWSER_AUDIT_POLICY, sourceHash,
      executorHash: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"),
      workerHash: createHash("sha256").update(readFileSync(worker)).digest("hex"), profileHash: createHash("sha256").update(profile).digest("hex"),
      origin: preview.url, scratch, createdAt: new Date().toISOString(), stage: "browser.launch", ready: false, status: null as number | null, signal: null as string | null, timedOut: false, processGroupStopped: false, groupMembers: [] as string[], cleanupErrors: [] as string[], childPids: [] as number[], stdout: "", stderr: "" };
    const persist = () => {
      const temporary = `${receipt}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
      renameSync(temporary, receipt);
    };
    persist();
    try {
      const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, process.execPath, worker, path.join(scratch, "input.json")], {
        cwd: scratch, detached: true, env: { HOME: scratch, TMPDIR: scratch, PATH: path.dirname(process.execPath), LANG: "en_US.UTF-8" }, stdio: ["ignore", "pipe", "pipe"]
      });
      const kill = () => {
        if (child.pid) {
          try { process.kill(-child.pid, "SIGKILL"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") journal.cleanupErrors.push(String(error)); }
        }
      };
      const budget = options.scenario === "stall-after-launch" ? 5000 : HOST_BROWSER_AUDIT_TIMEOUT_MS;
      const timer = setTimeout(() => { journal.timedOut = true; kill(); }, budget);
      child.stdout.on("data", data => { journal.stdout = (journal.stdout + String(data)).slice(-65536); persist(); });
      child.stderr.on("data", data => {
        journal.stderr = (journal.stderr + String(data)).slice(-8192);
        const stages = [...journal.stderr.matchAll(/ARCADIA_AUDIT_STAGE ([a-z.]+)\n/g)];
        if (stages.length) journal.stage = stages.at(-1)![1];
        journal.childPids = [...journal.stderr.matchAll(/ARCADIA_AUDIT_CHILD (\d+)\n/g)].map(match => Number(match[1]));
        persist();
      });
      let finalTimer: NodeJS.Timeout | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          // Even an unexpected host signal refusal returns a retained failure;
          // an unverified live group can never make the route ready.
          finalTimer = setTimeout(() => { journal.timedOut = true; kill(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); resolve(); }, budget + 2000);
          child.once("error", reject);
          child.once("close", (status, signal) => { journal.status = status; journal.signal = signal; resolve(); });
        });
      } finally { clearTimeout(timer); clearTimeout(finalTimer); kill(); }
      for (let attempt = 0; attempt < 20; attempt++) {
        const observed = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,stat="], { encoding: "utf8", timeout: 1000, maxBuffer: 1024 * 1024 });
        if (observed.status !== 0 || observed.error) { journal.cleanupErrors.push("audit.cleanup: process-group observation unavailable"); break; }
        journal.groupMembers = observed.stdout.split("\n").map(line => line.trim()).filter(line => line.split(/\s+/)[2] === String(child.pid));
        // SIGKILL may leave launchd-owned zombies briefly. They cannot execute;
        // signalling them can return EPERM, which is not a surviving browser.
        journal.processGroupStopped = journal.groupMembers.every(line => line.split(/\s+/)[3].startsWith("Z"));
        if (journal.processGroupStopped) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (journal.status === 0 && !journal.timedOut) {
        const result = JSON.parse(journal.stdout) as { ready?: boolean };
        journal.ready = result.ready === true && journal.processGroupStopped;
      }
      if (journal.ready) journal.stage = "complete";
      persist();
      return { ready: journal.ready, receipt };
    } catch (error) {
      journal.stderr = (journal.stderr + String(error)).slice(-8192);
      persist();
      throw error;
    }
  } finally { await preview.close(); }
}

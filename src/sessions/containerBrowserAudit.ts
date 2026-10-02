import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotAuditSite } from "./hostBrowserAudit.js";
import { parseDoc } from "../docs/parse.js";

export interface ContainerAuditAuthority {
  schema: "arcadia-container-audit-authority-v1";
  project: string;
  revision: string;
  image: string;
  executorHash: string;
  snapshotHash: string;
  routes: string[];
  viewports: Array<{ width: number; height: number }>;
  expiresAt: string;
}
export const containerAuditExecutorHash = () => createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
const digest = /^[a-f0-9]{64}$/;
export function validateContainerAuditAuthority(value: ContainerAuditAuthority, now = Date.now()): void {
  if (Object.keys(value).sort().join() !== "executorHash,expiresAt,image,project,revision,routes,schema,snapshotHash,viewports") throw new Error("audit.authority: unexpected fields");
  if (value.schema !== "arcadia-container-audit-authority-v1" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.project) || !/^[a-f0-9]{40}$/.test(value.revision)) throw new Error("audit.authority: invalid Project/revision");
  if (!/^sha256:[a-f0-9]{64}$/.test(value.image) || !digest.test(value.executorHash) || !digest.test(value.snapshotHash)) throw new Error("audit.authority: immutable hashes required");
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now || Date.parse(value.expiresAt) - now > 86_400_000) throw new Error("audit.authority: expired or excessive expiry");
  if (!Array.isArray(value.routes) || value.routes.length < 1 || value.routes.length > 4 || new Set(value.routes).size !== value.routes.length || value.routes.some(route => !/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]*$/.test(route))) throw new Error("audit.authority: invalid routes");
  if (!Array.isArray(value.viewports) || value.viewports.length < 1 || value.viewports.length > 2 || value.viewports.some(v => Object.keys(v).sort().join() !== "height,width" || !Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 320 || v.width > 1920 || v.height < 480 || v.height > 1200)) throw new Error("audit.authority: invalid viewports");
}

/** Host-only launcher. Caller has no Docker options, URLs, shell, mounts or flags.
 * Not installed or dispatchable until a separate reviewed activation Decision.
 * source and receiptDirectory must come from the host's approved binding, never
 * from a coding-agent request. The proof caller uses synthetic fixtures only. */
export async function runContainerBrowserAudit(binding: { authority: ContainerAuditAuthority; source: string; receiptDirectory: string; repository?: string; proof?: "normal" | "stall" }): Promise<{ ready: boolean; receipt: string }> {
  if (process.env.CODEX_SANDBOX) throw new Error("audit.host: Docker authority is host-only");
  validateContainerAuditAuthority(binding.authority);
  if (binding.authority.executorHash !== containerAuditExecutorHash()) throw new Error("audit.authority: executor drift");
  if (!binding.proof) {
    if (!binding.repository) throw new Error("audit.authority: host repository binding required");
    const projectFile = path.join(binding.repository, "PROJECT.md");
    const pinnedProject = spawnSync("/usr/bin/git", ["show", `${binding.authority.revision}:PROJECT.md`], { cwd: binding.repository, encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin" } });
    const parsed = parseDoc("PROJECT.md", projectFile, pinnedProject.stdout || "");
    if (pinnedProject.status !== 0 || parsed.errors.length || parsed.doc?.type !== "project" || parsed.doc.slug !== binding.authority.project) throw new Error("audit.authority: Project/revision drift");
  }
  const root = binding.receiptDirectory;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const snapshot = path.join(root, "site");
  const snapshotHash = snapshotAuditSite(binding.source, snapshot);
  if (snapshotHash !== binding.authority.snapshotHash) throw new Error("audit.authority: snapshot drift");
  // The browser UID must be able to read only the static snapshot and input.
  const { readdirSync, lstatSync } = await import("node:fs");
  function readable(directory: string) { chmodSync(directory, 0o755); for (const name of readdirSync(directory)) { const file = path.join(directory, name); if (lstatSync(file).isDirectory()) readable(file); else chmodSync(file, 0o444); } }
  readable(snapshot);
  const input = path.join(root, "input");
  mkdirSync(input, { mode: 0o755 });
  writeFileSync(path.join(input, "authority.json"), JSON.stringify({ ...binding.authority, proof: Boolean(binding.proof), stall: binding.proof === "stall" }), { mode: 0o444 });
  const name = `arcadia-audit-${randomUUID()}`;
  // Empty Docker config avoids credential helpers even for local immutable images.
  const config = path.join(root, "docker-config"); mkdirSync(config, { mode: 0o700 });
  const prefix = ["--config", config, "--host", "unix:///Users/pmark/.docker/run/docker.sock"];
  const docker = (args: string[]) => spawnSync("/usr/local/bin/docker", [...prefix, ...args], { encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: root } });
  const image = docker(["image", "inspect", binding.authority.image, "--format", "{{.Id}}"]);
  if (image.status !== 0 || image.stdout.trim() !== binding.authority.image) throw new Error("audit.image: reviewed immutable local image unavailable");
  const receipt = path.join(root, "receipt.json");
  const journal = { schema: "arcadia-container-audit-receipt-v1", authority: binding.authority, name, createdAt: new Date().toISOString(), stage: "container.create", timedOut: false, removed: false, ready: false, exit: null as number | null, stdout: "", stderr: "", inspection: null as unknown, processes: "", result: null as null | { renders: Array<{status: number}>; reports: Array<{lhr: {runtimeError?: unknown}}> ; denials: Record<string,string>; detachedChild: number | null }, cleanupError: "" };
  const persist = () => { writeFileSync(`${receipt}.tmp`, JSON.stringify(journal, null, 2), { mode: 0o600 }); renameSync(`${receipt}.tmp`, receipt); };
  persist();
  try {
    validateContainerAuditAuthority(binding.authority);
    const created = docker(["create", "--name", name, "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "2g", "--cpus", "2", "--init", "--user", "1000:1000", "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m,mode=1777", "--shm-size", "128m", "--mount", `type=bind,src=${snapshot},dst=/site,readonly`, "--mount", `type=bind,src=${input},dst=/input,readonly`, binding.authority.image]);
    if (created.status !== 0) throw new Error(`audit.create: ${created.stderr}`);
    const inspected = docker(["inspect", name]);
    if (inspected.status !== 0) throw new Error("audit.inspect: unavailable");
    journal.inspection = JSON.parse(inspected.stdout);
    persist();
    validateContainerAuditAuthority(binding.authority);
    const child = spawn("/usr/local/bin/docker", [...prefix, "start", "--attach", name], { env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: root }, stdio: ["ignore", "pipe", "pipe"] });
    const budget = Math.min(binding.proof === "stall" ? 20000 : 240000, Date.parse(binding.authority.expiresAt) - Date.now());
    let finalTimer: NodeJS.Timeout;
    let removalAttempted = false;
    const remove = () => {
      if (removalAttempted) return;
      removalAttempted = true;
      if (!journal.processes && !journal.timedOut) journal.processes = docker(["top", name, "-eo", "pid,ppid,pgid,comm,args"]).stdout;
      const removed = docker(["rm", "--force", name]);
      if (removed.status !== 0) journal.cleanupError = removed.stderr;
    };
    const timer = setTimeout(() => { journal.timedOut = true; remove(); child.kill("SIGKILL"); }, budget);
    child.stdout.on("data", chunk => { journal.stdout = (journal.stdout + String(chunk)).slice(-16 * 1024 * 1024); });
    child.stderr.on("data", chunk => { journal.stderr = (journal.stderr + String(chunk)).slice(-32768); const stages = [...journal.stderr.matchAll(/ARCADIA_CONTAINER_STAGE ([a-z.]+)\n/g)]; if (stages.length) journal.stage = stages.at(-1)![1]; if (journal.stage === "browser.stall" && !journal.processes) journal.processes = docker(["top", name, "-eo", "pid,ppid,pgid,comm,args"]).stdout; });
    try { await new Promise<void>((resolve, reject) => {
      finalTimer = setTimeout(() => { journal.timedOut = true; child.kill("SIGKILL"); child.stdout.destroy(); child.stderr.destroy(); resolve(); }, budget + 35000);
      child.once("error", reject); child.once("close", code => { journal.exit = code; resolve(); });
    }); } finally { clearTimeout(timer); clearTimeout(finalTimer!); remove(); }
    const remaining = docker(["ps", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"]);
    journal.removed = remaining.status === 0 && remaining.stdout.trim() === "" && journal.cleanupError === "";
    if (journal.stdout.trim()) journal.result = JSON.parse(journal.stdout);
    const result = journal.result;
    const acquired = result && result.reports.length === binding.authority.routes.length * binding.authority.viewports.length && result.renders.every(r => r.status === 200) && result.reports.every(r => !r.lhr.runtimeError);
    const denied = result && ["external", "private", "hostGateway"].every(key => ["ENETUNREACH", "EHOSTUNREACH", "EACCES", "EPERM"].includes(result.denials[key])) && result.denials.credentials === "EACCES" && result.denials.dockerSocket === "ENOENT" && result.denials.browserExternal === "NETWORK_DENIED";
    journal.ready = Boolean(!journal.timedOut && journal.exit === 0 && journal.removed && acquired && (!binding.proof || (denied && result?.detachedChild)));
    if (journal.ready) journal.stage = "complete";
    persist();
    return { ready: journal.ready, receipt };
  } catch (error) {
    journal.stderr += String(error);
    const cleanup = docker(["rm", "--force", name]);
    journal.cleanupError = cleanup.status === 0 ? "" : cleanup.stderr;
    persist(); throw error;
  }
}

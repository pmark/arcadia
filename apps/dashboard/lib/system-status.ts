import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { resolveDashboardWorkspace } from "./arcadia-cli";
import { INTELLIGENCE_BASE_URL } from "./intelligence";

const execFileAsync = promisify(execFile);
const DASHBOARD_VERSION = process.env.ARCADIA_VERSION?.trim() || "0.1.0";
const DASHBOARD_BASE_URL = process.env.ARCADIA_DASHBOARD_BASE_URL?.trim() || "http://127.0.0.1:3020";
const COMFY_UI_BASE_URL = process.env.ARCADIA_COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const HEARTBEAT_MAX_AGE_MS = 20_000;

export type SystemStatus = "healthy" | "degraded" | "blocked" | "offline";

export interface StatusCapability {
  id: "normal" | "image" | "background";
  label: string;
  status: SystemStatus;
  summary: string;
}

export interface StatusDependency {
  id: "dashboard" | "intelligence-api" | "intelligence-worker" | "managed-run-worker" | "discord" | "comfyui";
  name: string;
  status: SystemStatus;
  required: boolean;
  summary: string;
  port: number | null;
  url: string | null;
  reachability: "reachable" | "unreachable" | "not-applicable" | "unknown";
  latencyMs: number | null;
  version: string | null;
  running: boolean | null;
  connectionState: string | null;
  lastHeartbeat: string | null;
  lastSuccessfulRequest: string | null;
  lastEvent: string | null;
  queueCount: number | null;
  activeJobCount: number | null;
  failedJobCount: number | null;
}

export interface SystemStatusResponse {
  overall: {
    status: SystemStatus;
    label: string;
    summary: string;
  };
  capabilities: StatusCapability[];
  dependencies: StatusDependency[];
  checkedAt: string;
  workspace: string | null;
}

interface ProbeResult<T = unknown> {
  reachable: boolean;
  latencyMs: number | null;
  body: T | null;
}

interface IntelligenceHealthBody {
  version?: string;
  jobs?: {
    queuedCount?: number;
    activeCount?: number;
    failedCount?: number;
    lastSuccessfulRequest?: string | null;
  };
}

interface HeartbeatState {
  timestamp: string | null;
  fresh: boolean;
  available: boolean;
}

export async function loadSystemStatus(): Promise<SystemStatusResponse> {
  const checkedAt = new Date().toISOString();
  const workspace = await resolveWorkspaceSafely();
  const repoRoot = findRepoRoot(process.cwd());

  const [dashboardProbe, intelligenceProbe, comfyUiProbe, managedProcess, discordProcess] = await Promise.all([
    probeJson(`${trimUrl(DASHBOARD_BASE_URL)}/api/health`),
    probeJson(`${trimUrl(INTELLIGENCE_BASE_URL)}/api/intelligence/health`),
    probeJson(`${trimUrl(COMFY_UI_BASE_URL)}/system_stats`),
    workspace ? readManagedRunWorker(workspace) : Promise.resolve({ running: false, heartbeat: { timestamp: null, fresh: false, available: false } }),
    findDiscordProcess(repoRoot),
  ]);

  const dashboard = dependency({
    id: "dashboard",
    name: "Dashboard",
    status: dashboardProbe.reachable ? "healthy" : "offline",
    required: true,
    summary: dashboardProbe.reachable ? "Serving the Arcadia operator surface." : "The Dashboard cannot be reached.",
    port: portFromUrl(DASHBOARD_BASE_URL),
    url: DASHBOARD_BASE_URL,
    reachability: dashboardProbe.reachable ? "reachable" : "unreachable",
    latencyMs: dashboardProbe.latencyMs,
    version: dashboardProbe.body && typeof dashboardProbe.body === "object" && "version" in dashboardProbe.body
      ? stringOrNull(dashboardProbe.body.version)
      : DASHBOARD_VERSION,
  });

  const intelligenceBody = intelligenceProbe.body as IntelligenceHealthBody | null;
  const intelligenceApi = dependency({
    id: "intelligence-api",
    name: "Intelligence API",
    status: intelligenceProbe.reachable ? "healthy" : "offline",
    required: false,
    summary: intelligenceProbe.reachable ? "Accepting Intelligence requests." : "Image and structured-generation requests cannot reach the API.",
    port: portFromUrl(INTELLIGENCE_BASE_URL),
    url: `${trimUrl(INTELLIGENCE_BASE_URL)}/api/intelligence/health`,
    reachability: intelligenceProbe.reachable ? "reachable" : "unreachable",
    latencyMs: intelligenceProbe.latencyMs,
    version: stringOrNull(intelligenceBody?.version),
    lastSuccessfulRequest: stringOrNull(intelligenceBody?.jobs?.lastSuccessfulRequest),
    queueCount: numberOrNull(intelligenceBody?.jobs?.queuedCount),
    activeJobCount: numberOrNull(intelligenceBody?.jobs?.activeCount),
    failedJobCount: numberOrNull(intelligenceBody?.jobs?.failedCount),
  });

  const intelligenceWorkerHeartbeat = workspace
    ? readHeartbeat(path.join(workspace, ".arcadia", "intelligence-worker.heartbeat"))
    : { timestamp: null, fresh: false, available: false };
  const intelligenceWorker = dependency({
    id: "intelligence-worker",
    name: "Intelligence worker",
    status: intelligenceProbe.reachable && (!intelligenceWorkerHeartbeat.available || intelligenceWorkerHeartbeat.fresh)
      ? "healthy"
      : intelligenceProbe.reachable
        ? "blocked"
        : "offline",
    required: false,
    summary: !intelligenceWorkerHeartbeat.available && intelligenceProbe.reachable
      ? "Running in the Intelligence API process; heartbeat detail is not available until the service is refreshed."
      : intelligenceWorkerHeartbeat.fresh
      ? "Processing queued Intelligence jobs."
      : "The Intelligence API is available, but its worker heartbeat is stale.",
    running: intelligenceProbe.reachable && (!intelligenceWorkerHeartbeat.available || intelligenceWorkerHeartbeat.fresh),
    reachability: "not-applicable",
    lastHeartbeat: intelligenceWorkerHeartbeat.timestamp,
    activeJobCount: numberOrNull(intelligenceBody?.jobs?.activeCount),
    failedJobCount: numberOrNull(intelligenceBody?.jobs?.failedCount),
  });

  const managedRunWorker = dependency({
    id: "managed-run-worker",
    name: "Managed-Run worker",
    status: managedProcess.running && (!managedProcess.heartbeat.available || managedProcess.heartbeat.fresh)
      ? "healthy"
      : managedProcess.running
        ? "blocked"
        : "offline",
    required: true,
    summary: managedProcess.running && !managedProcess.heartbeat.available
      ? "Running and ready; heartbeat detail is not available until the worker is refreshed."
      : managedProcess.running && managedProcess.heartbeat.fresh
      ? "Ready to process authorized Runs in the background."
      : "Authorized Runs will wait until the Managed-Run worker is available.",
    running: managedProcess.running,
    reachability: "not-applicable",
    lastHeartbeat: managedProcess.heartbeat.timestamp,
  });

  const discordState = workspace ? readDiscordStatus(workspace) : null;
  const discordRunning = discordProcess || (discordState?.fresh ?? false);
  const discord = dependency({
    id: "discord",
    name: "Discord adapter",
    status: discordRunning && discordState?.connectionState === "connected" ? "healthy" : "degraded",
    required: false,
    summary: discordRunning
      ? discordState?.connectionState === "connected" ? "Connected and ready for Discord capture and notifications." : "Running, but Discord connection state needs attention."
      : "Discord capture and notifications are unavailable; Arcadia remains usable without them.",
    running: discordRunning,
    connectionState: discordState?.connectionState ?? "unknown",
    reachability: "not-applicable",
    lastHeartbeat: discordState?.lastHeartbeatAt ?? null,
    lastEvent: discordState?.lastEventAt ?? null,
  });

  const comfyConfigured = Boolean(process.env.ARCADIA_COMFYUI_IMAGE_ROUTE?.trim());
  const comfyUi = dependency({
    id: "comfyui",
    name: "ComfyUI",
    status: comfyUiProbe.reachable ? "healthy" : "offline",
    required: comfyConfigured,
    summary: comfyUiProbe.reachable
      ? "Available for local image generation."
      : comfyConfigured
        ? "The configured local image backend cannot be reached."
        : "Optional local image backend is not running.",
    port: portFromUrl(COMFY_UI_BASE_URL),
    url: COMFY_UI_BASE_URL,
    reachability: comfyUiProbe.reachable ? "reachable" : "unreachable",
    latencyMs: comfyUiProbe.latencyMs,
  });

  const dependencies = [dashboard, intelligenceApi, intelligenceWorker, managedRunWorker, discord, comfyUi];
  const capabilities: StatusCapability[] = [
    capability("normal", "Normal operation", [dashboard]),
    capability("image", "Image generation", comfyConfigured ? [intelligenceApi, intelligenceWorker, comfyUi] : [intelligenceApi, intelligenceWorker]),
    capability("background", "Background processing", [managedRunWorker]),
  ];

  const overallStatus = overallStatusFor(dependencies);
  return {
    overall: {
      status: overallStatus,
      label: labelFor(overallStatus),
      summary: overallSummary(overallStatus, capabilities),
    },
    capabilities,
    dependencies,
    checkedAt,
    workspace,
  };
}

export function overallStatusFor(dependencies: Array<Pick<StatusDependency, "id" | "status" | "required">>): SystemStatus {
  const dashboard = dependencies.find((item) => item.id === "dashboard");
  if (dashboard?.status === "offline") return "offline";
  const requiredProblem = dependencies.some((item) => item.required && item.status !== "healthy");
  if (requiredProblem) return "blocked";
  if (dependencies.some((item) => item.status !== "healthy")) return "degraded";
  return "healthy";
}

function capability(id: StatusCapability["id"], label: string, dependencies: StatusDependency[]): StatusCapability {
  const status = statusForDependencies(dependencies);
  return {
    id,
    label,
    status,
    summary: status === "healthy" ? `Ready for ${label.toLowerCase()}.` : `${label} is ${labelFor(status).toLowerCase()}.`,
  };
}

function statusForDependencies(dependencies: StatusDependency[]): SystemStatus {
  if (dependencies.some((item) => item.status === "offline")) return "offline";
  if (dependencies.some((item) => item.status === "blocked")) return "blocked";
  if (dependencies.some((item) => item.status === "degraded")) return "degraded";
  return "healthy";
}

function overallSummary(status: SystemStatus, capabilities: StatusCapability[]): string {
  if (status === "healthy") return "Arcadia is ready for normal operation, image generation, and background processing.";
  const blocked = capabilities.filter((item) => item.status === "blocked" || item.status === "offline").map((item) => item.label);
  if (status === "offline") return "The Dashboard itself cannot be reached.";
  if (status === "blocked") return blocked.length > 0 ? `${blocked.join(" and ")} cannot run until its dependency recovers.` : "A required dependency is stopped.";
  return "Arcadia is usable, but an optional capability needs attention.";
}

function labelFor(status: SystemStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function dependency(input: Partial<StatusDependency> & Pick<StatusDependency, "id" | "name" | "status" | "required" | "summary">): StatusDependency {
  return {
    id: input.id,
    name: input.name,
    status: input.status,
    required: input.required,
    summary: input.summary,
    port: input.port ?? null,
    url: input.url ?? null,
    reachability: input.reachability ?? "unknown",
    latencyMs: input.latencyMs ?? null,
    version: input.version ?? null,
    running: input.running ?? null,
    connectionState: input.connectionState ?? null,
    lastHeartbeat: input.lastHeartbeat ?? null,
    lastSuccessfulRequest: input.lastSuccessfulRequest ?? null,
    lastEvent: input.lastEvent ?? null,
    queueCount: input.queueCount ?? null,
    activeJobCount: input.activeJobCount ?? null,
    failedJobCount: input.failedJobCount ?? null,
  };
}

async function probeJson<T = unknown>(url: string): Promise<ProbeResult<T>> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const body = response.ok ? await response.json().catch(() => null) : null;
    return { reachable: response.status < 500, latencyMs: Math.round(performance.now() - started), body: body as T | null };
  } catch {
    return { reachable: false, latencyMs: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWorkspaceSafely(): Promise<string | null> {
  try {
    return await resolveDashboardWorkspace();
  } catch {
    return process.env.ARCADIA_WORKSPACE?.trim() ? path.resolve(process.env.ARCADIA_WORKSPACE) : null;
  }
}

async function readManagedRunWorker(workspace: string): Promise<{ running: boolean; heartbeat: HeartbeatState }> {
  const pidPath = path.join(workspace, ".arcadia", "worker.pid");
  let pid: number | null = null;
  try {
    const parsed = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
    pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {}
  const running = pid !== null && isProcessAlive(pid);
  const heartbeat = readHeartbeat(path.join(workspace, ".arcadia", "worker.heartbeat"));
  return { running, heartbeat };
}

function readDiscordStatus(workspace: string): (DiscordStatus & { fresh: boolean }) | null {
  const statusPath = path.join(workspace, ".arcadia", "discord-adapter.status.json");
  try {
    const status = JSON.parse(readFileSync(statusPath, "utf8")) as DiscordStatus;
    const timestamp = Date.parse(status.lastHeartbeatAt);
    return { ...status, fresh: Number.isFinite(timestamp) && Date.now() - timestamp <= HEARTBEAT_MAX_AGE_MS };
  } catch {
    return null;
  }
}

interface DiscordStatus {
  state: "running" | "stopped";
  connectionState: string;
  lastHeartbeatAt: string;
  lastEventAt: string | null;
}

async function findDiscordProcess(repoRoot: string): Promise<boolean> {
  try {
    const result = await execFileAsync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    const candidates = result.stdout.split("\n").filter((line) => line.includes("discord-bot") || line.includes("apps/discord-bot/src/main"));
    for (const line of candidates) {
      const pid = Number.parseInt(line.trim().split(/\s+/, 1)[0] ?? "", 10);
      if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid) && await processCwdIs(pid, repoRoot)) return true;
    }
  } catch {}
  return false;
}

async function processCwdIs(pid: number, repoRoot: string): Promise<boolean> {
  try {
    const result = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    const cwd = result.stdout.split("\n").find((line) => line.startsWith("n"))?.slice(1);
    return cwd === repoRoot || cwd?.startsWith(`${repoRoot}${path.sep}`) === true;
  } catch {
    return true;
  }
}

function readHeartbeat(filePath: string): HeartbeatState {
  try {
    const timestamp = readFileSync(filePath, "utf8").trim();
    const parsed = Date.parse(timestamp);
    return { timestamp: Number.isFinite(parsed) ? timestamp : null, fresh: Number.isFinite(parsed) && Date.now() - parsed <= HEARTBEAT_MAX_AGE_MS, available: true };
  } catch {
    return { timestamp: null, fresh: false, available: false };
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function trimUrl(url: string): string { return url.replace(/\/$/, ""); }
function portFromUrl(url: string): number | null {
  try { return Number(new URL(url).port || (new URL(url).protocol === "https:" ? 443 : 80)); } catch { return null; }
}
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }

function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "src", "cli.ts")) && existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

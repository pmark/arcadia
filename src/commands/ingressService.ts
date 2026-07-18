import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { runIngressProcessCommand } from "./ingress.js";
import { getWorkflowDefinition, validateWorkflowDefinition } from "../workflows/config.js";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_STABLE_SECONDS = 30;
const THUNDERTONK_WORKFLOW_ID = "thundertonk-practice";

export interface IngressServiceOptions {
  workspace: string;
  source?: string;
  ingressRoot?: string;
  intervalSeconds?: number;
  stableSeconds?: number;
  runSafe?: boolean;
}

export interface IngressServiceStatusData {
  label: string;
  plistPath: string;
  ingressRoot: string;
  source: string;
  installed: boolean;
  loaded: boolean;
  state: string;
  lastExitCode: number | null;
  errorLogPath: string;
  healthStatePath: string;
}

export interface IngressDoctorCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning";
  detail: string;
}

export interface IngressServiceDoctorData {
  healthy: boolean;
  checks: IngressDoctorCheck[];
  status: IngressServiceStatusData;
}

interface ResolvedIngressService {
  workspacePath: string;
  source: string;
  ingressRoot: string;
  intervalSeconds: number;
  stableSeconds: number;
  runSafe: boolean;
  label: string;
  plistPath: string;
  errorLogPath: string;
  logsDirectory: string;
  healthStatePath: string;
  cliPath: string;
  tsxBin: string;
  repositoryRoot: string;
}

export function defaultICloudIngressRoot(home = homedir()): string {
  return path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "ArcadiaIngress");
}

export function runIngressServiceInstallCommand(
  options: IngressServiceOptions
): CommandSuccess<IngressServiceStatusData> {
  assertMacOS();
  const service = resolveIngressService(options);
  mkdirSync(path.dirname(service.plistPath), { recursive: true });
  mkdirSync(service.logsDirectory, { recursive: true });
  writeFileSync(service.plistPath, buildIngressServicePlist(service), "utf8");
  chmodSync(service.plistPath, 0o644);

  const domain = launchDomain();
  runLaunchctl(["bootout", `${domain}/${service.label}`], true);
  const bootstrap = runLaunchctl(["bootstrap", domain, service.plistPath]);
  if (bootstrap.status !== 0) {
    throw validationError("Ingress service could not be installed.", {
      plistPath: service.plistPath,
      launchctl: commandOutput(bootstrap)
    });
  }
  const kickstart = runLaunchctl(["kickstart", "-k", `${domain}/${service.label}`]);
  if (kickstart.status !== 0) {
    throw validationError("Ingress service was installed but could not be started.", {
      label: service.label,
      launchctl: commandOutput(kickstart)
    });
  }

  return createSuccess({
    command: "ingress.service.install",
    workspace: service.workspacePath,
    data: inspectIngressService(service),
    artifacts: [service.plistPath]
  });
}

export function runIngressServiceStatusCommand(
  options: IngressServiceOptions
): CommandSuccess<IngressServiceStatusData> {
  const service = resolveIngressService(options);
  return createSuccess({
    command: "ingress.service.status",
    workspace: service.workspacePath,
    data: inspectIngressService(service),
    artifacts: existsSync(service.plistPath) ? [service.plistPath] : []
  });
}

export function runIngressServiceDoctorCommand(
  options: IngressServiceOptions
): CommandSuccess<IngressServiceDoctorData> {
  const service = resolveIngressService(options);
  const status = inspectIngressService(service);
  const checks = collectIngressDoctorChecks(service, status);
  return createSuccess({
    command: "ingress.service.doctor",
    workspace: service.workspacePath,
    data: {
      healthy: checks.every((check) => check.status !== "fail"),
      checks,
      status
    },
    artifacts: existsSync(service.plistPath) ? [service.plistPath] : []
  });
}

export function runIngressServiceTickCommand(
  options: IngressServiceOptions
): CommandSuccess<{ discovered: number; processed: number; failed: number }> {
  const service = resolveIngressService(options);
  mkdirSync(path.dirname(service.healthStatePath), { recursive: true });
  const dependencyChecks = collectDependencyChecks(service);
  const failedChecks = dependencyChecks.filter((check) => check.status === "fail");
  const blockingChecks = failedChecks.filter((check) => ["icloud-root", "icloud-inbox"].includes(check.id));
  if (blockingChecks.length > 0) {
    writeHealthState(service, {
      healthy: false,
      checkedAt: new Date().toISOString(),
      checks: dependencyChecks
    });
    throw validationError("Ingress service dependency check failed.", {
      checks: blockingChecks,
      healthStatePath: service.healthStatePath
    });
  }

  try {
    const result = runIngressProcessCommand({
      workspace: service.workspacePath,
      source: service.source,
      ingressRoot: service.ingressRoot,
      stableSeconds: service.stableSeconds,
      runSafe: service.runSafe
    });
    const data = {
      discovered: result.data.counts.discovered,
      processed: result.data.counts.processed,
      failed: result.data.counts.failed
    };
    writeHealthState(service, {
      healthy: failedChecks.length === 0,
      checkedAt: new Date().toISOString(),
      checks: dependencyChecks,
      counts: data
    });
    return createSuccess({ command: "ingress.service.run", workspace: service.workspacePath, data });
  } catch (error) {
    writeHealthState(service, {
      healthy: false,
      checkedAt: new Date().toISOString(),
      checks: dependencyChecks,
      error: errorMessage(error)
    });
    throw error;
  }
}

export function runIngressServiceUninstallCommand(
  options: IngressServiceOptions
): CommandSuccess<IngressServiceStatusData> {
  assertMacOS();
  const service = resolveIngressService(options);
  runLaunchctl(["bootout", `${launchDomain()}/${service.label}`], true);
  if (existsSync(service.plistPath)) unlinkSync(service.plistPath);
  return createSuccess({
    command: "ingress.service.uninstall",
    workspace: service.workspacePath,
    data: inspectIngressService(service)
  });
}

export function buildIngressServicePlist(service: ResolvedIngressService): string {
  const argumentsList = [
    service.tsxBin,
    service.cliPath,
    "ingress",
    "service",
    "run",
    "--workspace",
    service.workspacePath,
    "--source",
    service.source,
    "--ingress-root",
    service.ingressRoot,
    "--stable-seconds",
    String(service.stableSeconds),
    ...(service.runSafe ? ["--run-safe"] : [])
  ];
  const argumentsXml = argumentsList.map((argument) => `    <string>${xmlEscape(argument)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(service.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(service.repositoryRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${service.intervalSeconds}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(service.errorLogPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xmlEscape(homedir())}</string>
    <key>PATH</key>
    <string>${xmlEscape(serviceExecutablePath())}</string>
    <key>NODE_PATH</key>
    <string>${xmlEscape(path.join(service.repositoryRoot, "node_modules"))}</string>
  </dict>
</dict>
</plist>
`;
}

export function resolveIngressService(options: IngressServiceOptions): ResolvedIngressService {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const source = options.source?.trim() || "iCloudIdeas";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source) || source === "." || source === "..") {
    throw validationError("Ingress source must be a simple folder name.", { source });
  }
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  const stableSeconds = options.stableSeconds ?? DEFAULT_STABLE_SECONDS;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 15) {
    throw validationError("Ingress service interval must be an integer of at least 15 seconds.", { intervalSeconds });
  }
  if (!Number.isFinite(stableSeconds) || stableSeconds < 0) {
    throw validationError("Stable seconds must be a non-negative number.", { stableSeconds });
  }
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const labelSource = source.replaceAll(/[^A-Za-z0-9.-]/g, "-");
  const label = `com.arcadia.ingress.${labelSource}`;
  const home = homedir();
  const logsDirectory = path.join(home, "Library", "Logs", "Arcadia");
  const healthStatePath = path.join(home, "Library", "Application Support", "Arcadia", "ingress-services", `${labelSource}.json`);
  return {
    workspacePath,
    source,
    ingressRoot: path.resolve(options.ingressRoot ?? defaultICloudIngressRoot(home)),
    intervalSeconds,
    stableSeconds,
    runSafe: options.runSafe ?? true,
    label,
    plistPath: path.join(home, "Library", "LaunchAgents", `${label}.plist`),
    errorLogPath: path.join(logsDirectory, `ingress-${labelSource}.err.log`),
    healthStatePath,
    logsDirectory,
    cliPath: path.join(repositoryRoot, "src", "cli.ts"),
    tsxBin: path.join(repositoryRoot, "node_modules", ".bin", "tsx"),
    repositoryRoot
  };
}

function inspectIngressService(service: ResolvedIngressService): IngressServiceStatusData {
  const print = runLaunchctl(["print", `${launchDomain()}/${service.label}`], true);
  const output = commandOutput(print);
  const state = output.match(/\bstate = ([^\n]+)/)?.[1]?.trim() ?? (print.status === 0 ? "loaded" : "not loaded");
  const exitMatch = output.match(/\blast exit code = (-?\d+)/);
  return {
    label: service.label,
    plistPath: service.plistPath,
    ingressRoot: service.ingressRoot,
    source: service.source,
    installed: existsSync(service.plistPath),
    loaded: print.status === 0,
    state,
    lastExitCode: exitMatch ? Number(exitMatch[1]) : null,
    errorLogPath: service.errorLogPath,
    healthStatePath: service.healthStatePath
  };
}

function collectIngressDoctorChecks(
  service: ResolvedIngressService,
  status: IngressServiceStatusData
): IngressDoctorCheck[] {
  const checks: IngressDoctorCheck[] = [];
  checks.push(check("service-installed", "LaunchAgent installed", status.installed, status.plistPath));
  checks.push(check("service-loaded", "LaunchAgent loaded", status.loaded, `${status.label}: ${status.state}`));
  checks.push(...collectDependencyChecks(service));

  const state = readHealthState(service.healthStatePath);
  if (state) {
    const ageMs = Date.now() - Date.parse(state.checkedAt);
    const recent = Number.isFinite(ageMs) && ageMs <= service.intervalSeconds * 3_000;
    checks.push({
      id: "service-probe",
      label: "Background service probe",
      status: recent && state.healthy ? "pass" : "fail",
      detail: recent
        ? `${state.healthy ? "passed" : "failed"} at ${state.checkedAt}; ${service.healthStatePath}`
        : `stale health state from ${state.checkedAt}; ${service.healthStatePath}`
    });
    if (recent && state.healthy) {
      for (const check of checks) {
        if (["icloud-root", "icloud-inbox", "publication-root"].includes(check.id) && check.status === "fail") {
          check.status = "warning";
          check.detail = `${check.detail} The background service probe has access.`;
        }
      }
    }
  } else {
    checks.push({
      id: "service-probe",
      label: "Background service probe",
      status: "fail",
      detail: `No health state yet at ${service.healthStatePath}.`
    });
  }

  if (existsSync(service.errorLogPath)) {
    const stateCheckedAt = state ? Date.parse(state.checkedAt) : 0;
    const errorsAreCurrent = !state?.healthy || statSync(service.errorLogPath).mtimeMs > stateCheckedAt;
    const recent = errorsAreCurrent ? readFileSync(service.errorLogPath, "utf8").slice(-16_384) : "";
    const permissionDenied = /Operation not permitted|permission denied/i.test(recent);
    checks.push({
      id: "recent-errors",
      label: "Recent service errors",
      status: permissionDenied ? "fail" : recent.trim() ? "warning" : "pass",
      detail: permissionDenied
        ? `macOS denied access. Grant Full Disk Access to ${service.tsxBin} or its Node runtime, then reinstall or restart the service.`
        : recent.trim() ? `Review ${service.errorLogPath}` : "No errors since the last successful background probe."
    });
  }
  return checks;
}

function collectDependencyChecks(service: ResolvedIngressService): IngressDoctorCheck[] {
  const checks: IngressDoctorCheck[] = [];
  checks.push(check("platform", "macOS", process.platform === "darwin", process.platform));
  checks.push(pathCheck("runtime", "Arcadia runtime", service.tsxBin, constants.X_OK));
  checks.push(pathCheck("cli", "Arcadia CLI", service.cliPath, constants.R_OK));
  checks.push(directoryReadCheck("icloud-root", "iCloud ingress root", service.ingressRoot));
  checks.push(directoryReadCheck("icloud-inbox", "iCloud source inbox", path.join(service.ingressRoot, service.source, "In")));

  try {
    const workflow = getWorkflowDefinition(service.workspacePath, THUNDERTONK_WORKFLOW_ID);
    const validation = validateWorkflowDefinition(workflow);
    checks.push(check(
      "workflow",
      "Thundertonk Workflow",
      validation.valid && workflow.enabled && workflow.match.sources.includes(service.source),
      validation.valid ? `${workflow.id}: ${workflow.enabled ? "enabled" : "disabled"}` : validation.errors.join("; ")
    ));
    checks.push(pathCheck("rehearsal", "rehearsal executable", workflow.action.executable, constants.X_OK));
    const destinationRoot = expandHome(workflow.publication.destinationRoot);
    checks.push(directoryReadCheck("publication-root", "Google Drive publication root", destinationRoot));
  } catch (error) {
    checks.push({
      id: "workflow",
      label: "Thundertonk Workflow",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
  return checks;
}

function writeHealthState(service: ResolvedIngressService, value: object): void {
  const temporaryPath = `${service.healthStatePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, service.healthStatePath);
}

function readHealthState(filePath: string): { healthy: boolean; checkedAt: string } | null {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as { healthy?: unknown; checkedAt?: unknown };
    return typeof value.healthy === "boolean" && typeof value.checkedAt === "string"
      ? { healthy: value.healthy, checkedAt: value.checkedAt }
      : null;
  } catch {
    return null;
  }
}

function pathCheck(id: string, label: string, filePath: string, mode: number): IngressDoctorCheck {
  try {
    accessSync(filePath, mode);
    return { id, label, status: "pass", detail: filePath };
  } catch (error) {
    return { id, label, status: "fail", detail: `${filePath}: ${errorMessage(error)}` };
  }
}

function directoryReadCheck(id: string, label: string, directory: string): IngressDoctorCheck {
  try {
    accessSync(directory, constants.R_OK | constants.W_OK);
    readdirSync(directory);
    return { id, label, status: "pass", detail: directory };
  } catch (error) {
    return { id, label, status: "fail", detail: `${directory}: ${errorMessage(error)}` };
  }
}

function check(id: string, label: string, passed: boolean, detail: string): IngressDoctorCheck {
  return { id, label, status: passed ? "pass" : "fail", detail };
}

function runLaunchctl(args: string[], ignoreFailure = false): ReturnType<typeof spawnSync> {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (!ignoreFailure && result.error) throw result.error;
  return result;
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout?.toString() ?? "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr?.toString() ?? "";
  return `${stdout}\n${stderr}`.trim();
}

function launchDomain(): string {
  return `gui/${typeof process.getuid === "function" ? process.getuid() : 501}`;
}

function assertMacOS(): void {
  if (process.platform !== "darwin") throw validationError("Ingress service management requires macOS.");
}

function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : path.resolve(value);
}

function serviceExecutablePath(): string {
  return [...new Set([
    path.dirname(process.execPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(homedir(), "Library", "pnpm", "bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ])].join(":");
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderIngressServiceStatusSuccess(response: CommandSuccess<IngressServiceStatusData>): string[] {
  const status = response.data;
  return [
    `Ingress service: ${status.loaded ? "loaded" : status.installed ? "installed but not loaded" : "not installed"}`,
    `State: ${status.state}`,
    `Source: ${status.source}`,
    `Root: ${status.ingressRoot}`,
    `Plist: ${status.plistPath}`,
    `Error Log: ${status.errorLogPath}`,
    `Health State: ${status.healthStatePath}`
  ];
}

export function renderIngressServiceTickSuccess(
  response: CommandSuccess<{ discovered: number; processed: number; failed: number }>
): string[] {
  return response.data.discovered === 0 ? [] : [
    `Ingress discovered: ${response.data.discovered}`,
    `Processed: ${response.data.processed}`,
    `Failed: ${response.data.failed}`
  ];
}

export function renderIngressServiceDoctorSuccess(response: CommandSuccess<IngressServiceDoctorData>): string[] {
  return [
    `Ingress service health: ${response.data.healthy ? "healthy" : "needs attention"}`,
    ...response.data.checks.map((check) => `${check.status.toUpperCase()} ${check.label}: ${check.detail}`)
  ];
}

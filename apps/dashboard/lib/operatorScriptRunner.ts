export const operatorScriptRunnerSource = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(1);
const [scriptPath, firstStatePath, secondStatePath, lockPath, runDirectoryArg, runId, descriptorPath] = args;
const runRecordPath = args.length >= 7 ? firstStatePath : firstStatePath;
const latestStatePath = args.length >= 7 ? secondStatePath : firstStatePath;
const runDirectory = runDirectoryArg || path.dirname(runRecordPath);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
};
const writeState = (value) => {
  writeJson(latestStatePath, { ...value, ...(runId ? { runId } : {}) });
  if (runRecordPath !== latestStatePath) {
    const existing = fs.existsSync(runRecordPath) ? JSON.parse(fs.readFileSync(runRecordPath, "utf8")) : {};
    writeJson(runRecordPath, { ...existing, ...value, ...(runId ? { runId } : {}) });
  }
};
fs.mkdirSync(runDirectory, { recursive: true });
const stdout = fs.openSync(path.join(runDirectory, "stdout.log"), "a");
const stderr = fs.openSync(path.join(runDirectory, "stderr.log"), "a");
const startedAt = new Date().toISOString();
writeState({ status: "running", pid: process.pid, startedAt });
const env = { ...process.env };
env.ARCADIA_OPERATOR_SCRIPT_ID = path.basename(scriptPath, ".sh");
env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR = scriptPath.replace(/\.sh$/, ".json");
env.ARCADIA_OPERATOR_SCRIPT_RUN_ID = runId || "legacy";
env.ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY = runDirectory;
if (descriptorPath) env.ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR = descriptorPath;
delete env.NODE_ENV;
for (const key of Object.keys(env)) {
  if (key.startsWith("NEXT_") || key.startsWith("__NEXT_")) delete env[key];
}
const child = spawn(scriptPath, ["run"], { stdio: ["ignore", stdout, stderr], env });
let settled = false;
const finish = (status, exitCode, message) => {
  if (settled) return;
  settled = true;
  writeState({ status, startedAt, finishedAt: new Date().toISOString(), exitCode, ...(message ? { message } : {}) });
  try { fs.closeSync(stdout); } catch {}
  try { fs.closeSync(stderr); } catch {}
  try { fs.unlinkSync(lockPath); } catch {}
  process.exit(exitCode ?? 1);
};
child.once("error", (error) => finish("failed", null, error.message));
child.once("close", (code) => finish(code === 0 ? "succeeded" : "failed", code, null));
`;

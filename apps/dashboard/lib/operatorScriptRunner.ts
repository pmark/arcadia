export const operatorScriptRunnerSource = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const [scriptPath, statePath, lockPath] = process.argv.slice(1);
const writeState = (value) => {
  const temporary = statePath + ".tmp-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value) + "\n");
  fs.renameSync(temporary, statePath);
};
const startedAt = new Date().toISOString();
writeState({ status: "running", pid: process.pid, startedAt });
const child = spawn(scriptPath, ["run"], { stdio: "ignore" });
let settled = false;
const finish = (status, exitCode, message) => {
  if (settled) return;
  settled = true;
  writeState({ status, startedAt, finishedAt: new Date().toISOString(), exitCode, ...(message ? { message } : {}) });
  try { fs.unlinkSync(lockPath); } catch {}
  process.exit(exitCode ?? 1);
};
child.once("error", (error) => finish("failed", null, error.message));
child.once("close", (code) => finish(code === 0 ? "succeeded" : "failed", code, null));
`;

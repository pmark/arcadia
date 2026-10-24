import { readFileSync } from "node:fs";
import { ownerRequest, runOwnedValidationAsync, drainPreservationWorkspace } from "./preservationProcessLifecycle.js";
const input = JSON.parse(readFileSync(0, "utf8"));
(input.drainWorkspace
  ? drainPreservationWorkspace(input.drainWorkspace, input.timeoutMs)
  : input.socket && input.token
  ? ownerRequest(input.socket, { token: input.token, launch: input.launch }, input.launch.timeoutMs + 10_000)
  : runOwnedValidationAsync(input.launch))
  .then(result => process.stdout.write(JSON.stringify(result)))
  .catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });

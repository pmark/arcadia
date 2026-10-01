import { withDatabase } from "../db/connection.js";
import { runPreserveCommand } from "../commands/preserve.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import type { GoTransportResult } from "./goRequestProtocol.js";

/** Host-owned child for the protected preservation route. Candidate validation
 * and Git object work can be slow and synchronous; isolating it keeps the
 * service worker's event loop and transport heartbeat live. */
let result: GoTransportResult;
try {
  const [source, workspace] = process.argv.slice(2);
  if (process.env.CODEX_SANDBOX) throw new Error("Protected preservation must run on the host controller.");
  result = {
    ok: true,
    response: withDatabase(workspace, db => runPreserveCommand({
      source,
      workspace,
      db,
      onStage: stage => process.send?.({ type: "stage", stage })
    }))
  };
} catch (error) {
  result = goTransportFailure(error);
}

if (process.send) process.send({ type: "result", result }, () => process.disconnect());

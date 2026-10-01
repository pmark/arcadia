import { appendFileSync } from "node:fs";
import { runPreserveCommand } from "../commands/preserve.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import { withPreservationProgress } from "./preservationStages.js";
import { writePreservationAttempt } from "./preservationRequestExecutor.js";
import type { GoTransportResult } from "./goRequestProtocol.js";

const [source, workspace, attemptFile] = process.argv.slice(2);
let evidenceRef: unknown;
let currentStage = "host.start";
let result: GoTransportResult;
try {
  result = withPreservationProgress((stage, details) => {
    currentStage = stage;
    evidenceRef = details?.evidenceRef ?? evidenceRef;
    const event = { stage, at: Date.now(), ...details, evidenceRef };
    appendFileSync(`${attemptFile}.events.jsonl`, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    writePreservationAttempt(attemptFile, event);
  }, () => ({ ok: true, response: runPreserveCommand({ source, workspace }) }));
} catch (error) {
  result = goTransportFailure(error);
  if (!result.ok) result.error.details = { ...result.error.details, stage: result.error.details.stage ?? currentStage, attemptRef: attemptFile, evidenceRef: result.error.details?.evidenceRef ?? evidenceRef };
}
if (process.send) process.send(result, () => process.disconnect());

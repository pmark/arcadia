import { executeHostEnrollment } from "./hostEnrollment.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import { ENROLLMENT_REQUEST_MODES, type EnrollmentRequestMode, type EnrollmentTransportResult } from "./enrollmentRequestProtocol.js";

const [source, agent, requestId, callerId, mode] = process.argv.slice(2);
let result: EnrollmentTransportResult;
try {
  if (!ENROLLMENT_REQUEST_MODES.includes(mode as EnrollmentRequestMode)) throw new Error(`Unknown enrollment mode: ${mode}`);
  result = { ok: true, response: executeHostEnrollment({
    source, agent: agent as "codex" | "claude" | "opencode", requestId, callerId, mode: mode as EnrollmentRequestMode
  }) };
} catch (error) { result = goTransportFailure(error); }
if (process.send) process.send(result, () => process.disconnect());

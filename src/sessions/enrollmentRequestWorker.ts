import { executeHostEnrollment } from "./hostEnrollment.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import type { EnrollmentTransportResult } from "./enrollmentRequestProtocol.js";

const [source, agent, requestId, callerId] = process.argv.slice(2);
let result: EnrollmentTransportResult;
try {
  result = { ok: true, response: executeHostEnrollment(source, agent as "codex" | "claude" | "opencode", requestId, callerId) };
} catch (error) { result = goTransportFailure(error); }
if (process.send) process.send(result, () => process.disconnect());

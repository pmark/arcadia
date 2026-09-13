import { assertGoBrokerHostController, parseGoBrokerArguments, runGoBroker } from "../goBroker.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import type { GoTransportResult } from "./goRequestProtocol.js";

let result: GoTransportResult;
try {
  const [source, agent] = process.argv.slice(2);
  const request = parseGoBrokerArguments([agent, "go"], source);
  assertGoBrokerHostController(request);
  result = { ok: true, response: runGoBroker({ ...request, operation: "go" }) };
} catch (error) { result = goTransportFailure(error); }
if (process.send) process.send(result, () => process.disconnect());

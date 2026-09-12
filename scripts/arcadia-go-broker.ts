#!/usr/bin/env node
import { createFailure } from "../src/cli/response.js";
import { normalizeError } from "../src/cli/errors.js";
import { assertGoBrokerHostController, parseGoBrokerArguments, runGoBroker } from "../src/goBroker.js";

import { requestAgentGo, requestCandidatePreservation } from "../src/sessions/preservationTransport.js";

try {
  const request = parseGoBrokerArguments(process.argv.slice(2));
  if (request.operation === "go") {
    const response = await requestAgentGo(request.source, request.agent);
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  } else {
    assertGoBrokerHostController(request);
    const response = request.operation === "preserve"
      ? await requestCandidatePreservation(request.source)
      : runGoBroker({ ...request, operation: request.operation });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  }
} catch (error) {
  const normalized = normalizeError(error);
  process.stderr.write(`${JSON.stringify(createFailure("go-broker", normalized), null, 2)}\n`);
  process.exitCode = normalized.exitCode;
}

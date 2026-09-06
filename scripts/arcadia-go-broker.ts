#!/usr/bin/env node
import { createFailure } from "../src/cli/response.js";
import { normalizeError } from "../src/cli/errors.js";
import { parseGoBrokerArguments, runGoBroker } from "../src/goBroker.js";

try {
  const response = runGoBroker(parseGoBrokerArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
} catch (error) {
  const normalized = normalizeError(error);
  process.stderr.write(`${JSON.stringify(createFailure("go-broker", normalized), null, 2)}\n`);
  process.exitCode = normalized.exitCode;
}

#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createFailure } from "../src/cli/response.js";
import { normalizeError } from "../src/cli/errors.js";
import {
  BRIEF_SELF_TEST_ENV,
  briefChildCorrelationId,
  briefDeadlineMs,
  briefFailureReceipt,
  reportBriefStage,
  superviseBrief,
  type BriefStage
} from "../src/briefSupervisor.js";
import { assertGoBrokerHostController, parseGoBrokerArguments, runGoBroker } from "../src/goBroker.js";

import { requestAgentGo, requestCandidatePreservation } from "../src/sessions/preservationTransport.js";

// A fixed brief always answers with exactly one JSON document on stdout: the
// dispatch brief, or a failure naming its stage, correlation id and recovery.
// The launcher's process supervises; the same entrypoint re-spawned with the
// internal child marker (an environment variable, never an argument) does the
// synchronous work in its own process group.
const briefChild = briefChildCorrelationId();
let briefStage: BriefStage = "spawn";

try {
  const request = parseGoBrokerArguments(process.argv.slice(2));
  if (request.operation === "go") {
    const response = await requestAgentGo(request.source, request.agent);
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  } else if (request.operation === "brief" && !briefChild) {
    const correlationId = randomUUID();
    try {
      const outcome = await superviseBrief({
        command: process.execPath,
        args: [...process.execArgv, process.argv[1], ...process.argv.slice(2)],
        cwd: process.cwd(),
        env: process.env,
        correlationId,
        deadlineMs: briefDeadlineMs()
      });
      process.stdout.write(outcome.receipt);
      process.exitCode = outcome.exitCode;
    } catch (error) {
      const normalized = normalizeError(error);
      process.stdout.write(briefFailureReceipt(normalized, { stage: briefStage, correlationId }));
      process.exitCode = normalized.exitCode;
    }
  } else if (request.operation === "brief" && briefChild) {
    const reportStage = (stage: BriefStage) => {
      briefStage = stage;
      reportBriefStage(stage, briefChild);
    };
    if (process.env[BRIEF_SELF_TEST_ENV] === "1") {
      // Proves the installed runtime, entrypoint and module graph can
      // self-spawn and answer, without a workspace, claim, database or Git.
      reportStage("self-test");
      process.stdout.write(`${JSON.stringify({
        ok: true,
        command: "brief-broker.self-test",
        data: { correlationId: briefChild, readOnly: true },
        artifacts: [],
        warnings: []
      }, null, 2)}\n`);
    } else {
      const response = runGoBroker(
        { ...request, operation: "brief" },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { reportStage, correlationId: briefChild }
      );
      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    }
  } else {
    assertGoBrokerHostController(request);
    const response = request.operation === "preserve"
      ? await requestCandidatePreservation(request.source)
      : runGoBroker({ ...request, operation: request.operation });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  }
} catch (error) {
  const normalized = normalizeError(error);
  if (briefChild) {
    process.stdout.write(briefFailureReceipt(normalized, { stage: briefStage, correlationId: briefChild }));
  } else {
    process.stderr.write(`${JSON.stringify(createFailure("go-broker", normalized), null, 2)}\n`);
  }
  process.exitCode = normalized.exitCode;
}

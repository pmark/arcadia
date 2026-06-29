/**
 * Sample consumer script for @pmark/arcadia/intelligence/client.
 *
 * This is what a companion app (e.g. Rebuster) does after `pnpm link`:
 * import only the two public subpaths, build a generic IntelligenceRequest,
 * submit it, poll/retry it, and read the result. No Arcadia internals
 * (service, worker, SQLite, LiteLLM, config) are imported here — everything
 * goes through HTTP via the client.
 *
 * Run the real service first:
 *   pnpm arcadia intelligence serve --workspace ./tmp/demo-workspace --port 4710
 *
 * Then run this script against it (after `pnpm link --global @pmark/arcadia`
 * in the consumer repo):
 *   tsx docs/intelligence/examples/consumer-example.ts
 */
import { ArcadiaIntelligenceClient } from "@pmark/arcadia/intelligence/client";
import type {
  ExecutionPolicy,
  IntelligenceJob,
  IntelligenceRequest,
  OutputContract,
  PromptTemplateRef,
} from "@pmark/arcadia/intelligence/contracts";

// 1. Configure the client. The base URL is owned by the consumer app's own
//    config/env, not by the linked package.
const client = new ArcadiaIntelligenceClient({
  baseUrl: process.env.ARCADIA_INTELLIGENCE_BASE_URL ?? "http://127.0.0.1:4710",
});

// 2. Describe the shape of the result you want back. Arcadia validates the
//    job's output against this JSON Schema; it never interprets it.
const outputContract: OutputContract = {
  schemaId: "rebuster.candidate-list.v1",
  schemaVersion: 1,
  jsonSchema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  },
};

// 3. Reference the prompt template you used to build this request. Arcadia
//    stores this for provenance; it does not render or own the template.
const template: PromptTemplateRef = {
  id: "rebuster.candidate-list-prompt",
  version: "1",
  sourceRef: "rebuster/src/prompts/candidateList.md",
};

// 4. Declare what the job is and isn't allowed to do. v0.1 defaults to no
//    paid fallback and one retry; both can be made explicit here.
const executionPolicy: ExecutionPolicy = {
  allowPaidUsage: false,
  maxRetries: 1,
};

// 5. Build the request. `idempotencyKey` makes repeated submissions safe to
//    retry from the caller's side without creating duplicate jobs.
//
// `capability` / `execution` / `profile` are how Arcadia routes this request
// — never a LiteLLM route, provider, or model name:
//   - capability: the operation needed ("text.generate" here).
//   - execution: "local-preferred" uses a local route when one is
//     configured; it never silently escalates to cloud.
//   - profile: the optimization target ("fast" here).
// `operationId` is unrelated to routing — it's Rebuster's own identifier
// for this workflow, stored for provenance/logging only; Arcadia never
// interprets it or uses it to pick a route.
const request: IntelligenceRequest = {
  idempotencyKey: `rebuster-candidate-list-${Date.now()}`,
  operationId: "rebuster.generate-candidate-list",
  clientApp: "rebuster",
  projectId: "proj_example",
  capability: "text.generate",
  execution: "local-preferred",
  profile: "fast",
  input: {
    topic: "weekend hiking trip names",
    count: 5,
  },
  outputContract,
  template,
  executionPolicy,
};

async function main() {
  // 6. Submit. `created` is false if this idempotencyKey already exists.
  const { job: submittedJob, created } = await client.submit(request);
  console.log(`submitted job ${submittedJob.id} (created=${created})`);

  // 7. Poll a single job snapshot directly, if you want manual control.
  const snapshot = await client.getJob(submittedJob.id);
  console.log(`job ${snapshot.id} status: ${snapshot.status}`);

  // 8. Or let the client poll until the job reaches a terminal status
  //    (completed, failed, or blocked).
  let job: IntelligenceJob = await client.waitForCompletion(submittedJob.id, {
    pollIntervalMs: 500,
    timeoutMs: 30_000,
  });

  // 9. A failed/blocked job can be retried (subject to maxRetries).
  if (job.status === "failed" || job.status === "blocked") {
    console.log(`job ${job.id} ${job.status}, retrying once`);
    const { job: retriedJob } = await client.retry(job.id);
    job = await client.waitForCompletion(retriedJob.id, { timeoutMs: 30_000 });
  }

  // 10. Read the outcome. `result` is the validated JSON payload matching
  //     outputContract.jsonSchema; `usage` and `validation` carry provenance.
  switch (job.status) {
    case "completed":
      console.log("result:", job.result);
      console.log("usage:", job.usage);
      console.log("validation:", job.validation);
      break;
    case "failed":
      console.error("job failed:", job.error);
      break;
    case "blocked":
      console.error("job blocked (e.g. LiteLLM unreachable):", job.error);
      break;
    default:
      console.error(`unexpected terminal status: ${job.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

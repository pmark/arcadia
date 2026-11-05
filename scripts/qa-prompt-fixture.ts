/**
 * Print the exact reviewer prompt `arcadia qa pr` would assemble today from the
 * real inputs of pmark/arcadia#2062's QA attempt (tests/fixtures/qa-prompt-2062.json),
 * with its Operator QA plan re-rendered by today's renderer. No GitHub read, no
 * workspace write and no model call: hand the output to the real reviewer to see
 * how it judges the current prompt on a candidate QA has already failed.
 *
 * Usage: node --import tsx scripts/qa-prompt-fixture.ts [--role qa|code-review] > prompt.md
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assemblePrReviewPrompt } from "../src/qa/prReview.js";
import { renderOperatorQaPlan, type OperatorQaPlanFacts, type OperatorQaPlanSource } from "../src/sessions/operatorQaPlan.js";

type PromptInput = Parameters<typeof assemblePrReviewPrompt>[0];

export interface QaPromptFixture extends Omit<PromptInput, "role"> {
  source: string;
  planSource: OperatorQaPlanSource;
  planFacts: OperatorQaPlanFacts;
}

export function loadQaPromptFixture(): QaPromptFixture {
  return JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../tests/fixtures/qa-prompt-2062.json"), "utf8")) as QaPromptFixture;
}

/** The plan today's renderer writes for the fixture's Action, in place of the plan the real body carried. */
export function fixturePullRequestBody(fixture: QaPromptFixture): string {
  const rendered = renderOperatorQaPlan(fixture.planSource, fixture.planFacts);
  if (rendered.status !== "rendered") throw new Error(`The fixture's plan refused: ${rendered.reason}`);
  const original = fixture.pullRequest.body ?? "";
  const evidenceAt = original.indexOf("\n\n### Validation evidence");
  if (evidenceAt < 0) throw new Error("The fixture's pull-request body has no Validation evidence section.");
  return `${rendered.body}${original.slice(evidenceAt)}`;
}

export function fixturePrompt(role: "qa" | "code-review" = "qa"): string {
  const fixture = loadQaPromptFixture();
  return assemblePrReviewPrompt({
    role,
    candidate: fixture.candidate,
    pullRequest: { ...fixture.pullRequest, body: fixturePullRequestBody(fixture) },
    patch: fixture.patch,
    sandboxProof: fixture.sandboxProof,
    identity: fixture.identity,
    settlementRecords: fixture.settlementRecords,
    settled: fixture.settled,
    declaredCommits: fixture.declaredCommits
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const at = process.argv.indexOf("--role");
  const role = at >= 0 ? process.argv[at + 1] : "qa";
  if (role !== "qa" && role !== "code-review") {
    console.error("Usage: node --import tsx scripts/qa-prompt-fixture.ts [--role qa|code-review]");
    process.exit(2);
  }
  process.stdout.write(`${fixturePrompt(role)}\n`);
}

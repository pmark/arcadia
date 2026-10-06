import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkQaPlanConsistency, parseRenderedPlan, type QaPlanConsistencyReport } from "../../../scripts/qa-plan-consistency.js";
import { git } from "../../helpers/rehearsalHarness.js";
import type { ActionWork, ExecutorResult } from "./executor.js";
import type { FastRehearsal } from "./world.js";

/**
 * The long chain: nine tiny dependent Actions in three batches of three, the
 * shape of the operator's overnight run (one G7 press, nine Actions inside
 * the Grant's 12-hour window). Step k appends one line to its batch's file,
 * `chain/batch-<b>.md`, and that line is derived from step k-1's line (the
 * first step of batches 2 and 3 reads the previous batch's file), so a step
 * launched from any base but its predecessor's integrated head cannot do its
 * work: the executor stops, and the declared check refuses a wrong line.
 */
export const CHAIN_LENGTH = 9;
export const BATCH_SIZE = 3;
export const CHAIN: readonly string[] = Array.from({ length: CHAIN_LENGTH }, (_, index) => `chain-step-${index + 1}`);
export const CHAIN_VALIDATION = "node scripts/check-chain.mjs";

export const batchOf = (step: number): number => Math.ceil(step / BATCH_SIZE);
export const chainFile = (batch: number): string => `chain/batch-${batch}.md`;

/** Step `step`'s line, from its predecessor's line. */
export function chainLine(step: number, previous: string | null): string {
  if (step === 1) return "step 1 starts the chain";
  if (previous === null) throw new Error(`step ${step} needs step ${step - 1}'s line`);
  return `step ${step} follows step ${step - 1} (${createHash("sha256").update(previous).digest("hex").slice(0, 12)})`;
}

/** Every step's line, in order. */
export function chainLines(): string[] {
  const lines: string[] = [];
  for (let step = 1; step <= CHAIN_LENGTH; step += 1) lines.push(chainLine(step, lines.at(-1) ?? null));
  return lines;
}

/** The content of every batch file once `steps` steps are done. */
export function chainFilesAfter(steps: number): Record<string, string> {
  const lines = chainLines().slice(0, steps);
  const files: Record<string, string> = {};
  lines.forEach((line, index) => {
    const file = chainFile(batchOf(index + 1));
    files[file] = `${files[file] ?? ""}${line}\n`;
  });
  return files;
}

/** The genesis check the Project declares: every batch file present is a prefix of its expected lines, and batches fill in order. */
const CHECK_SCRIPT = `import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
const LENGTH = ${CHAIN_LENGTH}, BATCH = ${BATCH_SIZE};
const expected = [];
for (let step = 1; step <= LENGTH; step += 1) {
  expected.push(step === 1 ? "step 1 starts the chain"
    : \`step \${step} follows step \${step - 1} (\${createHash("sha256").update(expected.at(-1)).digest("hex").slice(0, 12)})\`);
}
let previousComplete = true;
for (let batch = 1; batch <= LENGTH / BATCH; batch += 1) {
  const file = \`chain/batch-\${batch}.md\`;
  if (!existsSync(file)) { previousComplete = false; continue; }
  if (!previousComplete) { console.error(\`\${file} exists before batch \${batch - 1} is complete\`); process.exit(1); }
  const lines = readFileSync(file, "utf8").split("\\n");
  if (lines.at(-1) !== "") { console.error(\`\${file} must end with a newline\`); process.exit(1); }
  lines.pop();
  const want = expected.slice((batch - 1) * BATCH, batch * BATCH);
  if (lines.length === 0 || lines.length > want.length || lines.some((line, index) => line !== want[index])) {
    console.error(\`\${file} is not a prefix of its expected lines: \${JSON.stringify(lines)}\`);
    process.exit(1);
  }
  previousComplete = lines.length === want.length;
}
`;

/** The Plan's nine Actions (the Rehearsal fixture's `fixturePlan`). */
export function longChainFixture(): { firstAction: string; actionsYaml: string; genesisFiles: Record<string, string> } {
  const actionsYaml = CHAIN.map((id, index) => {
    const step = index + 1;
    const file = chainFile(batchOf(step));
    const title = step === 1
      ? `Implement chain step 1 by creating ${file} with the line "step 1 starts the chain".`
      : `Implement chain step ${step} (batch ${batchOf(step)}) by appending to ${file} the line derived from step ${step - 1}'s line.`;
    return `  - id: ${id}
    title: ${title}
    status: open
    responsibility: agent
    effort: session
    next_action: ${title}
    expected_artifact: ${file} ending with step ${step}'s line
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - ${file} ends with step ${step}'s line${step === 1 ? "" : `, which names step ${step - 1} and the first 12 hex digits of the SHA-256 of step ${step - 1}'s line`}, and no other chain line changes.
    depends_on: [${step === 1 ? "" : CHAIN[index - 1]}]
    decisions: []
`;
  }).join("");
  return { firstAction: CHAIN[0], actionsYaml, genesisFiles: { "scripts/check-chain.mjs": CHECK_SCRIPT } };
}

/**
 * What step k's agent does: read its predecessor's line from the candidate
 * worktree (refusing when it is missing or is not step k-1's), and append
 * its own line to its batch's file.
 */
export function chainWork(step: number): ActionWork {
  return {
    validation: CHAIN_VALIDATION,
    files: (worktree) => {
      let previous: string | null = null;
      if (step > 1) {
        const source = path.join(worktree, chainFile(batchOf(step - 1)));
        const last = existsSync(source) ? readFileSync(source, "utf8").trimEnd().split("\n").at(-1) ?? "" : "";
        if (!last.startsWith(`step ${step - 1} `)) {
          throw new Error(`chain step ${step}: the predecessor's output is not in this worktree (${chainFile(batchOf(step - 1))} ends with ${JSON.stringify(last)}); the Session was launched from the wrong base.`);
        }
        previous = last;
      }
      const target = chainFile(batchOf(step));
      const existing = existsSync(path.join(worktree, target)) ? readFileSync(path.join(worktree, target), "utf8") : "";
      return { [target]: `${existing}${chainLine(step, previous)}\n` };
    }
  };
}

/** Simulated minutes each step's agent works (no tick runs meanwhile), so nine steps span several hours. */
export const AGENT_MINUTES = 30;

type StatusView = ReturnType<FastRehearsal["productionStatus"]>;

/** One chain step as it went through the lifecycle, with `production status` at each stage. */
export interface ChainStep {
  actionId: string;
  result: ExecutorResult;
  launchBase: string;
  /** The PR as GitHub reports it when preservation opened it, and the replay check against it. */
  view: ReturnType<FastRehearsal["gh"]["view"]>;
  published: ReturnType<typeof parseRenderedPlan>;
  consistency: QaPlanConsistencyReport;
  /** `production status` while the agent works, and right after preservation. */
  building: StatusView;
  preserved: StatusView;
  /** The local base right after this step integrated (null when it was not driven to integration). */
  baseAfter: string | null;
  /** Simulated time when the step was admitted. */
  admittedAt: string;
}

/**
 * Drive chain step `index` (0-based) through the real lifecycle: tick until it
 * is admitted, let the agent work for {@link AGENT_MINUTES} simulated minutes,
 * run the scripted executor, tick until terminal preservation opens its PR,
 * and (unless `integrate` is false) tick until it integrates by local
 * fast-forward.
 */
export function runChainStep(world: FastRehearsal, index: number, options: { integrate?: boolean } = {}): ChainStep {
  const actionId = CHAIN[index];
  const { session, launch } = world.untilLaunched(actionId, index === 0 ? 3 : 4);
  const admittedAt = world.now.toISOString();
  const building = world.productionStatus();
  world.advanceClock(AGENT_MINUTES * 60_000);
  const result = world.execute(launch, actionId);
  world.tickUntil((r) => r.handoff?.preservation.kind === "preserved", 2);
  const preserved = world.productionStatus();
  const pr = world.pullRequestFor(actionId);
  if (!pr) throw new Error(`${actionId} was preserved without a PR.`);
  const view = world.gh.view(pr);
  const consistency = checkQaPlanConsistency({
    repositoryPath: world.repo, pullRequest: view, base: session.base_revision, baseSource: `${actionId} Session's launch base`, branch: pr.branch
  });
  world.recorder.notes.push(`${actionId}: PR on ${view.baseRefName} (qa-plan-consistency ${consistency.consistent ? "consistent" : JSON.stringify(consistency.mismatches)})`);
  let baseAfter: string | null = null;
  if (options.integrate !== false) {
    world.untilIntegrated(actionId);
    baseAfter = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();
  }
  return { actionId, result, launchBase: session.base_revision, view, published: parseRenderedPlan(view.body), consistency, building, preserved, baseAfter, admittedAt };
}

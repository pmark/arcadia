const { appendFileSync, readFileSync } = require("node:fs");

const modePath = process.argv[2];
const logPath = process.argv[3];
const mode = readFileSync(modePath, "utf8").trim() || "success";
let packet = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { packet += chunk; });
process.stdin.on("end", () => {
  const startedAt = new Date().toISOString();
  appendFileSync(logPath, `${JSON.stringify({ pid: process.pid, cwd: process.cwd(), mode, startedAt, packetBytes: packet.length })}\n`);
  if (mode === "timeout") {
    setTimeout(() => process.exit(124), 70_000);
    return;
  }
  if (mode === "invalid") {
    process.stdout.write("# Pinterest Plan\n\n## Recommended Next Action\nReview.\n");
    return;
  }
  const plan = [
    "# Pinterest Publishing Plan",
    "",
    "## Ordered Phases",
    "1. Define the repository-only publishing adapter contract and fixtures.",
    "2. Implement local validation with no credentials or external calls.",
    "3. Review the validated Artifact before any separate implementation approval.",
    "",
    "## Repository Impact Assessment",
    "- Future work is limited to the Rebuster repository and fixture tests.",
    "",
    "## Approval Requirements",
    "- This is planning only. Publishing, credentials, deployment, spending, messaging, merging, and destructive actions require separate approval.",
    "",
    "## Validation Strategy",
    "- Use deterministic unit and integration fixtures in a future approved implementation Run.",
    "- No validation command was executed while preparing this plan.",
    "",
    "## Risks And Open Questions",
    "- Risk: Pinterest API requirements may change.",
    "- Open question: which board mapping belongs in configuration.",
    "",
    "## Recommended Next Action",
    "Accept this plan, then create the smallest repository-only implementation Action.",
    "",
    "## Smallest Useful Follow-up Codex Goal",
    "Implement only the local Pinterest publishing adapter contract and deterministic tests, with no external service calls."
  ].join("\n");
  process.stdout.write(plan);
  if (mode === "nonzero") {
    process.stderr.write("deterministic fake executor failure\n");
    process.exitCode = 9;
  }
});

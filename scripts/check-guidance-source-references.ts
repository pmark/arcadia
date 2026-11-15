import { readFileSync } from "node:fs";
import { verifyGuidanceSourceRevision } from "../src/projects/agentGuidance.js";

const manifest = JSON.parse(readFileSync("docs/agent-guidance/source-references.json", "utf8")) as { revision: string; files: Record<string, string> };
verifyGuidanceSourceRevision(process.cwd(), manifest);
console.log(`Verified ${Object.keys(manifest.files).length} source references at ${manifest.revision}.`);

import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHAIN_KINDS, chainLauncher, chainLibraryIds, validateChainParams } from "../src/operatorActions/rehearsalChain.js";
import { chainDescriptorText } from "../src/operatorActions/rehearsalChainDescriptors.js";

// Renders each rehearsal-chain run's four /runs library entries (launcher and
// descriptor) from its reviewed parameter file. `--check` writes nothing and
// fails on any drift. Never runs an operator action or opens a workspace.
const args = process.argv.slice(2);
const check = args.includes("--check");
const library = path.resolve(import.meta.dirname, "../artifacts/generated/operator-scripts");
const paramsDir = path.join(library, "rehearsal-chain", "params");
const files = args.filter((arg) => arg !== "--check");
const targets = files.length > 0 ? files.map((file) => path.resolve(file)) : readdirSync(paramsDir).filter((file) => file.endsWith(".json")).sort().map((file) => path.join(paramsDir, file));
let drift = 0;
for (const file of targets) {
  const { params, problems } = validateChainParams(JSON.parse(readFileSync(file, "utf8")));
  if (!params) throw new Error(`${file}: ${problems.join("; ")}`);
  if (path.basename(file) !== `${params.runId}.json` || path.dirname(file) !== paramsDir) throw new Error(`${file} must be rehearsal-chain/params/${params.runId}.json`);
  const ids = chainLibraryIds(params.runId);
  for (const kind of CHAIN_KINDS) {
    const launcher = path.join(library, `${ids[kind]}.sh`);
    const descriptor = path.join(library, `${ids[kind]}.json`);
    const wanted: Array<[string, string]> = [[launcher, chainLauncher(kind, params.runId)], [descriptor, chainDescriptorText(kind, params)]];
    for (const [target, text] of wanted) {
      const current = existsSync(target) ? readFileSync(target, "utf8") : null;
      if (current === text) continue;
      drift++;
      if (check) { process.stderr.write(`drift: ${path.relative(library, target)}\n`); continue; }
      writeFileSync(target, text);
      process.stdout.write(`wrote ${path.relative(library, target)}\n`);
    }
    if (!check) chmodSync(launcher, 0o755);
  }
}
if (check && drift > 0) {
  process.stderr.write("Rehearsal-chain library entries differ from their parameter files; run: node --import tsx scripts/render-rehearsal-chain-operator-scripts.ts\n");
  process.exitCode = 1;
}

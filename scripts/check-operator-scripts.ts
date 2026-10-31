import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { assertProjectLibraryEntry, OperatorScriptContractError, validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { matchRetirement, parseRetirementManifest } from "../src/operatorActions/libraryRetirements.js";
import { confinedProjectLibrary, discoverProjectOperatorLibraries } from "../src/operatorActions/projectLibraries.js";

// Reads only library pairs and the tracked retirement manifest, plus (read-only) the Project registry to find each
// registered Project's own library. Never executes an action.
//
//   check-operator-scripts.ts [--retirements <manifest>]
//     Arcadia's library in this checkout, then every registered Project's library that /actions reads.
//   check-operator-scripts.ts <library> [--retirements <manifest>]
//     That one library, exactly as before.
//   check-operator-scripts.ts --project <slug> <repository>
//     Only that Project's library inside <repository> (for a Project's own checkout or CI).
const args = process.argv.slice(2);
const take = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args.splice(index, 2)[1] ?? "" : undefined;
};
const manifestPath = take("--retirements") ?? path.resolve(import.meta.dirname, "../src/operatorActions/legacyRetirements.json");
const projectOnly = take("--project");
let retirements: ReturnType<typeof parseRetirementManifest>;
try {
  if (!manifestPath) throw new Error("--retirements needs a manifest path.");
  retirements = parseRetirementManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
} catch (error) {
  process.stderr.write(JSON.stringify({ reason: "INVALID_RETIREMENT_MANIFEST", manifest: manifestPath ?? null, message: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exit(1);
}

interface LibraryResult { checked: number; failures: number; retired: string[]; unpublished: string[]; staleExecutorPins: string[] }

/**
 * Validate one library. Arcadia's library validates every pair. A Project's library validates exactly the
 * entries that publish themselves to /actions by naming that Project (`project`); the rest are reported as
 * unpublished, because /actions never lists them. The retirement manifest applies to Arcadia's library only.
 */
function checkLibrary(library: string, project: string | null): LibraryResult {
  const result: LibraryResult = { checked: 0, failures: 0, retired: [], unpublished: [], staleExecutorPins: [] };
  // The START executor's fixture-only wait shortening is keyed to this marker; it may exist only in a test's fake library.
  if (existsSync(path.join(library, ".start-run-test-fixture"))) {
    result.failures++;
    process.stderr.write(JSON.stringify({ id: ".start-run-test-fixture", reason: "INVALID_OPERATOR_CONTRACT", message: "The START executor test-fixture marker must never exist in a real operator-script library." }) + "\n");
  }
  for (const entry of readdirSync(library).filter(file => file.endsWith(".json")).sort()) {
    const id = entry.slice(0, -5);
    const label = project === null ? id : `${project}--${id}`;
    try {
      const descriptorBytes = readFileSync(path.join(library, entry));
      if (project !== null) {
        let raw: unknown;
        try { raw = JSON.parse(descriptorBytes.toString("utf8")); } catch { raw = undefined; }
        if ((raw as { project?: unknown } | undefined)?.project !== project) { result.unpublished.push(id); continue; }
        assertProjectLibraryEntry(raw, project);
      }
      const script = realpathSync(path.join(library, `${id}.sh`));
      if (path.dirname(script) !== library) throw new Error("Executable resolves outside the library.");
      if (path.dirname(realpathSync(path.join(library, entry))) !== library) throw new Error("Descriptor resolves outside the library.");
      accessSync(script, constants.X_OK);
      const scriptBytes = readFileSync(script);
      // Exact-hash pin only: any changed, renamed or new file falls through to full validation.
      if (project === null && matchRetirement(retirements, id, descriptorBytes, scriptBytes)) { result.retired.push(id); continue; }
      // A launcher that execs a shared implementation inside the library (the rehearsal-chain set) is
      // judged together with that implementation, so its text checks (an undeclared settlement, a
      // bespoke Plan-amendment runner) cannot be hidden one file away.
      let scriptText = scriptBytes.toString("utf8");
      for (const target of scriptText.matchAll(/^exec "\$library_dir\/([^"$]+)"/gm)) {
        const resolved = realpathSync(path.join(library, target[1]));
        if (!resolved.startsWith(library + path.sep)) throw new Error(`Launcher target ${target[1]} resolves outside the library.`);
        scriptText += "\n" + readFileSync(resolved, "utf8");
      }
      const descriptor = validateOperatorScriptContract(JSON.parse(descriptorBytes.toString("utf8")), id, scriptText);
      // A per-run START card (Decisions 0156/0157) is a thin launcher (its exact text is validated above) over the one shared,
      // reviewed executor. The executor must exist and be executable; a card whose pinned executor hash no longer matches this
      // checkout is reported (it would refuse at press time), not failed, because executor edits legitimately outlive old cards.
      if (descriptor.startRun) {
        const executor = path.resolve(import.meta.dirname, "../scripts/start-run.sh");
        accessSync(executor, constants.X_OK);
        if (createHash("sha256").update(readFileSync(executor)).digest("hex") !== descriptor.startRun.executorSha256) result.staleExecutorPins.push(id);
      }
      // A "Do this next" hint must name a published prerequisite; voided_by may name host-local entries.
      if (descriptor.next_after && !existsSync(path.join(library, `${descriptor.next_after.id}.json`))) {
        throw new OperatorScriptContractError("UNKNOWN_NEXT_AFTER_PREREQUISITE", `next_after names ${descriptor.next_after.id}, which is not in this library.`);
      }
      result.checked++;
    } catch (error) {
      result.failures++;
      process.stderr.write(JSON.stringify({ id: label, reason: error instanceof OperatorScriptContractError ? error.reason : "INVALID_OPERATOR_CONTRACT", message: error instanceof Error ? error.message : String(error) }) + "\n");
    }
  }
  return result;
}

if (projectOnly !== undefined) {
  const repository = args[0];
  const library = projectOnly && repository ? confinedProjectLibrary(projectOnly, path.resolve(repository)) : null;
  if (!library) {
    process.stderr.write(JSON.stringify({ reason: "INVALID_PROJECT_LIBRARY", message: "--project needs a Project slug and the absolute path of a repository that has artifacts/generated/operator-scripts inside it." }) + "\n");
    process.exit(1);
  }
  const result = checkLibrary(library.path, library.project);
  process.stdout.write(JSON.stringify({ project: library.project, checked: result.checked, unpublished: result.unpublished.length, unpublishedIds: result.unpublished, failures: result.failures }) + "\n");
  process.exitCode = result.failures ? 1 : 0;
} else {
  const library = realpathSync(args[0] ?? path.resolve(import.meta.dirname, "../artifacts/generated/operator-scripts"));
  const own = checkLibrary(library, null);
  // An explicit library argument checks that library alone; the default also checks every registered Project's.
  const discovery = args[0] === undefined ? discoverProjectOperatorLibraries(library) : { libraries: [], unavailable: null };
  const projects = discovery.libraries.map(({ project, path: projectLibrary }) => {
    const result = checkLibrary(projectLibrary, project);
    return { project, checked: result.checked, unpublished: result.unpublished.length, failures: result.failures };
  });
  const failures = own.failures + projects.reduce((sum, project) => sum + project.failures, 0);
  process.stdout.write(JSON.stringify({
    checked: own.checked, retired: own.retired.length, retiredIds: own.retired, failures,
    ...(own.staleExecutorPins.length ? { staleExecutorPins: own.staleExecutorPins } : {}),
    ...(args[0] === undefined ? { projects, ...(discovery.unavailable ? { projectLibraries: discovery.unavailable } : {}) } : {})
  }) + "\n");
  process.exitCode = failures ? 1 : 0;
}

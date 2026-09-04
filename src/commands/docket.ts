import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import { listOperatorTasks } from "../docs/operatorTasks.js";
import { renderDispatchResolution } from "./next.js";

export interface DocketCommandOptions {
  /** The repository to read. Defaults to the working directory. */
  repo: string;
  /** Project slug, when a repository declares more than one PROJECT.md. */
  project?: string;
}

export interface DocketCommandData extends DispatchResolution {
  dispatchable: boolean;
  repoRoot: string;
  /** Count of open operator tasks, so they surface without a separate hunt. */
  openOperatorTasks: number;
}

/**
 * What this repository says to work on next, read only from this repository.
 *
 * `next` answers the same question, but reaches it through the workspace
 * database: it looks a Project up by slug, reads `repo_path` from its
 * metadata, and journals the resolution. Every one of those steps needs a
 * workspace that exists on the operator's own machine, so `next` cannot run in
 * a cloud container, a fresh clone, or CI — the environments where an agent is
 * least oriented and most needs to ask.
 *
 * None of that machinery is load-bearing for the answer. `resolveDispatch`
 * reads `PROJECT.md` and `docs/plans/` off the filesystem and computes the
 * pointer, the executability test, and every blocker without touching a
 * database. This command is that function with a repository path in front of
 * it, which is all a project ever needed to answer for itself.
 *
 * The cost is real and worth naming: with no workspace there is no dispatch
 * journal and no cross-project context. This command reports one repository's
 * state accurately, and says nothing about the portfolio.
 */
export function runDocketCommand(options: DocketCommandOptions): CommandSuccess<DocketCommandData> {
  const repoRoot = options.repo;
  const resolution = resolveDispatch(repoRoot, options.project);
  const openOperatorTasks = listOperatorTasks(repoRoot, "waiting").length;

  return createSuccess({
    command: "docket",
    data: {
      ...resolution,
      dispatchable: isDispatchable(resolution),
      repoRoot,
      openOperatorTasks
    }
  });
}

export function renderDocketSuccess(response: CommandSuccess<DocketCommandData>): string[] {
  const lines = renderDispatchResolution(response.data);
  // Stated every run, not only on failure. An agent that cannot tell whether it
  // is seeing one repository or the portfolio will eventually assume the wider
  // one, and a docket that quietly omits cross-project state is exactly the
  // kind of silent staleness the Way exists to prevent.
  lines.push("", "Source: this repository's managed documents only — no workspace, no portfolio context.");
  if (response.data.openOperatorTasks > 0) {
    lines.push(
      `${response.data.openOperatorTasks} operator task(s) waiting — run \`arcadia operator-task list\` to see them.`
    );
  }
  return lines;
}

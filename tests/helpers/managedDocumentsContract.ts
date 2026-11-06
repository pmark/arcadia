import { expect } from "vitest";
import { discoverDocs } from "../../src/docs/discover.js";
import { resolveDispatch, resolveFinishedActivePlan } from "../../src/docs/dispatch.js";

/**
 * The managed-documents contract a checked-in repository must satisfy: its
 * control documents parse, and dispatch resolves one current Action with no
 * blockers (or one open operator question). The single exception is the
 * finished active Plan a completion settlement leaves when it activates no
 * successor (Issue #2147, `resolveFinishedActivePlan`): no Action resolves
 * there by design, so the contract requires that exact state with no blocker
 * it does not explain. Any other unresolved pointer still fails.
 *
 * Shared by the contract test over this repository and by fixtures that drive
 * a real settlement and then check the documents it wrote.
 */
export function expectManagedDocumentsContract(repoRoot: string, projectSlug: string): void {
  const discovered = discoverDocs(repoRoot);
  expect(discovered.errors).toEqual([]);
  expect(discovered.rejected).toEqual([]);

  const resolution = resolveDispatch(repoRoot, projectSlug);
  if (resolution.context === null) {
    const finished = resolveFinishedActivePlan(repoRoot, projectSlug);
    expect(finished, `No current Action resolves and the active Plan is not a finished Plan: ${JSON.stringify(resolution.blockers)}`)
      .not.toBeNull();
    expect(finished?.blockers).toEqual([]);
    return;
  }
  if (resolution.operatorQuestion) {
    expect(resolution.context.action.responsibility).toBe("requires_review");
    expect(resolution.context.action.clarification).toBe("question_open");
    expect(resolution.blockers.every((blocker) => blocker.field === "status")).toBe(true);
  } else {
    expect(resolution.blockers).toEqual([]);
  }
}

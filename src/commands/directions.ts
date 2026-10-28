import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { validationError } from "../cli/errors.js";
import { withDatabase } from "../db/connection.js";
import { captureDirection } from "../ask/directions.js";
import { projectDirection } from "../ask/directionState.js";

export function runDirectionCaptureCommand(options: { workspace: string; request: string; requestId?: string; directionTarget: string }) {
  if (!options.requestId?.trim()) throw validationError("Direction capture requires the stable --request-id chosen before submission.");
  let target: unknown;
  try { target = JSON.parse(options.directionTarget); } catch { target = options.directionTarget; }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const direction = withDatabase(workspacePath, db => {
    const receipt = captureDirection(db, { requestId: options.requestId!, content: options.request, target });
    return projectDirection(db, workspacePath, receipt.requestId)!;
  });
  return createSuccess({ command: "ask", workspace: workspacePath, data: { direction } });
}

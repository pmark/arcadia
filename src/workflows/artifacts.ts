import path from "node:path";
import type Database from "better-sqlite3";
import { withDatabase } from "../db/connection.js";
import { createArtifactRecord } from "../db/repositories.js";
import type { WorkflowDefinition, WorkflowRunRecord } from "./types.js";

export function recordWorkflowRunArtifacts(
  workspace: string,
  workflow: WorkflowDefinition,
  run: WorkflowRunRecord,
  recordingPath = run.inputPath
): void {
  withDatabase(workspace, (db) => {
    createIfMissing(db, {
      title: `${workflow.name} source recording`,
      artifactType: "practice_recording",
      status: "ready",
      path: recordingPath
    });
    for (const file of run.files) {
      createIfMissing(db, {
        title: path.basename(file.destinationPath),
        artifactType: "practice_song_mp3",
        status: "published",
        path: file.destinationPath
      });
    }
    for (const logPath of [run.stdoutLogPath, run.stderrLogPath, run.runManifestPath].filter(
      (value): value is string => Boolean(value)
    )) {
      createIfMissing(db, {
        title: `${workflow.name} ${path.basename(logPath)}`,
        artifactType: path.basename(logPath) === "run.json" ? "workflow_run" : "workflow_log",
        status: "ready",
        path: logPath
      });
    }
  });
}

function createIfMissing(
  db: Database.Database,
  input: Parameters<typeof createArtifactRecord>[1]
): void {
  const exists = db.prepare("SELECT 1 FROM artifacts WHERE path = ? LIMIT 1").get(input.path) as { 1: number } | undefined;
  if (!exists) createArtifactRecord(db, input);
}

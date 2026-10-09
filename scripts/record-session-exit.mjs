#!/usr/bin/env node
// Records one managed Session's provider exit code.
//
// The recording shell wrapper (`wrapRecordedLaunch` in
// src/sessions/sessionRecording.ts) runs this after the provider process
// ends, so `agent_sessions.exit_status` holds the real exit code for every
// provider, not only the fixture. It writes the exit code and the exit time
// (`ended_at`, which reconciliation keeps) and nothing else;
// the Session's status stays with reconciliation.
//
//   node record-session-exit.mjs --db <sqlite file> --session-id <id> --exit-status <int>

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Expected a --flag, got "${key}".`);
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db;
  const sessionId = args["session-id"];
  const exitStatus = Number(args["exit-status"]);
  if (!dbPath || !sessionId || !Number.isInteger(exitStatus)) {
    throw new Error("Usage: record-session-exit.mjs --db <file> --session-id <id> --exit-status <integer>.");
  }
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 15000");
    const result = db
      .prepare("UPDATE agent_sessions SET exit_status = ?, ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?")
      .run(exitStatus, new Date().toISOString(), new Date().toISOString(), sessionId);
    if (result.changes !== 1) throw new Error(`No Session ${sessionId} to record exit status ${exitStatus} for.`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

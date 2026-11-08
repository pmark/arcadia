import type Database from "better-sqlite3";
import { buildCapsule, capsuleDrift, hashSnapshotFile, readCapsuleFile, type Capsule, type CapsuleSources } from "./capsule.js";
import { listGenerations, recordVerifyPass } from "./generations.js";
import { coordinatorPaths } from "./paths.js";
import { JOURNAL_STALE_MS, readCoordinatorState } from "./state.js";

export interface VerifyItem { id: number; passed: boolean; required: boolean; detail: string }
export interface VerifyResult {
  generation: number;
  snapshotSha: string | null;
  passed: boolean;
  items: VerifyItem[];
  drift: Array<{ field: string; snapshot: unknown; now: unknown }>;
  journal: Array<{ at: string; text: string; ageMinutes: number; stale: boolean }>;
  lostApprovals: Array<{ at: string; text: string }>;
  nextMove: string | null;
}

/** A next move names a command when its first word looks like an executable or script path. */
const NAMES_A_COMMAND = /^[A-Za-z./~][\w./~-]*(\s|$)/;

/**
 * `arcadia coordinator verify --generation N` (design section f). Deterministic
 * and read-only toward custody: its only write is the pass receipt that
 * `accept` requires. It exits 0 only when items 1 to 3 pass; items 4 to 6 are
 * warnings the successor reports in its first message.
 */
export function verifyGeneration(
  db: Database.Database,
  workspace: string,
  input: { project: string; role: string; generation: number; snapshotSha?: string; sources: CapsuleSources; now: Date }
): VerifyResult {
  const paths = coordinatorPaths(workspace, input.project, input.role);
  const rows = listGenerations(db, input.project, input.role);
  const row = rows.find((candidate) => candidate.generation === input.generation) ?? null;
  const newest = rows.at(-1)?.generation ?? null;
  const items: VerifyItem[] = [];

  const fileSha = hashSnapshotFile(row?.snapshotPath ?? null);
  const shaProblems: string[] = [];
  if (!row) shaProblems.push(`generation ${input.generation} is not recorded`);
  else {
    if (row.status !== "launching") shaProblems.push(`generation ${input.generation} is ${row.status}, not launching`);
    if (newest !== row.generation) shaProblems.push(`generation ${newest} is newer`);
    if (fileSha === null) shaProblems.push("its snapshot file is missing or unreadable");
    else if (fileSha !== row.snapshotSha) shaProblems.push("its snapshot file does not hash to the recorded sha");
    if (input.snapshotSha && input.snapshotSha !== row.snapshotSha) shaProblems.push("the prompt's sha does not match the recorded snapshot");
  }
  items.push({ id: 1, required: true, passed: shaProblems.length === 0, detail: shaProblems.length === 0 ? `snapshot ${row?.snapshotSha} matches and generation ${input.generation} is the newest launching row` : shaProblems.join("; ") });

  let snapshot: Capsule | null = null;
  if (row?.snapshotPath && fileSha !== null && fileSha === row.snapshotSha) snapshot = readCapsuleFile(row.snapshotPath);

  const state = readCoordinatorState(paths);
  let drift: VerifyResult["drift"] = [];
  if (snapshot) {
    const current = buildCapsule({
      project: input.project, role: input.role, generation: input.generation, custodian: snapshot.custodian,
      assignment: snapshot.assignment, state, sources: input.sources, now: input.now
    });
    drift = capsuleDrift(snapshot, current);
    items.push({ id: 2, required: true, passed: true, detail: drift.length === 0 ? "no relay-owned field changed during the handoff" : `${drift.length} relay-owned field(s) changed during the handoff (expected; listed)` });
  } else {
    items.push({ id: 2, required: true, passed: false, detail: "cannot re-derive without a matching snapshot" });
  }

  const unarmed = (snapshot?.subscriptions ?? []).filter((wanted) => !state.subscriptions.some((have) =>
    have.command === wanted.command && !have.inherited && have.armedByGeneration === input.generation && Date.parse(have.armedAt) >= Date.parse(snapshot!.observedAt)));
  items.push({
    id: 3, required: true, passed: snapshot !== null && unarmed.length === 0,
    detail: snapshot === null ? "no matching snapshot"
      : unarmed.length === 0 ? `${snapshot.subscriptions.length} subscription(s) armed by generation ${input.generation}`
        : `not armed by generation ${input.generation}: ${unarmed.map((subscription) => subscription.command).join(", ")}; run each watcher yourself in the background, then register it with arcadia coordinator subscribe "<command>" --cursor <c> (subscribe --from-snapshot only records it as inherited)`
  });

  const journal = (snapshot?.journal ?? []).map((entry) => {
    const ageMinutes = Math.round((input.now.getTime() - Date.parse(entry.at)) / 60_000);
    return { at: entry.at, text: entry.text, ageMinutes, stale: input.now.getTime() - Date.parse(entry.at) > JOURNAL_STALE_MS };
  });
  items.push({ id: 4, required: false, passed: journal.every((entry) => !entry.stale), detail: `${journal.length} journal entr${journal.length === 1 ? "y" : "ies"}, ${journal.filter((entry) => entry.stale).length} stale (older than 2 hours)` });
  const lostApprovals = (snapshot?.approvals.chat_only ?? []).map((approval) => ({ at: approval.at, text: approval.text }));
  items.push({ id: 5, required: false, passed: lostApprovals.length === 0, detail: lostApprovals.length === 0 ? "no chat-only approval was lost" : `${lostApprovals.length} chat-only approval(s) did not carry` });
  const nextMove = snapshot?.next_move?.text ?? null;
  items.push({ id: 6, required: false, passed: nextMove !== null && NAMES_A_COMMAND.test(nextMove), detail: nextMove === null ? "no next_move was handed over" : NAMES_A_COMMAND.test(nextMove) ? `next_move: ${nextMove}` : `next_move does not name a command: ${nextMove}` });

  const passed = items.filter((item) => item.id <= 3).every((item) => item.passed);
  if (passed && row?.snapshotSha) recordVerifyPass(db, input.project, input.role, input.generation, row.snapshotSha, input.now);
  return { generation: input.generation, snapshotSha: row?.snapshotSha ?? null, passed, items, drift, journal, lostApprovals, nextMove };
}

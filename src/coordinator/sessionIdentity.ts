import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ArcadiaError } from "../cli/errors.js";
import type { CoordinatorPaths } from "./paths.js";

/**
 * Verified Session identity for coordinator registration, correction and
 * stand-down (Decision 0227 answer A: "a reviewed remote first-registration and
 * correction route bound to verified Session identity"; handoff design gate 9).
 *
 * The route is a transcript challenge. Step 1 (`--challenge`) prints a one-time
 * nonce. The coordinator's own Claude Code Session receives that command's
 * output, so Claude Code writes the nonce into that Session's transcript
 * (`~/.claude/projects/<slug>/<session id>.jsonl`) as a tool result. Step 2
 * (`--confirm <nonce> --session-id <id>`) finds that transcript, requires the
 * nonce in it, that the transcript is live (written within TRANSCRIPT_FRESH_MS)
 * and takes the provider and model from the transcript itself, never from the
 * caller. A caller therefore cannot name a Session it is not running in, or a
 * model it is not running.
 *
 * Not a cryptographic bind: the transcript directory is the invoking user's own
 * files, and an agent that can write there (or that is handed the nonce by
 * another Session) could forge it. It closes the "any caller creates a custodian
 * for any role" hole, not a determined local forger. Tier and identity label are
 * declared by the caller, and checked only for shape.
 */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const TRANSCRIPT_FRESH_MS = 10 * 60 * 1000;
/** The nonce is emitted moments before confirmation, so only the end of the transcript is read. */
const TRANSCRIPT_TAIL_BYTES = 16 * 1024 * 1024;

export type ChallengePurpose = "register" | "correct" | "stand-down";
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface VerifiedSession { sessionId: string; provider: "claude"; model: string; transcriptPath: string; verifiedAt: string }

interface ChallengeFile { nonce: string; purpose: ChallengePurpose; issuedAt: string; expiresAt: string }

function refused(message: string, reason: string): ArcadiaError {
  return new ArcadiaError("VALIDATION_ERROR", message, 2, { reason });
}

function challengeFile(paths: CoordinatorPaths): string {
  return path.join(paths.root, "session-challenge.json");
}

/** Issues one nonce for this role, replacing any earlier one. Callers hold the relay lock. */
export function issueSessionChallenge(paths: CoordinatorPaths, input: { purpose: ChallengePurpose; now: Date }): { nonce: string; expiresAt: string } {
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  const challenge: ChallengeFile = {
    nonce: `arcadia-session-challenge-${randomBytes(12).toString("hex")}`,
    purpose: input.purpose,
    issuedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + CHALLENGE_TTL_MS).toISOString()
  };
  const file = challengeFile(paths);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(challenge)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
  return { nonce: challenge.nonce, expiresAt: challenge.expiresAt };
}

function readTail(file: string): string {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    return size > length ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

/** The transcript file for a session id, found by name under Claude Code's projects directory. */
export function findSessionTranscript(projectsDirectory: string, sessionId: string): string | null {
  if (!SESSION_ID.test(sessionId) || !existsSync(projectsDirectory)) return null;
  for (const entry of readdirSync(projectsDirectory)) {
    const candidate = path.join(projectsDirectory, entry, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Confirms the challenge: the session's transcript carries the nonce (as a
 * `user` entry, where a tool result is written), is live, and names the model
 * that is answering. Consumes the challenge on success only. Callers hold the
 * relay lock.
 */
export function confirmSessionChallenge(
  paths: CoordinatorPaths,
  input: { purpose: ChallengePurpose; nonce: string; sessionId: string; projectsDirectory: string; now: Date }
): VerifiedSession {
  const file = challengeFile(paths);
  let challenge: ChallengeFile;
  try {
    challenge = JSON.parse(readFileSync(file, "utf8")) as ChallengeFile;
  } catch {
    throw refused("No session challenge is pending for this role; run the same command with --challenge first.", "challenge_missing");
  }
  if (challenge.purpose !== input.purpose) throw refused(`The pending challenge was issued for ${challenge.purpose}, not ${input.purpose}; run --challenge again.`, "challenge_purpose");
  if (challenge.nonce !== input.nonce) throw refused("The nonce does not match the pending challenge.", "challenge_mismatch");
  if (input.now.getTime() > Date.parse(challenge.expiresAt)) throw refused("The session challenge expired; run --challenge again.", "challenge_expired");
  if (!SESSION_ID.test(input.sessionId)) throw refused("--session-id must be a session UUID.", "session_id_shape");
  const transcript = findSessionTranscript(input.projectsDirectory, input.sessionId);
  if (transcript === null) throw refused(`No transcript for session ${input.sessionId} was found; the Session is not a Claude Code Session on this host.`, "session_transcript_missing");
  const modifiedMs = statSync(transcript).mtimeMs;
  if (input.now.getTime() - modifiedMs > TRANSCRIPT_FRESH_MS) throw refused(`The transcript of session ${input.sessionId} was last written more than ${TRANSCRIPT_FRESH_MS / 60_000} minutes ago; only a live Session can be verified.`, "session_not_live");
  let nonceSeen = false;
  let model: string | null = null;
  for (const line of readTail(transcript).split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: string; sessionId?: string; isSidechain?: boolean; message?: { model?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.sessionId !== undefined && entry.sessionId !== input.sessionId) throw refused(`The transcript names session ${String(entry.sessionId)}, not ${input.sessionId}.`, "session_id_mismatch");
    if (entry.isSidechain) continue;
    if (entry.type === "user" && line.includes(input.nonce)) nonceSeen = true;
    if (entry.type === "assistant" && typeof entry.message?.model === "string" && !entry.message.model.startsWith("<")) model = entry.message.model;
  }
  if (!nonceSeen) throw refused(`The nonce is not in session ${input.sessionId}'s transcript: run the --challenge command in that Session, not elsewhere, and confirm with that Session's id.`, "nonce_not_in_transcript");
  if (model === null) throw refused(`Session ${input.sessionId}'s transcript names no model yet; its provider and model cannot be verified.`, "model_unverified");
  try { unlinkSync(file); } catch { /* single use is best effort; the expiry still bounds it */ }
  return { sessionId: input.sessionId, provider: "claude", model, transcriptPath: transcript, verifiedAt: input.now.toISOString() };
}

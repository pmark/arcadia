import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The deterministic coherence guard of the rehearsal-chain fixture (run 7's
 * Action 1 failed QA on a real "Managed documents" finding: the fixture said
 * "three dependent Actions" while its Action text said "Action 1 of 9").
 *
 * It reads the fixture's managed documents (PROJECT.md, AGENTS.md,
 * CONSTITUTION.md and every Markdown file under docs/, which includes the Plan
 * and so every Action's text) and refuses any statement of how many Actions the
 * chain has, or of the rehearsal's size, that is not the run's N, naming the
 * file, line and text. It reads no Git, GitHub, workspace or clock; the chain
 * reset runs it on the amended tree (real and dry run) and G6 runs it on the
 * fixture head.
 *
 * What it deliberately does not count, because none states the chain's size:
 * Action ids and slugs (`chain-step-04`, `three-action-rehearsal`,
 * `autonomous-three-action-rehearsal`: a digit or number word glued to a
 * hyphen or path is never a count), the genesis check's marker lines (exact
 * quoted strings the check compares MARKER.md with) and the fixture Project's
 * registered name "Three Action Rehearsal" (the identity docs sync matches on).
 */

const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"] as const;
const WORD_VALUE: Record<string, number> = Object.fromEntries(WORDS.map((word, index) => [word, index + 1]));

/** The lower-case English number word for 1..12 ("nine"). */
export function numberWord(count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > WORDS.length) throw new Error(`No number word for ${count}.`);
  return WORDS[count - 1];
}
/** The same word with a capital first letter ("Nine"). */
export const capitalNumberWord = (count: number): string => numberWord(count).charAt(0).toUpperCase() + numberWord(count).slice(1);

/** Exact strings that are identities of the fixture, never statements of the chain's size. */
export const COHERENCE_EXEMPT_LITERALS: readonly string[] = [
  "three-action rehearsal start",
  "THREE-ACTION REHEARSAL START",
  "three-action rehearsal verified",
  "Three Action Rehearsal"
];

const NUMBER = `(?:\\d+|${WORDS.join("|")})`;
const SEPARATOR = "[\\s-]+";
// A count, then up to four modifier words, then Action(s): "three-Action", "three dependent Actions", "9 trivial file-edit Actions".
// Not preceded by a word character, path or hyphen (so ids and run ids never match) and not followed by a hyphen (so slugs never match).
const COUNTED_ACTIONS = new RegExp(`(?<![\\w./-])(${NUMBER})(?:${SEPARATOR}[A-Za-z]+){0,4}?${SEPARATOR}Actions?(?![\\w-])`, "gi");
const COUNTED_SESSIONS = new RegExp(`(?<![\\w./-])(${NUMBER})${SEPARATOR}coding${SEPARATOR}Sessions?(?![\\w-])`, "gi");
const POSITION_OF_TOTAL = new RegExp(`(?<![\\w./-])Actions?\\s+(${NUMBER})\\s+of\\s+(${NUMBER})(?![\\w-])`, "gi");

const valueOf = (token: string): number => /^\d+$/.test(token) ? Number(token) : WORD_VALUE[token.toLowerCase()];

export interface CoherenceFile { path: string; text: string }

/** Every managed document of a fixture tree the guard reads, as repository-relative paths. */
export function coherenceFilePaths(root: string): string[] {
  const found: string[] = [];
  for (const file of ["PROJECT.md", "AGENTS.md", "CONSTITUTION.md"]) if (existsSync(path.join(root, file))) found.push(file);
  const walk = (relative: string) => {
    const directory = path.join(root, relative);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) return;
    for (const entry of readdirSync(directory).sort()) {
      const child = `${relative}/${entry}`;
      const stat = statSync(path.join(root, child));
      if (stat.isDirectory()) walk(child);
      else if (entry.endsWith(".md")) found.push(child);
    }
  };
  walk("docs");
  return found;
}

export function readCoherenceFiles(root: string): CoherenceFile[] {
  return coherenceFilePaths(root).map((file) => ({ path: file, text: readFileSync(path.join(root, file), "utf8") }));
}

/** Replace every exempt literal by spaces of the same length, so offsets, lines and the original text stay intact. */
function maskExempt(text: string): string {
  let masked = text;
  for (const literal of COHERENCE_EXEMPT_LITERALS) masked = masked.split(literal).join(" ".repeat(literal.length));
  return masked;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
const clip = (line: string) => { const trimmed = line.trim(); return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed; };

/**
 * Every statement in the files of a number of Actions or a rehearsal size that
 * is not `actionCount`, each as "<file>:<line>: <what> ... : <line text>"; empty
 * means coherent.
 */
export function chainCoherenceProblems(files: CoherenceFile[], actionCount: number): string[] {
  if (!Number.isInteger(actionCount) || actionCount < 1) throw new Error("The Action count must be a positive whole number.");
  const problems: string[] = [];
  for (const file of files) {
    const lines = file.text.split("\n");
    const masked = maskExempt(file.text);
    const report = (index: number, stated: string, reason: string) => {
      const line = lineOf(masked, index);
      problems.push(`${file.path}:${line}: ${reason} (${JSON.stringify(stated.replace(/\s+/g, " "))}): ${clip(lines[line - 1] ?? "")}`);
    };
    for (const match of masked.matchAll(COUNTED_ACTIONS)) {
      if (valueOf(match[1]) !== actionCount) report(match.index ?? 0, match[0], `states ${valueOf(match[1])} Actions but this run's chain has ${actionCount}`);
    }
    for (const match of masked.matchAll(COUNTED_SESSIONS)) {
      if (valueOf(match[1]) !== actionCount) report(match.index ?? 0, match[0], `states ${valueOf(match[1])} coding Sessions but this run's chain has ${actionCount} Actions`);
    }
    for (const match of masked.matchAll(POSITION_OF_TOTAL)) {
      const position = valueOf(match[1]);
      const total = valueOf(match[2]);
      if (total !== actionCount) report(match.index ?? 0, match[0], `states a total of ${total} Actions but this run's chain has ${actionCount}`);
      else if (position < 1 || position > actionCount) report(match.index ?? 0, match[0], `names Action ${position}, outside this run's chain of ${actionCount}`);
    }
  }
  return problems;
}

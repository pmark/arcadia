import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Way lookup: the smallest passages of the checked-in guidance that answer a
 * question, within a byte budget.
 *
 * Deterministic and model-free: no network, no database, no writes, and no
 * imports beyond node built-ins, so the command starts as fast as Node does.
 * The corpus is a fixed list of files, split into passages at `##` and `###`
 * headings, ranked by BM25 over lightly stemmed tokens, with extra weight for
 * heading words, `keys:` lines and the guidance index's own trigger words.
 */

export const GUIDANCE_INDEX_PATH = "docs/agent-guidance/index.json";

/** Fixed corpus, relative to the Way root. A missing file is skipped silently. */
export const CORPUS_FILES: readonly string[] = [
  "CONSTITUTION.md",
  "AGENTS.md",
  "START_HERE.md",
  "OPERATOR_CONTEXT.md",
  "INSTALL_WITH_A_CODING_AGENT.md",
  "SETUP.md",
  "docs/arcadia-semantics.md",
  "docs/managed-documents.md",
  "docs/planning-process.md",
  "docs/working-copy-safety.md",
  "docs/operating-model.md",
  "docs/COMMANDS.md",
  "docs/operator-demo-and-release-contract.md",
  "docs/managed-production-readiness.md",
  "docs/notes-to-self.md"
];
const GUIDANCE_DIRECTORY = "docs/agent-guidance";
const SKILLS_DIRECTORY = ".agents/skills";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** A question longer than this is cut; terms beyond MAX_QUERY_TERMS are dropped by weight. */
export const MAX_QUESTION_CHARS = 16 * 1024;
const MAX_QUERY_TERMS = 48;

export const DEFAULT_BUDGET_BYTES = 1500;
export const DEFAULT_LIMIT = 3;
export const MAX_LIMIT = 20;

/**
 * The Way "clearly answers" only when the best chunk (1) scores at least
 * `minScore`, (2) holds at least `minCoverage` of the question's content-term
 * weight, where a term found nowhere in the corpus still counts in the total
 * (so one unknown word cannot be ignored), and (3) matches at least
 * `minMatchedTerms` distinct terms, or all of them when the question has fewer,
 * and (4) when the question has a single content term, that term is in the
 * passage's heading. Anything else is "not confident": near addresses are listed, no excerpts.
 */
export const CONFIDENCE = { minScore: 4, minCoverage: 0.6, minMatchedTerms: 2 } as const;

/** Which kind of source a passage comes from, so an answer can weigh it. */
export type SourceClass = "canonical" | "operator_guide" | "hot_cache";

const OPERATOR_GUIDES = new Set(["START_HERE.md", "OPERATOR_CONTEXT.md", "INSTALL_WITH_A_CODING_AGENT.md", "SETUP.md", "docs/COMMANDS.md", "docs/operating-model.md"]);
const HOT_CACHE = new Set(["docs/notes-to-self.md"]);

/** Governing text and procedures are canonical; guides for the operator explain it; lessons are a verified cache that can lag. */
export function sourceClassOf(relative: string): SourceClass {
  if (HOT_CACHE.has(relative)) return "hot_cache";
  if (OPERATOR_GUIDES.has(relative)) return "operator_guide";
  return "canonical";
}

/** A heading that declares its own section out of date. */
const SUPERSEDED_HEADING = /\b(superseded|historical|obsolete|outdated|earlier)\b/i;
/** Text that states a rule with a condition or exception; cutting it can turn the rule into its opposite. */
const RULE_WITH_EXCEPTION = /\b(unless|except|exceptions?|only (?:when|if|under|after)|hard stops?)\b/i;
const RULE_WHOLE_MAX_BYTES = 4000;

export interface Passage {
  /** `path#github-style-slug`; the second and later duplicates in a file take `-1`, `-2` as GitHub does. */
  address: string;
  path: string;
  /** Document title, then `##`, then `###` headings. */
  heading: string[];
  body: string;
  /** First 12 hex characters of the SHA-256 of `body`. */
  sha: string;
  /** The 1-based line of the source file for each line of `body`. */
  lines: number[];
}

export interface LookupHit {
  address: string;
  heading: string;
  excerpt: string;
  /** True when the excerpt is less than the whole passage; read the address for the rest. */
  truncated: boolean;
  sha: string;
  score: number;
  /** 1-based line of the source file where the excerpt starts. */
  line: number;
  sourceClass: SourceClass;
}

export interface LookupOptions {
  budget?: number;
  limit?: number;
  now?: () => number;
}

export interface LookupResult {
  question: string;
  results: LookupHit[];
  confident: boolean;
  /** The Way does not clearly answer: true when `confident` is false, even if near matches are listed. */
  nearest: Array<{ address: string; heading: string; score: number }>;
  passagesScanned: number;
  filesScanned: number;
  /** Headed sections left out because they sit inside `<details>` or declare themselves superseded or historical. */
  supersededSkipped: number;
  /** Size in bytes of the largest passage, to show how coarse the addresses are. */
  largestPassageBytes: number;
  elapsedMs: number;
  budget: number;
  limit: number;
  excerptBytes: number;
  warnings: string[];
}

export interface WayRoot {
  root: string;
  source: "project" | "package";
}

// ---------------------------------------------------------------------------
// Way root

function holdsGuidance(directory: string): boolean {
  try {
    return lstatSync(path.join(directory, GUIDANCE_INDEX_PATH)).isFile();
  } catch {
    return false;
  }
}

/** The enclosing Project when it carries the guidance index, otherwise Arcadia's own package root, otherwise null. */
export function resolveWayRoot(input: { projectRoot: string | null; moduleUrl: string }): WayRoot | null {
  if (input.projectRoot && holdsGuidance(input.projectRoot)) return { root: path.resolve(input.projectRoot), source: "project" };
  let directory = path.dirname(fileURLToPath(input.moduleUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    if (holdsGuidance(directory)) return { root: directory, source: "package" };
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Corpus

function listNames(directory: string): string[] {
  try {
    return readdirSync(directory).sort();
  } catch {
    return [];
  }
}

/** Relative corpus paths that exist as plain files under `root`, in a stable order. */
export function corpusPaths(root: string): string[] {
  const candidates: string[] = [...CORPUS_FILES];
  for (const name of listNames(path.join(root, GUIDANCE_DIRECTORY))) {
    if (name.endsWith(".md")) candidates.push(`${GUIDANCE_DIRECTORY}/${name}`);
  }
  for (const name of listNames(path.join(root, SKILLS_DIRECTORY))) candidates.push(`${SKILLS_DIRECTORY}/${name}/SKILL.md`);
  return [...new Set(candidates)].sort();
}

/**
 * The text of one corpus file, or null. A symlink is never followed, nor is a
 * file whose real path leaves the root (a directory component can be a link
 * too). Invalid UTF-8 decodes to replacement characters instead of failing.
 */
export function readCorpusFile(realRoot: string, relative: string): string | null {
  try {
    const absolute = path.join(realRoot, relative);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return null;
    const actual = realpathSync(absolute);
    if (actual !== absolute && !actual.startsWith(`${realRoot}${path.sep}`)) return null;
    if (!actual.startsWith(`${realRoot}${path.sep}`)) return null;
    return new TextDecoder("utf-8").decode(readFileSync(actual)).replaceAll("\r\n", "\n").replaceAll("\0", "");
  } catch {
    return null;
  }
}

/** GitHub-style heading slug: lowercase, links reduced to their text, punctuation dropped, spaces to hyphens. */
export function slugify(heading: string): string {
  const slug = heading
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .trim()
    .replaceAll(/\s/g, "-");
  return slug || "section";
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Heading text with inline emphasis and code marks removed, for display and matching. */
function plainHeading(text: string): string {
  return text.replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1").replaceAll(/[`*]/g, "").trim();
}

function shaOf(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

const DETAILS_OPEN = /<details[\s>]/gi;
const DETAILS_CLOSE = /<\/details\s*>/gi;

/**
 * Split one document at `##` and `###` headings, ignoring headings inside code
 * fences (an unterminated fence runs to the end of the file). Text before the
 * first such heading belongs to the document title. Passages with an empty
 * body are dropped, but still take their slug so later duplicates keep GitHub's
 * numbering.
 *
 * Superseded text is left out, not ranked down: everything inside `<details>`
 * (the Way collapses retired derivations that way), any section whose heading
 * says superseded, historical, obsolete, outdated or earlier, and the `###` sections
 * below such a `##`. They still claim their slugs, and `skipped` counts them.
 */
export function splitDocument(relative: string, text: string): { passages: Passage[]; skipped: number } {
  interface Segment { level: 1 | 2 | 3; raw: string; text: string; hidden: boolean; lines: string[]; nos: number[] }
  const segments: Segment[] = [{ level: 1, raw: "", text: "", hidden: false, lines: [], nos: [] }];
  let titled = false;
  let fence: { marker: string; length: number } | null = null;
  let depth = 0;
  let h2Hidden = false;
  text.split("\n").forEach((line, offset) => {
    const number = offset + 1;
    const last = segments[segments.length - 1];
    const fenceMatch = FENCE.exec(line);
    const insideDetails = depth > 0;
    if (!fence) {
      const opens = line.match(DETAILS_OPEN)?.length ?? 0;
      const closes = line.match(DETAILS_CLOSE)?.length ?? 0;
      depth = Math.max(0, depth + opens - closes);
      if (opens > 0) {
        if (!last.hidden && !insideDetails) return;
      }
    }
    const hiddenContent = insideDetails || last.hidden;
    const keep = (): void => {
      if (hiddenContent) return;
      last.lines.push(line);
      last.nos.push(number);
    };
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) fence = null;
      keep();
      return;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      keep();
      return;
    }
    const heading = HEADING.exec(line);
    if (!heading) {
      keep();
    } else if (heading[1].length === 1) {
      // The first H1 before any `##` names the document and leaves the body; any later H1 is plain text.
      if (!titled && segments.length === 1 && !insideDetails) {
        titled = true;
        last.raw = heading[2];
        last.text = plainHeading(heading[2]);
      } else keep();
    } else {
      const level = heading[1].length as 2 | 3;
      const headingText = plainHeading(heading[2]);
      const marked = SUPERSEDED_HEADING.test(headingText);
      const hidden = insideDetails || marked || (level === 3 && h2Hidden);
      if (level === 2) h2Hidden = insideDetails || marked;
      segments.push({ level, raw: heading[2], text: headingText, hidden, lines: [], nos: [] });
    }
  });

  const fallback = path.posix.basename(relative).replace(/\.md$/i, "");
  const title = segments[0].text || fallback;
  const slugCount = new Map<string, number>();
  const claimSlug = (source: string): string => {
    const base = slugify(source);
    const seen = slugCount.get(base) ?? 0;
    slugCount.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  };
  const passages: Passage[] = [];
  let skipped = 0;
  let h2 = "";
  segments.forEach((segment, position) => {
    // Only a document with an H1 (or text before its first heading) has an anchor for its title.
    const hasAnchor = position > 0 || titled || segment.lines.some((line) => line.trim());
    const slug = hasAnchor ? claimSlug(position === 0 ? segment.raw || fallback : segment.raw) : "";
    if (segment.hidden) {
      skipped += 1;
      return;
    }
    let heading: string[];
    if (position === 0) heading = [title];
    else if (segment.level === 2) {
      h2 = segment.text;
      heading = [title, segment.text];
    } else heading = h2 ? [title, h2, segment.text] : [title, segment.text];
    let first = 0;
    while (first < segment.lines.length && !segment.lines[first].trim()) first += 1;
    let end = segment.lines.length;
    while (end > first && !segment.lines[end - 1].trim()) end -= 1;
    const lines = segment.lines.slice(first, end);
    if (lines.length === 0) return;
    const body = lines.join("\n").replace(/\s+$/, "");
    passages.push({ address: `${relative}#${slug}`, path: relative, heading, body, sha: shaOf(body), lines: segment.nos.slice(first, end) });
  });
  return { passages, skipped };
}

export function splitPassages(relative: string, text: string): Passage[] {
  return splitDocument(relative, text).passages;
}

// ---------------------------------------------------------------------------
// Tokens

const STOPWORDS = new Set(
  ("a an the is are was were be been being do does did done i me my we our you your it its of to in on for with and or but not no " +
    "what how can could will would should shall may might if at by from as this that these those there their them they then than so " +
    "about into out up over any all some which who whom when where why have has had get got also just only very more most much " +
    "one two use used using between ever thing things something anything everything someone right now difference differences immediately quickly currently actually really please").split(" ")
);

const stemCache = new Map<string, string>();

/** Light, deterministic suffix stemming: enough to equate stop/stopping/stopped and decision/decisions. */
export function stem(word: string): string {
  const cached = stemCache.get(word);
  if (cached !== undefined) return cached;
  let value = word;
  if (value.length > 4 && value.endsWith("ies")) value = `${value.slice(0, -3)}y`;
  else if (value.length > 5 && value.endsWith("sses")) value = value.slice(0, -2);
  else if (value.length > 5 && value.endsWith("ing")) value = undouble(value.slice(0, -3));
  else if (value.length > 4 && value.endsWith("ed")) value = undouble(value.slice(0, -2));
  else if (value.length > 4 && /(?:s|x|z|ch|sh)es$/.test(value)) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith("s") && !/(?:ss|us|is)$/.test(value)) value = value.slice(0, -1);
  if (value.length > 3 && value.endsWith("e")) value = value.slice(0, -1);
  if (stemCache.size > 50_000) stemCache.clear();
  stemCache.set(word, value);
  return value;
}

function undouble(value: string): string {
  return /([^aeiouls])\1$/.test(value) ? value.slice(0, -1) : value;
}

/** Lowercased stems, stopwords and one-character tokens removed. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    tokens.push(stem(raw));
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Units and chunks

const encoder = new TextEncoder();
function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** The smallest piece an excerpt is made from: a paragraph, a list item, or a sentence of an oversized one. `line` is an index into the passage body. */
interface Unit { text: string; joiner: string; bytes: number; line: number }

const CHUNK_TARGET_BYTES = 500;
const CHUNK_MAX_BYTES = 1100;
/** A whole passage up to this size is returned entire rather than as its best chunk. */
const WHOLE_PASSAGE_BYTES = 900;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

function paragraphsOf(body: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let current: string[] = [];
  let start = 0;
  let fence: string | null = null;
  body.split("\n").forEach((line, index) => {
    const match = FENCE.exec(line);
    if (match && !fence) fence = match[1][0];
    else if (match && fence && match[1][0] === fence && line.trim() === match[1]) fence = null;
    if (!fence && !line.trim()) {
      if (current.length) out.push({ text: current.join("\n"), line: start });
      current = [];
      return;
    }
    if (current.length === 0) start = index;
    current.push(line);
  });
  if (current.length) out.push({ text: current.join("\n"), line: start });
  return out;
}

/** Splits oversized prose at list items, then at sentence ends; code and short text stay whole. */
function splitOversized(text: string, line: number): Array<{ text: string; joiner: string; line: number }> {
  const items: Array<{ text: string; line: number }> = [];
  text.split("\n").forEach((row, index) => {
    if (LIST_ITEM.test(row) || items.length === 0) items.push({ text: row, line: line + index });
    else items[items.length - 1].text += `\n${row}`;
  });
  const pieces: Array<{ text: string; joiner: string; line: number }> = [];
  for (const item of items) {
    if (byteLength(item.text) <= CHUNK_MAX_BYTES) {
      pieces.push({ text: item.text, joiner: "\n", line: item.line });
      continue;
    }
    let cursor = 0;
    item.text.split(/(?<=[.!?])\s+/).filter((piece) => piece.trim()).forEach((sentence, position) => {
      const at = item.text.indexOf(sentence, cursor);
      cursor = at + sentence.length;
      const breaks = item.text.slice(0, Math.max(at, 0)).split("\n").length - 1;
      pieces.push({ text: sentence, joiner: position === 0 ? "\n" : " ", line: item.line + breaks });
    });
  }
  return pieces;
}

/** Units of a passage body. */
export function toUnits(body: string): Unit[] {
  const units: Unit[] = [];
  for (const paragraph of paragraphsOf(body)) {
    const bytes = byteLength(paragraph.text);
    const joiner = units.length === 0 ? "" : "\n\n";
    if (bytes <= CHUNK_MAX_BYTES || paragraph.text.includes("\n```") || paragraph.text.startsWith("```")) {
      units.push({ text: paragraph.text, joiner, bytes, line: paragraph.line });
      continue;
    }
    splitOversized(paragraph.text, paragraph.line).forEach((piece, position) =>
      units.push({ text: piece.text, joiner: position === 0 ? joiner : piece.joiner, bytes: byteLength(piece.text), line: piece.line })
    );
  }
  return units;
}

function joinUnits(units: Unit[], from: number, to: number): string {
  let out = "";
  for (let index = from; index <= to; index += 1) out += (index === from ? "" : units[index].joiner) + units[index].text;
  return out;
}

/** Contiguous runs of units of roughly CHUNK_TARGET_BYTES, never more than CHUNK_MAX_BYTES unless one unit is larger. */
export function chunkRanges(units: Unit[]): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let from = 0;
  let size = 0;
  for (let index = 0; index < units.length; index += 1) {
    const add = units[index].bytes + (index === from ? 0 : units[index].joiner.length);
    if (index > from && (size >= CHUNK_TARGET_BYTES || size + add > CHUNK_MAX_BYTES)) {
      ranges.push({ from, to: index - 1 });
      from = index;
      size = 0;
    }
    size += index === from ? units[index].bytes : add;
  }
  if (units.length) ranges.push({ from, to: units.length - 1 });
  return ranges;
}

// ---------------------------------------------------------------------------
// Index and scoring

interface IndexedPassage {
  passage: Passage;
  units: Unit[];
  /** Stemmed words of the heading chain. */
  headingTerms: Set<string>;
}
interface Chunk {
  passageIndex: number;
  from: number;
  to: number;
  length: number;
  terms: Map<string, number>;
}

export interface WayIndex {
  passages: IndexedPassage[];
  chunks: Chunk[];
  postings: Map<string, Array<[number, number]>>;
  averageLength: number;
  filesScanned: number;
}

const WEIGHT = { heading: 3, parentHeading: 1, path: 1, keys: 3 } as const;

function addTerms(terms: Map<string, number>, tokens: string[], weight: number): void {
  for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + weight);
}

function keysLines(body: string): string {
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    const match = /^keys:\s*(.+)$/i.exec(line);
    if (match) lines.push(match[1]);
  }
  return lines.join(" ");
}

export function buildIndex(passages: Passage[], filesScanned: number): WayIndex {
  const indexed: IndexedPassage[] = [];
  const chunks: Chunk[] = [];
  const postings = new Map<string, Array<[number, number]>>();
  let total = 0;
  for (const passage of passages) {
    const units = toUnits(passage.body);
    const passageIndex = indexed.length;
    indexed.push({ passage, units, headingTerms: new Set(tokenize(passage.heading.join(" "))) });
    // Fields shared by every chunk of the passage: its heading chain, path and any `keys:` line.
    const shared = new Map<string, number>();
    addTerms(shared, tokenize(passage.heading[passage.heading.length - 1]), WEIGHT.heading);
    addTerms(shared, tokenize(passage.heading.slice(0, -1).join(" ")), WEIGHT.parentHeading);
    addTerms(shared, tokenize(passage.path.replaceAll(/\.md$/g, "").replaceAll(/[/_.-]/g, " ")), WEIGHT.path);
    addTerms(shared, tokenize(keysLines(passage.body)), WEIGHT.keys);
    for (const range of chunkRanges(units)) {
      const terms = new Map(shared);
      addTerms(terms, tokenize(joinUnits(units, range.from, range.to)), 1);
      let length = 0;
      for (const count of terms.values()) length += count;
      const chunkIndex = chunks.length;
      chunks.push({ passageIndex, from: range.from, to: range.to, length, terms });
      total += length;
      for (const [term, count] of terms) {
        const list = postings.get(term);
        if (list) list.push([chunkIndex, count]);
        else postings.set(term, [[chunkIndex, count]]);
      }
    }
  }
  return { passages: indexed, chunks, postings, averageLength: chunks.length ? total / chunks.length : 1, filesScanned };
}

export interface TriggerEntry { path: string; triggers: string[][] }

/** `entries` of the guidance index, reduced to stemmed trigger phrases. Unreadable or malformed input gives none. */
export function parseTriggers(indexText: string | null): TriggerEntry[] {
  if (!indexText) return [];
  try {
    const parsed = JSON.parse(indexText) as { entries?: Array<{ path?: unknown; trigger?: unknown }> };
    const entries: TriggerEntry[] = [];
    for (const entry of Array.isArray(parsed.entries) ? parsed.entries : []) {
      if (typeof entry?.path !== "string" || typeof entry.trigger !== "string") continue;
      const triggers = entry.trigger.split(",").map((phrase) => tokenize(phrase)).filter((phrase) => phrase.length > 0);
      entries.push({ path: entry.path, triggers });
    }
    return entries;
  } catch {
    return [];
  }
}

const K1 = 1.2;
const B = 0.75;
const TRIGGER_BOOST = 1.2;

export interface RankedPassage {
  passageIndex: number;
  /** Chunk of the passage that scored best. */
  chunkIndex: number;
  score: number;
  /** Share of the question's term weight found in the best chunk, 0 to 1. */
  coverage: number;
  /** How many distinct question terms the best chunk holds. */
  matchedTerms: number;
  /** How many question terms appear in the passage's heading chain. */
  headingTerms: number;
}

function matchingTriggerPaths(triggers: TriggerEntry[], questionTerms: Set<string>): Set<string> {
  const paths = new Set<string>();
  for (const entry of triggers) {
    for (const phrase of entry.triggers) {
      const usable = phrase.length > 1 || phrase[0].length >= 3;
      if (usable && phrase.every((term) => questionTerms.has(term))) {
        paths.add(entry.path);
        break;
      }
    }
  }
  return paths;
}

/**
 * Rank passages for a question by their best chunk. A chunk's score is BM25
 * over weighted fields (body, heading, parent headings, path, `keys:`),
 * scaled by how much of the question's weight the chunk covers, then raised
 * for files whose guidance-index trigger matches. Ties break by address.
 */
export function rank(index: WayIndex, question: string, triggers: TriggerEntry[] = []): { ranked: RankedPassage[]; terms: string[] } {
  const chunkCount = index.chunks.length;
  const distinct = [...new Set(tokenize(question.slice(0, MAX_QUESTION_CHARS)))];
  const idf = (term: string): number => {
    const frequency = index.postings.get(term)?.length ?? 0;
    return Math.log(1 + (chunkCount - frequency + 0.5) / (frequency + 0.5));
  };
  const weighted = distinct.map((term) => ({ term, idf: idf(term) })).sort((a, b) => b.idf - a.idf || (a.term < b.term ? -1 : 1)).slice(0, MAX_QUERY_TERMS);
  const totalIdf = weighted.reduce((sum, item) => sum + item.idf, 0);
  const sums = new Map<number, { score: number; matched: number; terms: number }>();
  for (const { term, idf: weight } of weighted) {
    for (const [chunkIndex, frequency] of index.postings.get(term) ?? []) {
      const length = index.chunks[chunkIndex].length;
      const part = (weight * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / index.averageLength));
      const entry = sums.get(chunkIndex) ?? { score: 0, matched: 0, terms: 0 };
      entry.score += part;
      entry.matched += weight;
      entry.terms += 1;
      sums.set(chunkIndex, entry);
    }
  }
  const boosted = matchingTriggerPaths(triggers, new Set(distinct));
  const best = new Map<number, RankedPassage>();
  for (const [chunkIndex, entry] of sums) {
    const chunk = index.chunks[chunkIndex];
    const coverage = totalIdf > 0 ? entry.matched / totalIdf : 0;
    let score = entry.score * (0.4 + 0.6 * coverage);
    if (boosted.has(index.passages[chunk.passageIndex].passage.path)) score *= TRIGGER_BOOST;
    const current = best.get(chunk.passageIndex);
    if (!current || score > current.score || (score === current.score && chunkIndex < current.chunkIndex)) {
      const headingTerms = weighted.filter((item) => index.passages[chunk.passageIndex].headingTerms.has(item.term)).length;
      best.set(chunk.passageIndex, { passageIndex: chunk.passageIndex, chunkIndex, score, coverage, matchedTerms: entry.terms, headingTerms });
    }
  }
  const ranked = [...best.values()].sort(
    (a, b) => b.score - a.score || (index.passages[a.passageIndex].passage.address < index.passages[b.passageIndex].passage.address ? -1 : 1)
  );
  return { ranked, terms: weighted.map((item) => item.term) };
}

// ---------------------------------------------------------------------------
// Excerpts

/** Cut `text` to at most `maxBytes` UTF-8 bytes on a code point boundary, with an ellipsis when cut. */
function cutToBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const ellipsis = "…";
  const room = maxBytes - byteLength(ellipsis);
  if (room <= 0) return "";
  let out = "";
  let used = 0;
  for (const character of text) {
    const size = byteLength(character);
    if (used + size > room) break;
    out += character;
    used += size;
  }
  return `${out.trimEnd()}${ellipsis}`;
}

function unitScore(text: string, terms: Set<string>): number {
  const seen = new Set<string>();
  let occurrences = 0;
  for (const token of tokenize(text)) {
    if (terms.has(token)) {
      seen.add(token);
      occurrences += 1;
    }
  }
  return seen.size + occurrences / 100;
}

/**
 * The excerpt of one ranked passage. Text that states a rule with an exception
 * (and everything in CONSTITUTION.md) is returned whole when it fits, since a
 * fragment of it can read as the opposite rule; when it does not fit, the
 * excerpt is marked truncated and the address is the way to the rest. Other
 * passages return the whole body when small, otherwise the best chunk, shrunk
 * to the best-matching run of units (or the best sentence, cut) to fit
 * `maxBytes`. `line` is where the excerpt starts in the source file.
 */
export function excerptOf(
  entry: IndexedPassage,
  chunk: { from: number; to: number },
  queryTerms: Set<string>,
  maxBytes: number
): { excerpt: string; truncated: boolean; line: number } {
  const { passage, units } = entry;
  const firstLine = passage.lines[0] ?? 1;
  const bodyBytes = byteLength(passage.body);
  const ruleBearing = passage.path === "CONSTITUTION.md" || RULE_WITH_EXCEPTION.test(passage.body);
  const wholeLimit = ruleBearing ? RULE_WHOLE_MAX_BYTES : WHOLE_PASSAGE_BYTES;
  if (bodyBytes <= maxBytes && bodyBytes <= wholeLimit) return { excerpt: passage.body, truncated: false, line: firstLine };
  if (maxBytes <= 0 || units.length === 0) return { excerpt: "", truncated: true, line: firstLine };
  const lineOf = (unit: number): number => passage.lines[units[unit].line] ?? firstLine;
  let { from, to } = chunk;
  const fits = (low: number, high: number): boolean => byteLength(joinUnits(units, low, high)) <= maxBytes;
  if (!fits(from, to)) {
    const scores = units.map((unit, position) => (position >= from && position <= to ? unitScore(unit.text, queryTerms) : -1));
    let best = from;
    for (let position = from; position <= to; position += 1) if (scores[position] > scores[best]) best = position;
    if (units[best].bytes > maxBytes) return { excerpt: cutToBytes(units[best].text, maxBytes), truncated: true, line: lineOf(best) };
    from = best;
    to = best;
    for (;;) {
      const next = to + 1 <= chunk.to && fits(from, to + 1) ? scores[to + 1] : -1;
      const previous = from - 1 >= chunk.from && fits(from - 1, to) ? scores[from - 1] : -1;
      if (next < 0 && previous < 0) break;
      if (next >= previous) to += 1;
      else from -= 1;
    }
  }
  const excerpt = joinUnits(units, from, to);
  return { excerpt, truncated: excerpt !== passage.body, line: lineOf(from) };
}

// ---------------------------------------------------------------------------
// Lookup

export function loadPassages(root: string): { passages: Passage[]; filesScanned: number; skipped: number; indexText: string | null } {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { passages: [], filesScanned: 0, skipped: 0, indexText: null };
  }
  const passages: Passage[] = [];
  let filesScanned = 0;
  let skipped = 0;
  for (const relative of corpusPaths(realRoot)) {
    const text = readCorpusFile(realRoot, relative);
    if (text === null) continue;
    filesScanned += 1;
    const document = splitDocument(relative, text);
    passages.push(...document.passages);
    skipped += document.skipped;
  }
  return { passages, filesScanned, skipped, indexText: readCorpusFile(realRoot, GUIDANCE_INDEX_PATH) };
}

const MIN_FOLLOW_ON_BYTES = 120;

/** The rule behind `confident`; see CONFIDENCE. */
export function isConfident(top: RankedPassage | undefined, termCount: number): boolean {
  if (!top || termCount === 0) return false;
  const enough = top.score >= CONFIDENCE.minScore && top.coverage >= CONFIDENCE.minCoverage && top.matchedTerms >= Math.min(CONFIDENCE.minMatchedTerms, termCount);
  // A lone question word found only in body text is a mention, not an answer.
  return enough && (termCount > 1 || top.headingTerms > 0);
}

export function lookup(root: string, question: string, options: LookupOptions = {}): LookupResult {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const budget = options.budget ?? DEFAULT_BUDGET_BYTES;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const warnings: string[] = [];
  const trimmed = question.trim();
  const text = trimmed.length > MAX_QUESTION_CHARS ? trimmed.slice(0, MAX_QUESTION_CHARS) : trimmed;
  if (text.length < trimmed.length) warnings.push(`The question was cut to its first ${MAX_QUESTION_CHARS} characters.`);

  const { passages, filesScanned, skipped, indexText } = loadPassages(root);
  const index = buildIndex(passages, filesScanned);
  const { ranked, terms } = rank(index, text, parseTriggers(indexText));
  const termSet = new Set(terms);
  const confident = isConfident(ranked[0], terms.length);

  const results: LookupHit[] = [];
  const nearest: LookupResult["nearest"] = [];
  let remaining = budget;
  let excerptBytes = 0;
  const describe = (item: RankedPassage): { address: string; heading: string; score: number } => {
    const passage = index.passages[item.passageIndex].passage;
    return { address: passage.address, heading: passage.heading.join(" > "), score: Math.round(item.score * 1000) / 1000 };
  };
  if (confident) {
    for (const item of ranked) {
      if (results.length >= limit) break;
      if (results.length > 0 && remaining < MIN_FOLLOW_ON_BYTES) break;
      const entry = index.passages[item.passageIndex];
      const chunk = index.chunks[item.chunkIndex];
      const { excerpt, truncated, line } = excerptOf(entry, chunk, termSet, remaining);
      const used = byteLength(excerpt);
      remaining -= used;
      excerptBytes += used;
      const { address, heading, score } = describe(item);
      results.push({ address, heading, excerpt, truncated, sha: entry.passage.sha, score, line, sourceClass: sourceClassOf(entry.passage.path) });
    }
  } else {
    for (const item of ranked.slice(0, limit)) nearest.push(describe(item));
  }

  let largestPassageBytes = 0;
  for (const entry of index.passages) largestPassageBytes = Math.max(largestPassageBytes, byteLength(entry.passage.body));

  return {
    question: text,
    results,
    confident,
    nearest,
    passagesScanned: passages.length,
    filesScanned,
    supersededSkipped: skipped,
    largestPassageBytes,
    elapsedMs: Math.round((now() - started) * 100) / 100,
    budget,
    limit,
    excerptBytes,
    warnings
  };
}

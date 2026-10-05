/**
 * Deterministic text and WAV helpers for long-form narration ("podcast")
 * generation. All functions here are pure: no network, no filesystem, no
 * model calls. They exist so a long source (an article, or a GitHub issue's
 * commentary) can be split into provider-sized utterances, synthesized one at
 * a time through the ordinary `audio.speech.generate` route, and stitched back
 * into a single playable WAV without a media-editing dependency.
 */

import { validationError } from "../../cli/errors.js";
import { buildWav, extractWavData } from "./wavMeta.js";

export const DEFAULT_NARRATION_CHUNK_CHARS = 1200;

/**
 * Splits narration text into deterministic chunks no longer than `maxChars`.
 * It prefers paragraph breaks, then sentence breaks, and only hard-wraps a
 * single oversized token when a provider's character limit leaves no choice.
 * The result is stable for identical input, which is what makes the
 * per-chunk idempotency keys meaningful.
 */
export function splitNarrationText(
  text: string,
  maxChars: number = DEFAULT_NARRATION_CHUNK_CHARS,
): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw validationError("Narration chunk size must be a positive integer.", { maxChars });
  }

  const normalized = text.replaceAll("\r\n", "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";
  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    current = "";
  };

  for (const paragraph of normalized.split(/\n{2,}/)) {
    for (const sentence of splitSentences(paragraph)) {
      for (const piece of hardWrap(sentence, maxChars)) {
        if (!current) {
          current = piece;
        } else if (current.length + 1 + piece.length <= maxChars) {
          current = `${current} ${piece}`;
        } else {
          flush();
          current = piece;
        }
      }
    }
    // A paragraph break is a natural pause; keep it rather than packing the
    // next paragraph onto the same utterance.
    flush();
  }
  flush();

  return chunks;
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function hardWrap(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > maxChars) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        out.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) {
    out.push(current);
  }
  return out;
}

/**
 * Concatenates one or more generated WAV clips into a single PCM WAV. Every
 * clip must decode as WAV and share the same sample rate, channel count and bit
 * depth — a mismatch is a provider anomaly, not something to paper over, so it
 * throws instead of producing a file that plays back at the wrong speed.
 */
export function concatWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("Cannot concatenate an empty set of audio clips.");
  }

  const first = extractWavData(buffers[0]);
  if (!first) {
    throw new Error("The first speech clip is not a decodable WAV payload.");
  }

  const parts: Buffer[] = [first.data];
  for (let i = 1; i < buffers.length; i++) {
    const next = extractWavData(buffers[i]);
    if (!next) {
      throw new Error(`Speech clip ${i + 1} is not a decodable WAV payload.`);
    }
    if (
      next.sampleRateHz !== first.sampleRateHz ||
      next.channels !== first.channels ||
      next.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error(
        `Speech clips do not share one audio format (clip 1: ${first.sampleRateHz}Hz/` +
          `${first.channels}ch/${first.bitsPerSample}bit, clip ${i + 1}: ` +
          `${next.sampleRateHz}Hz/${next.channels}ch/${next.bitsPerSample}bit).`,
      );
    }
    parts.push(next.data);
  }

  return buildWav({
    sampleRateHz: first.sampleRateHz,
    channels: first.channels,
    bitsPerSample: first.bitsPerSample,
    data: Buffer.concat(parts),
  });
}

export interface NarrationIssueComment {
  author: { login: string } | null;
  body: string;
}

export interface NarrationIssueInput {
  number: number;
  title: string;
  body: string | null;
  comments: NarrationIssueComment[];
}

/**
 * Turns a GitHub issue and its comment thread into narration text. Each
 * comment is introduced by its spoken author, preferring an agent signature
 * line (`— Claudia Mason <…>`) over the GitHub login, so a multi-platform
 * thread is attributed by name rather than all reading as the operator.
 */
export function formatIssueCommentary(issue: NarrationIssueInput): string {
  const parts: string[] = [`${issue.title.trim()}. Issue ${issue.number} commentary.`];

  if (issue.body && issue.body.trim()) {
    parts.push(stripMarkdownForSpeech(issue.body));
  }

  issue.comments.forEach((comment, index) => {
    const speaker = lastSignatureName(comment.body) ?? comment.author?.login ?? "unattributed";
    const spoken = stripMarkdownForSpeech(stripSignatureLines(comment.body));
    parts.push(`Message ${index + 1}, from ${speaker}. ${spoken}`.trim());
  });

  return parts.join("\n\n");
}

function lastSignatureName(body: string): string | undefined {
  const lines = body.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^\s*[—–-]{1,2}\s*(.+?)\s*<[^>]+>\s*$/);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function stripSignatureLines(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^\s*[—–-]{1,2}\s*.+?<[^>]+>\s*$/.test(line))
    .join("\n");
}

/**
 * Removes the Markdown punctuation that a text-to-speech voice would otherwise
 * read aloud (emphasis markers, code fences, heading hashes, link syntax,
 * blockquotes, list markers and table separators) while preserving the words.
 * Deliberately conservative: it edits formatting, never content.
 */
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replaceAll(/```[\s\S]*?```/g, " ")
    .replaceAll(/`([^`]+)`/g, "$1")
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/^\s{0,3}#{1,6}\s+/gm, "")
    .replaceAll(/^\s{0,3}>\s?/gm, "")
    .replaceAll(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replaceAll(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
    .replaceAll("|", ", ")
    .replaceAll(/(\*\*|__|\*|_)/g, "")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .replaceAll(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Parses a GitHub issue reference into a repository and number. Accepts a full
 * issue URL, `owner/repo#123`, or a bare number when `repo` is supplied.
 * Refuses an ambiguous or malformed reference rather than guessing a repo.
 */
export function parseIssueRef(ref: string, repo?: string): { repository: string; number: number } {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw validationError("An issue reference is required.", { issue: ref });
  }

  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)(?:[#?].*)?$/);
  if (urlMatch) {
    return { repository: `${urlMatch[1]}/${urlMatch[2]}`, number: Number(urlMatch[3]) };
  }

  const shortMatch = trimmed.match(/^([^/\s]+\/[^/\s#]+)#(\d+)$/);
  if (shortMatch) {
    return { repository: shortMatch[1], number: Number(shortMatch[2]) };
  }

  if (/^\d+$/.test(trimmed)) {
    if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo.trim())) {
      throw validationError(
        "A bare issue number needs --repo <owner/name>.",
        { issue: ref, repo },
      );
    }
    return { repository: repo.trim(), number: Number(trimmed) };
  }

  throw validationError(
    "Issue reference must be a GitHub issue URL, owner/repo#number, or a number with --repo.",
    { issue: ref },
  );
}

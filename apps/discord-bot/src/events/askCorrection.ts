/** The fields an operator can set in a one-reply correction to an Ask receipt. */
export interface AskCorrectionReply {
  type: string | null;
  project: string | null;
  ref: string | null;
}

const CORRECTION_START = /^\s*(?:type|project)\s*:/i;
const CORRECTION_FIELD = /\b(type|project|ref|reference)\s*:\s*([^\s,;]+)/gi;

/**
 * Reads `type: work`, `project: arcadia`, `type: answer ref: R12` out of a reply to an Ask receipt. A reply is a
 * correction only if it starts with `type:` or `project:`; anything else is an ordinary message. Values are never
 * guessed: an unknown type is passed through so the CLI refuses it by name.
 */
export function parseAskCorrectionReply(content: string): AskCorrectionReply | null {
  if (!CORRECTION_START.test(content)) {
    return null;
  }
  const fields: AskCorrectionReply = { type: null, project: null, ref: null };
  for (const match of content.matchAll(CORRECTION_FIELD)) {
    const key = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").replace(/^[`'"]+|[`'"]+$/g, "");
    if (!value) {
      continue;
    }
    if (key === "type") {
      fields.type ??= value.toLowerCase();
    } else if (key === "project") {
      fields.project ??= value;
    } else {
      fields.ref ??= value;
    }
  }
  return fields;
}

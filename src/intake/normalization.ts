export interface NormalizedAskInput {
  rawInput: string;
  askText: string;
  wrapper: "pnpm_arcadia_ask" | "arcadia_ask" | null;
}

export function normalizeAskInput(rawInput: string): NormalizedAskInput {
  const trimmed = rawInput.trim();
  const match = /^(?:(pnpm)\s+)?arcadia\s+ask\s+(["'])([\s\S]*)\2\s*$/.exec(trimmed);
  if (!match) {
    return {
      rawInput,
      askText: rawInput,
      wrapper: null
    };
  }

  return {
    rawInput,
    askText: match[3],
    wrapper: match[1] ? "pnpm_arcadia_ask" : "arcadia_ask"
  };
}

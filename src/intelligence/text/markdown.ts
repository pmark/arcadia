/** Plain-text narration preserves source words while removing Markdown punctuation. */
export function stripMarkdownForSpeech(text: string): string {
  return text
    // Unwrap fenced code blocks but keep their words: a podcast should not
    // silently drop a paragraph just because it was fenced.
    .replaceAll(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replaceAll(/`([^`]+)`/g, "$1")
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/^\s{0,3}#{1,6}\s+/gm, "")
    .replaceAll(/^\s{0,3}>\s?/gm, "")
    .replaceAll(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replaceAll(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
    .replaceAll("|", ", ")
    // Strip emphasis markers only when they wrap content. A lone "*" or "_"
    // inside a word (snake_case) is not emphasis and must survive.
    .replaceAll(/\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*/g, "$1")
    .replaceAll(/__(?=\S)([\s\S]*?)(?<=\S)__/g, "$1")
    .replaceAll(/(?<![A-Za-z0-9_])[*_](?=\S)([^*_]*?)(?<=\S)[*_](?![A-Za-z0-9_])/g, "$1")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .replaceAll(/[ \t]{2,}/g, " ")
    .trim();
}

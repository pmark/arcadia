/**
 * Quote a scalar only when it would otherwise change YAML meaning — a
 * question, recommendation, or answer containing `: ` is the single most
 * common way generated frontmatter becomes unparseable. A leading `[` or `{`
 * opens a flow collection, so `[ENTRY] ...` is unparseable unless quoted (#1731).
 */
export function yamlScalar(value: string): string {
  const trimmed = value.trim();
  return /[:#]|^[-?&*!|>%@`"'[{]/.test(trimmed) ? JSON.stringify(trimmed) : trimmed;
}

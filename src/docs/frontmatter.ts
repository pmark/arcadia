/**
 * Quote a scalar only when it would otherwise change YAML meaning — a
 * question, recommendation, or answer containing `: ` is the single most
 * common way generated frontmatter becomes unparseable.
 */
export function yamlScalar(value: string): string {
  const trimmed = value.trim();
  return /[:#]|^[-?&*!|>%@`"']/.test(trimmed) ? JSON.stringify(trimmed) : trimmed;
}

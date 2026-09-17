/**
 * The longest a derived slug may be. Callers use slugs as document filenames
 * and reference handles, so a bound keeps them typeable and filesystem-safe.
 */
export const SLUG_MAX_LENGTH = 80;

/**
 * Normalize free text into a lowercase kebab-case slug that always satisfies
 * the managed-document `slug` grammar (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).
 *
 * Truncation happens *after* separators are collapsed and trimmed, so a value
 * whose 80th character lands just before a separator used to come out ending
 * in `-` and be refused by the Decision and Plan writers (Issue #269). Cutting
 * back to the last whole word inside the cap keeps every derived slug valid.
 */
export function slugify(value: string): string {
  const slug = normalize(value);

  if (slug.length <= SLUG_MAX_LENGTH) {
    return slug || "item";
  }

  const withinCap = slug.slice(0, SLUG_MAX_LENGTH);
  const lastSeparator = withinCap.lastIndexOf("-");
  // No separator inside the cap means the whole value is one very long word;
  // truncating it mid-word still yields valid kebab-case, which is the point.
  const bounded = lastSeparator > 0 ? withinCap.slice(0, lastSeparator) : withinCap;
  return bounded.replace(/-+$/, "") || "item";
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

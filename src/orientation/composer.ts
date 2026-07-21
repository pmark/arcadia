import type { OrientationEntry, OrientationPacket } from "./types.js";
import { daysUntilDue, isApproaching, isDueOrUrgent, isNeglected, isStale } from "./staleness.js";

const MAX_CONFIRMATION_QUESTIONS = 3;

export interface ComposedPacket {
  body: string;
  entrySnapshot: OrientationPacket["entrySnapshot"];
}

/**
 * Deterministic composition — no model call. Degrades stale entries into
 * confirmation questions rather than asserting them; surfaces at most one
 * neglect flag. See docs/plans/daily-orientation-packet/01-spec.md.
 */
export function composePacket(
  entries: OrientationEntry[],
  now: Date,
  options: { dailyAdvantageLine?: string } = {}
): ComposedPacket {
  const live = entries.filter((entry) => entry.status === "active" || entry.status === "confirmed");
  const fresh = live.filter((entry) => !isStale(entry, now));
  const stale = live.filter((entry) => isStale(entry, now));

  const sections: string[] = [];
  sections.push(`**Arcadia — ${localDateHeader(now)}**`);

  const urgent = fresh.filter((entry) => isDueOrUrgent(entry, now));
  if (urgent.length > 0) {
    sections.push(formatSection("Due / urgent", urgent.map((entry) => formatUrgentLine(entry, now))));
  }

  const approaching = fresh.filter((entry) => entry.entryType === "time_bound" && isApproaching(entry, now) && !urgent.includes(entry));
  if (approaching.length > 0) {
    sections.push(formatSection("Approaching", approaching.map((entry) => formatApproachingLine(entry, now))));
  }

  const byArea = groupByArea(fresh.filter((entry) => !urgent.includes(entry) && !approaching.includes(entry)));
  if (byArea.length > 0) {
    sections.push(formatSection("Areas", byArea.map(([area, topEntry]) => `${area}: ${topEntry.title}`)));
  }

  const confirmations = pickConfirmations(stale, now);
  if (confirmations.length > 0) {
    sections.push(formatSection("Still true?", confirmations.map((entry) => `- ${entry.title}?`)));
  }

  const neglected = pickNeglectFlag(live, now);
  if (neglected) {
    sections.push(`⚠️ Neglected: "${neglected.title}" hasn't been touched in a while.`);
  }

  if (options.dailyAdvantageLine) {
    sections.push(`Project work: ${options.dailyAdvantageLine}`);
  }

  if (urgent.length === 0 && approaching.length === 0 && byArea.length === 0 && confirmations.length === 0 && !neglected) {
    sections.push("Nothing pressing. Ledger is quiet.");
  }

  return {
    body: sections.join("\n\n"),
    entrySnapshot: live.map((entry) => ({ id: entry.id, title: entry.title, stale: isStale(entry, now) }))
  };
}

function localDateHeader(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatSection(title: string, lines: string[]): string {
  return `**${title}**\n${lines.map((line) => (line.startsWith("- ") ? line : `- ${line}`)).join("\n")}`;
}

function formatUrgentLine(entry: OrientationEntry, now: Date): string {
  const remaining = daysUntilDue(entry, now);
  if (remaining !== undefined && remaining <= 0) {
    return `${entry.title} (due ${remaining === 0 ? "today" : `${Math.abs(Math.round(remaining))}d ago`})`;
  }
  return `${entry.title} (critical)`;
}

function formatApproachingLine(entry: OrientationEntry, now: Date): string {
  const remaining = daysUntilDue(entry, now);
  const days = remaining !== undefined ? Math.round(remaining) : undefined;
  return `${entry.title} — due in ${days}d`;
}

function groupByArea(entries: OrientationEntry[]): Array<[string, OrientationEntry]> {
  const byArea = new Map<string, OrientationEntry>();
  for (const entry of entries) {
    const area = entry.area?.trim() || "General";
    if (!byArea.has(area)) {
      byArea.set(area, entry);
    }
  }
  return Array.from(byArea.entries());
}

function pickConfirmations(stale: OrientationEntry[], now: Date): OrientationEntry[] {
  return [...stale]
    .sort((a, b) => new Date(a.lastConfirmedAt).getTime() - new Date(b.lastConfirmedAt).getTime())
    .slice(0, MAX_CONFIRMATION_QUESTIONS);
}

function pickNeglectFlag(live: OrientationEntry[], now: Date): OrientationEntry | undefined {
  const neglected = live
    .filter((entry) => isNeglected(entry, now))
    .sort((a, b) => new Date(a.lastConfirmedAt).getTime() - new Date(b.lastConfirmedAt).getTime());
  return neglected[0];
}

export interface CalendarSchedule {
  cadence: "daily" | "weekly" | "monthly";
  timezone: string;
  time: string;
  weekday?: number;
  day?: number;
}
interface Civil { year: number; month: number; day: number; hour: number; minute: number; }
const formatters = new Map<string, Intl.DateTimeFormat>();
function civil(at: Date, zone: string): Civil {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}
function wall(value: Civil): number { return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute); }
function shift(value: Civil, days: number, months = 0): Civil {
  const date = new Date(Date.UTC(value.year, value.month - 1 + months, value.day + days, value.hour, value.minute));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}
/** Fall-back fires once at the earlier instant; spring gaps shift forward by the gap. */
function instant(value: Civil, zone: string): Date {
  const guess = wall(value);
  const offsets = new Set([-36, 0, 36].map((hours) => {
    const at = new Date(guess + hours * 3_600_000);
    return wall(civil(at, zone)) - at.getTime();
  }));
  const candidates = [...offsets].map((offset) => new Date(guess - offset));
  const exact = candidates.filter((at) => wall(civil(at, zone)) === guess);
  if (exact.length) return new Date(Math.min(...exact.map(Number)));
  const forward = candidates.filter((at) => wall(civil(at, zone)) > guess)
    .sort((a, b) => wall(civil(a, zone)) - wall(civil(b, zone)));
  if (!forward[0]) throw new Error("Calendar time could not be resolved.");
  return forward[0];
}
function step(definition: CalendarSchedule, value: Civil, direction: number): Civil {
  return definition.cadence === "monthly" ? shift(value, 0, direction) : shift(value, direction * (definition.cadence === "weekly" ? 7 : 1));
}
export interface CalendarOccurrence { key: string; dueAt: string; periodStart: string; periodEnd: string; }
function occurrence(definition: CalendarSchedule, value: Civil): CalendarOccurrence {
  let end = { ...value, hour: 0, minute: 0 };
  if (definition.cadence === "weekly") {
    const weekday = new Date(wall(end)).getUTCDay();
    end = shift(end, -((weekday + 6) % 7));
  } else if (definition.cadence === "monthly") end.day = 1;
  const start = step(definition, end, -1);
  return { key: new Date(wall(value)).toISOString().slice(0, 10), dueAt: instant(value, definition.timezone).toISOString(), periodStart: instant(start, definition.timezone).toISOString(), periodEnd: instant(end, definition.timezone).toISOString() };
}
export function latestOccurrence(definition: CalendarSchedule, now: Date): CalendarOccurrence {
  const [hour, minute] = definition.time.split(":").map(Number);
  let target = { ...civil(now, definition.timezone), hour, minute };
  if (definition.cadence === "weekly") {
    const weekday = new Date(wall(target)).getUTCDay() || 7;
    target = shift(target, -((weekday - definition.weekday! + 7) % 7));
  } else if (definition.cadence === "monthly") target.day = definition.day!;
  if (instant(target, definition.timezone).getTime() > now.getTime()) target = step(definition, target, -1);
  return occurrence(definition, target);
}
export function nextOccurrence(definition: CalendarSchedule, now: Date): CalendarOccurrence {
  const latest = latestOccurrence(definition, now);
  const [hour, minute] = definition.time.split(":").map(Number);
  const [year, month, day] = latest.key.split("-").map(Number);
  return occurrence(definition, step(definition, { year, month, day, hour, minute }, 1));
}
